-- WP-NARVA-06: patient-scoped clinical command inbox and atomic terminal
-- convergence. Whole-exercise checkpoint authority remains single-writer.

create table public.runtime_patient_commands (
  command_sequence bigint generated always as identity primary key,
  exercise_id text not null,
  patient_id text not null,
  command_id text not null,
  command_type text not null check (command_type in (
    'RESOURCE_APPLY','RESOURCE_STOP','MTP','CLINICAL_TREATMENT'
  )),
  command_payload jsonb not null check (jsonb_typeof(command_payload)='object'),
  patient_base_revision bigint not null check (patient_base_revision>=0),
  patient_resulting_revision bigint not null check (patient_resulting_revision>patient_base_revision),
  simulation_time_sec numeric not null check (simulation_time_sec>=0),
  actor_user_id uuid not null references auth.users(id),
  status text not null default 'ACCEPTED' check (status in ('ACCEPTED','MATERIALIZED','REJECTED')),
  materialization_result jsonb,
  submitted_at timestamptz not null default now(),
  materialized_at timestamptz,
  unique (exercise_id,command_id),
  foreign key (exercise_id,patient_id)
    references public.shared_workflow_patient_states(exercise_id,patient_id) on delete cascade
);

create index runtime_patient_commands_pending_idx
  on public.runtime_patient_commands(exercise_id,command_sequence)
  where status='ACCEPTED';

create table public.runtime_patient_command_notifications (
  exercise_id text primary key,
  latest_command_sequence bigint not null check (latest_command_sequence>0),
  updated_at timestamptz not null default now()
);

create table public.runtime_completion_requests (
  exercise_id text primary key,
  command_id text not null,
  requested_by uuid not null references auth.users(id),
  expected_exercise_version bigint not null check (expected_exercise_version>=0),
  fence_command_sequence bigint not null check (fence_command_sequence>=0),
  status text not null check (status in ('PENDING','COMPLETED')),
  terminal_checkpoint_revision bigint,
  terminal_payload_hash text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status='PENDING' and completed_at is null) or
         (status='COMPLETED' and completed_at is not null and terminal_checkpoint_revision is not null))
);

alter table public.runtime_patient_commands enable row level security;
alter table public.runtime_patient_command_notifications enable row level security;
alter table public.runtime_completion_requests enable row level security;

create policy "scoped operators read runtime patient commands"
on public.runtime_patient_commands for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));
create policy "scoped operators read runtime command notifications"
on public.runtime_patient_command_notifications for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));
create policy "scoped operators read runtime completion requests"
on public.runtime_completion_requests for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));

revoke all on public.runtime_patient_commands from public,anon,authenticated;
revoke all on public.runtime_patient_command_notifications from public,anon,authenticated;
revoke all on public.runtime_completion_requests from public,anon,authenticated;
grant select on public.runtime_patient_commands to authenticated;
grant select on public.runtime_patient_command_notifications to authenticated;
grant select on public.runtime_completion_requests to authenticated;

create or replace function public.exercise_lifecycle_from_state(p_state jsonb)
returns text language sql immutable security invoker set search_path='' as $$
  select coalesce(p_state#>>'{exerciseSession,lifecycleState}',
    case p_state#>>'{exerciseSession,state}'
      when 'running' then 'RUNNING' when 'paused' then 'PAUSED'
      when 'completed' then 'COMPLETED' else 'READY' end)
