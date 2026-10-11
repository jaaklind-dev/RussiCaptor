-- WP-NEXT-03: conflict-safe, patient-scoped shared CM workflow boundary.
-- Existing exercise/checkpoint rows remain readable and are not rewritten.

create table public.shared_workflow_patient_states (
  exercise_id text not null,
  patient_id text not null,
  revision bigint not null default 0 check (revision >= 0),
  owner_user_id uuid references auth.users(id),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key (exercise_id, patient_id)
);

create table public.shared_workflow_commands (
  exercise_id text not null,
  patient_id text not null,
  command_id text not null,
  mutation_kind text not null check (mutation_kind in ('CLAIM','TRANSFER_REQUEST','TRANSFER','RELEASE','REACQUIRE','APPEND','MUTABLE')),
  base_revision bigint not null check (base_revision >= 0),
  resulting_revision bigint not null check (resulting_revision > 0),
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (exercise_id, command_id),
  foreign key (exercise_id, patient_id) references public.shared_workflow_patient_states(exercise_id, patient_id) on delete cascade
);

create table public.shared_workflow_notifications (
  exercise_id text not null,
  patient_id text not null,
  revision bigint not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key (exercise_id, patient_id)
);

create index shared_workflow_commands_patient_revision_idx
  on public.shared_workflow_commands(exercise_id, patient_id, resulting_revision);

alter table public.shared_workflow_patient_states enable row level security;
alter table public.shared_workflow_commands enable row level security;
alter table public.shared_workflow_notifications enable row level security;

create policy "scoped operators read shared patient workflow"
on public.shared_workflow_patient_states for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN', exercise_id));
create policy "scoped operators read shared workflow commands"
on public.shared_workflow_commands for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN', exercise_id));
create policy "scoped operators read shared workflow notifications"
on public.shared_workflow_notifications for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN', exercise_id));

revoke all on public.shared_workflow_patient_states from public, anon, authenticated;
revoke all on public.shared_workflow_commands from public, anon, authenticated;
revoke all on public.shared_workflow_notifications from public, anon, authenticated;
grant select on public.shared_workflow_patient_states to authenticated;
grant select on public.shared_workflow_commands to authenticated;
grant select on public.shared_workflow_notifications to authenticated;

-- CM patient workflow writes are RPC-only. EXCON retains lifecycle projection
-- ownership; CM can still read the scoped discovery projection.
drop policy if exists "scoped operators create exercise state" on public.exercise_states;
drop policy if exists "scoped operators update exercise state" on public.exercise_states;
create policy "excon creates exercise state" on public.exercise_states for insert to authenticated
with check(updated_by=(select auth.uid()) and public.has_authorization_permission('EXCON_EXERCISE_CONTROL',exercise_id));
create policy "excon updates exercise state" on public.exercise_states for update to authenticated
using(public.has_authorization_permission('EXCON_EXERCISE_CONTROL',exercise_id))
with check(updated_by=(select auth.uid()) and public.has_authorization_permission('EXCON_EXERCISE_CONTROL',exercise_id));

create or replace function public.merge_shared_workflow_append(p_current jsonb, p_proposed jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_result jsonb := coalesce(p_current, '{}'::jsonb);
  v_key text;
  v_merged jsonb;
begin
  foreach v_key in array array['notes','timelineEvents','interventions','medicationAdministrations','vitalSigns'] loop
    select coalesce(jsonb_agg(item order by item->>'id'), '[]'::jsonb) into v_merged
    from (
      select distinct on (item->>'id') item
      from (
        select item, 0 as precedence
        from jsonb_array_elements(coalesce(p_current->v_key, '[]'::jsonb)) item
        union all
        select item, 1 as precedence
        from jsonb_array_elements(coalesce(p_proposed->v_key, '[]'::jsonb)) item
      ) candidates
      order by item->>'id', precedence desc
    ) merged;
    v_result := jsonb_set(v_result, array[v_key], v_merged, true);
  end loop;
  return v_result;
end $$;
revoke all on function public.merge_shared_workflow_append(jsonb,jsonb) from public,anon,authenticated;

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

  select * into v_duplicate from public.shared_workflow_commands
  where exercise_id=p_exercise_id and command_id=p_command_id;
  if found then
    if v_duplicate.patient_id<>p_patient_id or v_duplicate.actor_user_id<>v_actor
      or v_duplicate.mutation_kind<>p_mutation_kind then
      raise exception 'IDEMPOTENCY_KEY_REUSE' using errcode='23505';
    end if;
    select * into v_head from public.shared_workflow_patient_states
      where exercise_id=p_exercise_id and patient_id=p_patient_id;
    return query select 'IDEMPOTENT'::text,v_head.revision,v_head.owner_user_id,v_head.state;
    return;
  end if;

  insert into public.shared_workflow_patient_states(exercise_id,patient_id,revision,owner_user_id,state,updated_by)
  -- A new authoritative head is deliberately unowned.  The caller may not
  -- manufacture an owner by supplying p_expected_owner_user_id; ownership is
  -- established only by the validated CLAIM/REACQUIRE transition below.
  values(p_exercise_id,p_patient_id,0,null,p_state,v_actor)
  on conflict(exercise_id,patient_id) do nothing;
  select * into v_head from public.shared_workflow_patient_states
    where exercise_id=p_exercise_id and patient_id=p_patient_id for update;

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

  if not v_is_excon then
    if p_mutation_kind in ('APPEND','MUTABLE','TRANSFER','RELEASE') and v_head.owner_user_id is distinct from v_actor then
      return query select 'NOT_OWNER'::text,v_head.revision,v_head.owner_user_id,v_head.state;
      return;
    end if;
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
      select 1 from public.operator_profiles profile
      join public.authorization_role_assignments assignment on assignment.user_id=profile.user_id
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
  update public.shared_workflow_patient_states set revision=v_next_revision,
    owner_user_id=p_next_owner_user_id,state=v_next_state,updated_at=now(),updated_by=v_actor
  where exercise_id=p_exercise_id and patient_id=p_patient_id;
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

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='shared_workflow_notifications') then
    alter publication supabase_realtime add table public.shared_workflow_notifications;
  end if;
end $$;
