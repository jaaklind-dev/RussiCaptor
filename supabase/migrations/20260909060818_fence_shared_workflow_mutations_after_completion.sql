-- WP-NARVA-07K: shared-workflow mutation acceptance must participate in the
-- same authoritative completion fence as Runtime patient commands. Locking
-- exercise_states serializes mutation acceptance with completion-fence setup:
-- either the mutation commits first and is included in the completion fence,
-- or the terminal fence wins and the mutation is rejected.

create or replace function public.apply_shared_workflow_patient_mutation(
  p_exercise_id text,
  p_patient_id text,
  p_command_id text,
  p_mutation_kind text,
  p_expected_revision bigint,
  p_expected_owner_user_id uuid,
  p_next_owner_user_id uuid,
  p_state jsonb
)
returns table(status text, revision bigint, owner_user_id uuid, state jsonb)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := (select auth.uid());
  v_head public.shared_workflow_patient_states%rowtype;
  v_duplicate public.shared_workflow_commands%rowtype;
  v_exercise public.exercise_states%rowtype;
  v_completion_status text;
  v_is_excon boolean;
  v_next_state jsonb;
  v_next_revision bigint;
begin
  if v_actor is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;
  if p_mutation_kind not in ('CLAIM','TRANSFER_REQUEST','TRANSFER','RELEASE','REACQUIRE','APPEND','MUTABLE')
    or p_expected_revision < 0 or p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'INVALID_SHARED_WORKFLOW_MUTATION' using errcode='22023';
  end if;
  if not (public.has_authorization_permission('CM_WORKFLOW_WRITE',p_exercise_id)
    or public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id)) then
    raise exception 'AUTHORIZATION_DENIED' using errcode='42501';
  end if;
  v_is_excon := public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id);

  select swc.* into v_duplicate
  from public.shared_workflow_commands as swc
  where swc.exercise_id=p_exercise_id and swc.command_id=p_command_id;
  if found then
    if v_duplicate.patient_id<>p_patient_id or v_duplicate.actor_user_id<>v_actor
      or v_duplicate.mutation_kind<>p_mutation_kind then
      raise exception 'IDEMPOTENCY_KEY_REUSE' using errcode='23505';
    end if;
    select swps.* into v_head
    from public.shared_workflow_patient_states as swps
    where swps.exercise_id=p_exercise_id and swps.patient_id=p_patient_id;
    return query select 'IDEMPOTENT'::text,v_head.revision,v_head.owner_user_id,v_head.state;
    return;
  end if;

  -- This lock is the transaction boundary shared with completion-fence setup.
  select es.* into v_exercise
  from public.exercise_states as es
  where es.exercise_id=p_exercise_id for update;
  if not found then
    raise exception 'EXERCISE_NOT_FOUND' using errcode='22023';
  end if;
  select rcr.status into v_completion_status
  from public.runtime_completion_requests as rcr
  where rcr.exercise_id=p_exercise_id;
  if public.exercise_lifecycle_from_state(v_exercise.state)='COMPLETED'
    or v_completion_status='COMPLETED' then
    raise exception 'EXERCISE_COMPLETED' using errcode='55000';
  end if;
  if v_completion_status='PENDING' then
    raise exception 'COMPLETION_FENCED' using errcode='55000';
  end if;

  insert into public.shared_workflow_patient_states(exercise_id,patient_id,revision,owner_user_id,state,updated_by)
  values(p_exercise_id,p_patient_id,0,null,p_state,v_actor)
  on conflict(exercise_id,patient_id) do nothing;
  select swps.* into v_head
  from public.shared_workflow_patient_states as swps
  where swps.exercise_id=p_exercise_id and swps.patient_id=p_patient_id for update;

  if not v_is_excon and p_mutation_kind in ('CLAIM','REACQUIRE') and v_head.owner_user_id is not null then
    return query select 'ALREADY_OWNED'::text,v_head.revision,v_head.owner_user_id,v_head.state;
    return;
  end if;
  if p_mutation_kind<>'APPEND' and v_head.revision<>p_expected_revision then
    return query select 'STALE_VERSION'::text,v_head.revision,v_head.owner_user_id,v_head.state;
    return;
  end if;
  if p_expected_owner_user_id is distinct from v_head.owner_user_id then
    return query select 'OWNERSHIP_CHANGED'::text,v_head.revision,v_head.owner_user_id,v_head.state;
    return;
  end if;
  if not v_is_excon and p_mutation_kind in ('APPEND','MUTABLE','TRANSFER','RELEASE')
    and v_head.owner_user_id is distinct from v_actor then
    return query select 'NOT_OWNER'::text,v_head.revision,v_head.owner_user_id,v_head.state;
    return;
  end if;
  if p_mutation_kind in ('CLAIM','REACQUIRE') and p_next_owner_user_id is distinct from v_actor and not v_is_excon then
    raise exception 'INVALID_OWNER_TRANSITION' using errcode='42501';
  elsif p_mutation_kind='TRANSFER' and p_next_owner_user_id is null then
    raise exception 'INVALID_OWNER_TRANSITION' using errcode='22023';
  elsif p_mutation_kind='RELEASE' and p_next_owner_user_id is not null then
    raise exception 'INVALID_OWNER_TRANSITION' using errcode='22023';
  elsif p_mutation_kind in ('APPEND','MUTABLE','TRANSFER_REQUEST') and p_next_owner_user_id is distinct from v_head.owner_user_id then
    raise exception 'INVALID_OWNER_TRANSITION' using errcode='22023';
  end if;
  if p_mutation_kind in ('CLAIM','REACQUIRE','TRANSFER') and p_next_owner_user_id is not null
    and not exists (
      select 1 from public.operator_profiles as profile
      join public.authorization_role_assignments as assignment on assignment.user_id=profile.user_id
      where profile.user_id=p_next_owner_user_id and profile.status='ACTIVE'
        and assignment.role='CM' and assignment.status='ACTIVE'
        and assignment.scope_type='EXERCISE' and assignment.scope_id=p_exercise_id
        and (assignment.expires_at is null or assignment.expires_at>now())
    ) then
    raise exception 'INVALID_TRANSFER_TARGET' using errcode='42501';
  end if;

  v_next_state := case when p_mutation_kind='APPEND'
    then public.merge_shared_workflow_append(v_head.state,p_state) else p_state end;
  v_next_revision := v_head.revision+1;
  update public.shared_workflow_patient_states as swps
  set revision=v_next_revision,owner_user_id=p_next_owner_user_id,state=v_next_state,
    updated_at=now(),updated_by=v_actor
  where swps.exercise_id=p_exercise_id and swps.patient_id=p_patient_id;
  insert into public.shared_workflow_commands(exercise_id,patient_id,command_id,mutation_kind,
    base_revision,resulting_revision,actor_user_id)
  values(p_exercise_id,p_patient_id,p_command_id,p_mutation_kind,p_expected_revision,v_next_revision,v_actor);
  insert into public.shared_workflow_notifications(exercise_id,patient_id,revision,updated_at,updated_by)
  values(p_exercise_id,p_patient_id,v_next_revision,now(),v_actor)
  on conflict(exercise_id,patient_id) do update set revision=excluded.revision,
    updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  return query select 'APPLIED'::text,v_next_revision,p_next_owner_user_id,v_next_state;
end $$;

revoke all on function public.apply_shared_workflow_patient_mutation(text,text,text,text,bigint,uuid,uuid,jsonb)
  from public,anon;
grant execute on function public.apply_shared_workflow_patient_mutation(text,text,text,text,bigint,uuid,uuid,jsonb)
  to authenticated;