$$;
revoke all on function public.exercise_lifecycle_from_state(jsonb) from public,anon,authenticated;

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
  if p_command_type not in ('RESOURCE_APPLY','RESOURCE_STOP','MTP','CLINICAL_TREATMENT')
    or p_expected_patient_revision<0 or p_simulation_time_sec<0
    or p_command_payload is null or jsonb_typeof(p_command_payload)<>'object' then
    raise exception 'INVALID_RUNTIME_PATIENT_COMMAND' using errcode='22023';
  end if;
  if not (public.has_authorization_permission('CM_WORKFLOW_WRITE',p_exercise_id)
    or public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id)) then
    raise exception 'AUTHORIZATION_DENIED' using errcode='42501';
  end if;

  select * into v_duplicate from public.runtime_patient_commands
    where exercise_id=p_exercise_id and command_id=p_command_id;
  if found then
    if v_duplicate.patient_id<>p_patient_id or v_duplicate.actor_user_id<>v_actor
      or v_duplicate.command_type<>p_command_type
      or v_duplicate.patient_base_revision<>p_expected_patient_revision
      or v_duplicate.command_payload<>p_command_payload then
      raise exception 'IDEMPOTENCY_KEY_REUSE' using errcode='23505';
    end if;
    return query select 'IDEMPOTENT'::text,v_duplicate.command_sequence,
      v_duplicate.patient_resulting_revision,
      (select owner_user_id from public.shared_workflow_patient_states
        where exercise_id=p_exercise_id and patient_id=p_patient_id);
    return;
  end if;

  select * into v_exercise from public.exercise_states
    where exercise_id=p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode='22023'; end if;
  if public.exercise_lifecycle_from_state(v_exercise.state)<>'RUNNING' then
    raise exception 'EXERCISE_NOT_ACTIVE' using errcode='55000';
  end if;
  if exists(select 1 from public.runtime_completion_requests
    where exercise_id=p_exercise_id and status in ('PENDING','COMPLETED')) then
    raise exception 'COMPLETION_FENCED' using errcode='55000';
  end if;

  select * into v_head from public.shared_workflow_patient_states
    where exercise_id=p_exercise_id and patient_id=p_patient_id for update;
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

  insert into public.runtime_patient_commands(exercise_id,patient_id,command_id,command_type,
    command_payload,patient_base_revision,patient_resulting_revision,simulation_time_sec,actor_user_id)
  values(p_exercise_id,p_patient_id,p_command_id,p_command_type,p_command_payload,
    p_expected_patient_revision,p_expected_patient_revision+1,p_simulation_time_sec,v_actor)
  returning runtime_patient_commands.command_sequence into v_sequence;
  update public.shared_workflow_patient_states set revision=p_expected_patient_revision+1,
    updated_at=now(),updated_by=v_actor
    where exercise_id=p_exercise_id and patient_id=p_patient_id;
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

