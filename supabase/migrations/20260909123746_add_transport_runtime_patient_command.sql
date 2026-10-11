-- WP-NARVA-09: transport submissions use the existing durable patient command
-- inbox. Whole-exercise Runtime/checkpoint authority remains single-writer.

alter table public.runtime_patient_commands
  drop constraint runtime_patient_commands_command_type_check;
alter table public.runtime_patient_commands
  add constraint runtime_patient_commands_command_type_check check (command_type in (
    'RESOURCE_APPLY','RESOURCE_STOP','MTP','CLINICAL_TREATMENT','TRANSPORT_START'
  ));

create or replace function public.submit_runtime_patient_command(
  p_exercise_id text,p_patient_id text,p_command_id text,p_command_type text,
  p_expected_patient_revision bigint,p_simulation_time_sec numeric,p_command_payload jsonb
)
returns table(status text,command_sequence bigint,patient_revision bigint,owner_user_id uuid)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_head public.shared_workflow_patient_states%rowtype;
  v_duplicate public.runtime_patient_commands%rowtype;
  v_exercise public.exercise_states%rowtype;
  v_sequence bigint;
begin
  if v_actor is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;
  if p_command_type not in ('RESOURCE_APPLY','RESOURCE_STOP','MTP','CLINICAL_TREATMENT','TRANSPORT_START')
    or p_expected_patient_revision<0 or p_simulation_time_sec<0
    or p_command_payload is null or jsonb_typeof(p_command_payload)<>'object' then
    raise exception 'INVALID_RUNTIME_PATIENT_COMMAND' using errcode='22023';
  end if;
  if not (public.has_authorization_permission('CM_WORKFLOW_WRITE',p_exercise_id)
    or public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id)) then
    raise exception 'AUTHORIZATION_DENIED' using errcode='42501';
  end if;

  select rpc.* into v_duplicate
  from public.runtime_patient_commands as rpc
  where rpc.exercise_id=p_exercise_id and rpc.command_id=p_command_id;
  if found then
    if v_duplicate.patient_id<>p_patient_id or v_duplicate.actor_user_id<>v_actor
      or v_duplicate.command_type<>p_command_type
      or v_duplicate.patient_base_revision<>p_expected_patient_revision
      or v_duplicate.command_payload<>p_command_payload then
      raise exception 'IDEMPOTENCY_KEY_REUSE' using errcode='23505';
    end if;
    return query select 'IDEMPOTENT'::text,v_duplicate.command_sequence,
      v_duplicate.patient_resulting_revision,
      (select swps.owner_user_id from public.shared_workflow_patient_states as swps
        where swps.exercise_id=p_exercise_id and swps.patient_id=p_patient_id);
    return;
  end if;

  select es.* into v_exercise
  from public.exercise_states as es
  where es.exercise_id=p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode='22023'; end if;
  if public.exercise_lifecycle_from_state(v_exercise.state)<>'RUNNING' then
    raise exception 'EXERCISE_NOT_ACTIVE' using errcode='55000';
  end if;
  if exists(select 1 from public.runtime_completion_requests as rcr
    where rcr.exercise_id=p_exercise_id and rcr.status in ('PENDING','COMPLETED')) then
    raise exception 'COMPLETION_FENCED' using errcode='55000';
  end if;

  select swps.* into v_head
  from public.shared_workflow_patient_states as swps
  where swps.exercise_id=p_exercise_id and swps.patient_id=p_patient_id for update;
  if not found then raise exception 'PATIENT_WORKFLOW_NOT_FOUND' using errcode='22023'; end if;
  if v_head.revision<>p_expected_patient_revision then
    return query select 'STALE_VERSION'::text,0::bigint,v_head.revision,v_head.owner_user_id;
    return;
  end if;
  if not public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id)
    and v_head.owner_user_id is distinct from v_actor then
    return query select 'NOT_OWNER'::text,0::bigint,v_head.revision,v_head.owner_user_id;
    return;
  end if;

  insert into public.runtime_patient_commands as rpc(exercise_id,patient_id,command_id,command_type,
    command_payload,patient_base_revision,patient_resulting_revision,simulation_time_sec,actor_user_id)
  values(p_exercise_id,p_patient_id,p_command_id,p_command_type,p_command_payload,
    p_expected_patient_revision,p_expected_patient_revision+1,p_simulation_time_sec,v_actor)
  returning rpc.command_sequence into v_sequence;
  update public.shared_workflow_patient_states as swps
  set revision=p_expected_patient_revision+1,updated_at=now(),updated_by=v_actor
  where swps.exercise_id=p_exercise_id and swps.patient_id=p_patient_id;
  insert into public.shared_workflow_commands(exercise_id,patient_id,command_id,mutation_kind,
    base_revision,resulting_revision,actor_user_id)
  values(p_exercise_id,p_patient_id,p_command_id,'MUTABLE',p_expected_patient_revision,
    p_expected_patient_revision+1,v_actor);
  insert into public.shared_workflow_notifications(exercise_id,patient_id,revision,updated_at,updated_by)
  values(p_exercise_id,p_patient_id,p_expected_patient_revision+1,now(),v_actor)
  on conflict(exercise_id,patient_id) do update set revision=excluded.revision,
    updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  insert into public.runtime_patient_command_notifications(exercise_id,latest_command_sequence,updated_at)
  values(p_exercise_id,v_sequence,now()) on conflict(exercise_id) do update set
    latest_command_sequence=greatest(public.runtime_patient_command_notifications.latest_command_sequence,
      excluded.latest_command_sequence),updated_at=excluded.updated_at;
  return query select 'APPLIED'::text,v_sequence,p_expected_patient_revision+1,v_head.owner_user_id;
end $$;

revoke all on function public.submit_runtime_patient_command(text,text,text,text,bigint,numeric,jsonb)
  from public,anon;
grant execute on function public.submit_runtime_patient_command(text,text,text,text,bigint,numeric,jsonb)
  to authenticated;