create or replace function public.record_runtime_patient_command_result(
  p_exercise_id text,p_command_sequence bigint,p_lease_id uuid,p_writer_instance_id text,
  p_status text,p_result jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare v_lease public.runtime_writer_leases%rowtype;
begin
  if p_status not in ('MATERIALIZED','REJECTED') or p_result is null then
    raise exception 'INVALID_RUNTIME_COMMAND_RESULT' using errcode='22023';
  end if;
  select * into v_lease from public.runtime_writer_leases where exercise_id=p_exercise_id for update;
  if not found or v_lease.lease_id<>p_lease_id or v_lease.writer_instance_id<>p_writer_instance_id
    or v_lease.writer_user_id<>(select auth.uid()) or v_lease.released_at is not null
    or v_lease.expires_at<=clock_timestamp() then
    raise exception 'STALE_WRITER' using errcode='42501';
  end if;
  update public.runtime_patient_commands set status=p_status,materialization_result=p_result,
    materialized_at=now() where exercise_id=p_exercise_id and command_sequence=p_command_sequence
    and status='ACCEPTED';
end $$;
revoke all on function public.record_runtime_patient_command_result(text,bigint,uuid,text,text,jsonb)
  from public,anon;
grant execute on function public.record_runtime_patient_command_result(text,bigint,uuid,text,text,jsonb)
  to authenticated;

create or replace function public.submit_runtime_completion_request(
  p_exercise_id text,p_command_id text,p_expected_exercise_version bigint
)
returns table(status text,fence_command_sequence bigint,terminal_checkpoint_revision bigint)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_request public.runtime_completion_requests%rowtype;
  v_exercise public.exercise_states%rowtype;
  v_fence bigint;
begin
  if v_actor is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
    or not public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id) then
    raise exception 'AUTHORIZATION_DENIED' using errcode='42501';
  end if;
  select * into v_request from public.runtime_completion_requests
    where exercise_id=p_exercise_id for update;
  if found then
    if v_request.command_id<>p_command_id or v_request.requested_by<>v_actor then
      raise exception 'COMPLETION_ALREADY_FENCED' using errcode='55000';
    end if;
    return query select v_request.status,v_request.fence_command_sequence,
      v_request.terminal_checkpoint_revision;
    return;
  end if;
  select * into v_exercise from public.exercise_states
    where exercise_id=p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode='22023'; end if;
  if public.exercise_lifecycle_from_state(v_exercise.state) not in ('RUNNING','PAUSED') then
    raise exception 'INVALID_TRANSITION' using errcode='55000';
  end if;
  if coalesce((v_exercise.state#>>'{exerciseSession,version}')::bigint,-1)<>p_expected_exercise_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;
  select coalesce(max(command_sequence),0) into v_fence from public.runtime_patient_commands
    where exercise_id=p_exercise_id;
  insert into public.runtime_completion_requests(exercise_id,command_id,requested_by,
    expected_exercise_version,fence_command_sequence,status)
  values(p_exercise_id,p_command_id,v_actor,p_expected_exercise_version,v_fence,'PENDING');
  return query select 'PENDING'::text,v_fence,null::bigint;
end $$;
revoke all on function public.submit_runtime_completion_request(text,text,bigint) from public,anon;
grant execute on function public.submit_runtime_completion_request(text,text,bigint) to authenticated;

create or replace function public.guard_runtime_checkpoint_completion_fence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_request public.runtime_completion_requests%rowtype;
begin
  select * into v_request from public.runtime_completion_requests
    where exercise_id=new.exercise_id;
  if found then
    if current_setting('russicaptor.terminal_finalize_command',true) is distinct from v_request.command_id then
      raise exception 'COMPLETION_FENCED' using errcode='55000';
    end if;
  elsif public.exercise_lifecycle_from_state(new.payload->'payload')='COMPLETED' then
    raise exception 'TERMINAL_CHECKPOINT_REQUIRES_FENCE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function public.guard_runtime_checkpoint_completion_fence() from public,anon,authenticated;
create trigger runtime_checkpoint_completion_fence
before insert or update on public.runtime_checkpoints
for each row execute function public.guard_runtime_checkpoint_completion_fence();

create or replace function public.guard_terminal_runtime_lease()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.released_at is null and exists(select 1 from public.runtime_completion_requests
    where exercise_id=new.exercise_id and status='COMPLETED') then
    raise exception 'EXERCISE_COMPLETED' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function public.guard_terminal_runtime_lease() from public,anon,authenticated;
create trigger terminal_runtime_lease_guard
before insert or update on public.runtime_writer_leases
for each row execute function public.guard_terminal_runtime_lease();

create or replace function public.finalize_runtime_completion(
  p_exercise_id text,p_command_id text,p_lease_id uuid,p_writer_instance_id text,
  p_expected_checkpoint_revision bigint,p_checkpoint jsonb
)
returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_lease public.runtime_writer_leases%rowtype;
  v_request public.runtime_completion_requests%rowtype;
  v_current bigint;
  v_next bigint;
  v_cursor bigint;
  v_now timestamptz:=clock_timestamp();
  v_bytes bigint:=octet_length(p_checkpoint::text);
  v_projection_revision bigint;
begin
  select * into v_request from public.runtime_completion_requests
    where exercise_id=p_exercise_id for update;
  if not found or v_request.command_id<>p_command_id then
    raise exception 'COMPLETION_REQUEST_NOT_FOUND' using errcode='55000';
  end if;
  if v_request.status='COMPLETED' then
    return query select v_request.terminal_checkpoint_revision,v_request.terminal_payload_hash,
      (select provenance_hash from public.runtime_checkpoints where exercise_id=p_exercise_id),v_request.completed_at;
    return;
  end if;
  select * into v_lease from public.runtime_writer_leases where exercise_id=p_exercise_id for update;
  if not found or v_lease.lease_id<>p_lease_id or v_lease.writer_instance_id<>p_writer_instance_id
    or v_lease.writer_user_id<>v_actor or v_lease.released_at is not null or v_lease.expires_at<=v_now then
    raise exception 'STALE_WRITER' using errcode='42501';
  end if;
  select checkpoint_revision into v_current from public.runtime_checkpoints
    where exercise_id=p_exercise_id for update;
  v_current:=coalesce(v_current,0);
  v_next:=(p_checkpoint->>'checkpointRevision')::bigint;
  v_cursor:=coalesce((p_checkpoint#>>'{payload,runtimePatientCommandCursor}')::bigint,0);
  if v_current<>p_expected_checkpoint_revision or v_next<=v_current
    or p_checkpoint->>'exerciseId'<>p_exercise_id
    or public.exercise_lifecycle_from_state(p_checkpoint->'payload')<>'COMPLETED'
    or v_cursor<v_request.fence_command_sequence
    or exists(select 1 from public.runtime_patient_commands where exercise_id=p_exercise_id
      and command_sequence<=v_request.fence_command_sequence and status='ACCEPTED') then
    raise exception 'TERMINAL_CHECKPOINT_INVALID' using errcode='55000';
  end if;
  perform set_config('russicaptor.terminal_finalize_command',p_command_id,true);
  insert into public.runtime_checkpoints(exercise_id,checkpoint_revision,persisted_runtime_version,
    payload_hash,provenance_hash,payload,payload_bytes,writer_instance_id,writer_user_id,updated_at)
  values(p_exercise_id,v_next,(p_checkpoint->>'persistedRuntimeVersion')::integer,
    p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_checkpoint,v_bytes,
    p_writer_instance_id,v_actor,v_now)
  on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,
    persisted_runtime_version=excluded.persisted_runtime_version,payload_hash=excluded.payload_hash,
    provenance_hash=excluded.provenance_hash,payload=excluded.payload,payload_bytes=excluded.payload_bytes,
    writer_instance_id=excluded.writer_instance_id,writer_user_id=excluded.writer_user_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_notifications(exercise_id,checkpoint_revision,payload_hash,
    provenance_hash,writer_instance_id,checkpoint_bytes,updated_at)
  values(p_exercise_id,v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',
    p_writer_instance_id,v_bytes,v_now) on conflict(exercise_id) do update set
    checkpoint_revision=excluded.checkpoint_revision,payload_hash=excluded.payload_hash,
    provenance_hash=excluded.provenance_hash,writer_instance_id=excluded.writer_instance_id,
    checkpoint_bytes=excluded.checkpoint_bytes,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,
    writer_instance_id,user_id,details)
  values(p_exercise_id,v_next,'CHECKPOINT_PUBLISHED',p_writer_instance_id,v_actor,
    jsonb_build_object('terminal',true,'completionCommandId',p_command_id));
  select revision into v_projection_revision from public.exercise_states
    where exercise_id=p_exercise_id for update;
  update public.exercise_states set revision=coalesce(v_projection_revision,0)+1,
    state=p_checkpoint->'payload',updated_at=v_now,updated_by=v_request.requested_by
    where exercise_id=p_exercise_id;
  update public.runtime_completion_requests set status='COMPLETED',
    terminal_checkpoint_revision=v_next,terminal_payload_hash=p_checkpoint->>'payloadHash',completed_at=v_now
    where exercise_id=p_exercise_id;
  update public.runtime_writer_leases set released_at=v_now where exercise_id=p_exercise_id;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,
    writer_instance_id,user_id,details)
  values(p_exercise_id,v_next,'WRITER_RELEASED',p_writer_instance_id,v_actor,
    jsonb_build_object('terminal',true,'completionCommandId',p_command_id));
  return query select v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',v_now;
end $$;
revoke all on function public.finalize_runtime_completion(text,text,uuid,text,bigint,jsonb)
  from public,anon;
grant execute on function public.finalize_runtime_completion(text,text,uuid,text,bigint,jsonb)
  to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='runtime_patient_command_notifications') then
    alter publication supabase_realtime add table public.runtime_patient_command_notifications;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='runtime_completion_requests') then
    alter publication supabase_realtime add table public.runtime_completion_requests;
  end if;
end $$;
