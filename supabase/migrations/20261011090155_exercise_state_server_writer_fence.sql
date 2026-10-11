-- Exercise-state writes have three distinct authorities: one-shot bootstrap,
-- current runtime writer, and terminal checkpoint/recovery. This migration
-- intentionally does not alter the existing finalization/recovery RPCs.
create table public.exercise_state_publication_operations (
  exercise_id text not null,
  operation_id text not null,
  operation_kind text not null check (operation_kind in ('READY','ACTIVE','TERMINAL','ARCHIVE')),
  request_hash text not null,
  actor_user_id uuid not null references auth.users(id),
  lease_id uuid,
  result_revision bigint not null,
  result_updated_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (exercise_id, operation_id),
  check (length(operation_id) between 1 and 200)
);

alter table public.exercise_state_publication_operations enable row level security;
revoke all on public.exercise_state_publication_operations from public, anon, authenticated;

-- The existing bootstrap trigger remains the one-shot consumer. The RPC pins
-- its selection to the supplied authorization, avoiding a different active
-- authorization being consumed when an operator has more than one.
create or replace function public.claim_exercise_bootstrap_authorization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_authorization public.exercise_bootstrap_authorizations%rowtype;
  v_requested_id text := pg_catalog.current_setting('russicaptor.bootstrap_authorization_id', true);
  v_now timestamptz := clock_timestamp();
begin
  if v_requested_id is null and public.has_authorization_permission('EXCON_EXERCISE_CONTROL', new.exercise_id) then
    return new;
  end if;
  if v_user_id is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) then
    raise exception 'BOOTSTRAP_AUTHORIZATION_REQUIRED' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('EXERCISE_BOOTSTRAP' || E'\n' || v_user_id::text, 0));
  select bootstrap.* into v_authorization
  from public.exercise_bootstrap_authorizations as bootstrap
  where bootstrap.user_id = v_user_id and bootstrap.status = 'ACTIVE'
    and bootstrap.expires_at > v_now and bootstrap.consumed_exercise_id is null
    and (v_requested_id is null or bootstrap.id::text = v_requested_id)
  for update;
  if not found then
    raise exception 'BOOTSTRAP_AUTHORIZATION_REQUIRED' using errcode = '42501';
  end if;
  if new.revision <> 1 or new.updated_by is distinct from v_user_id
    or new.exercise_id is null or new.exercise_id <> btrim(new.exercise_id)
    or length(new.exercise_id) not between 1 and 160
    or new.state->'exerciseSession'->>'exerciseId' is distinct from new.exercise_id
    or new.state->'exerciseSession'->>'lifecycleState' is distinct from 'READY'
    or new.state->'exerciseSession'->>'simulationTimeSec' is distinct from '0'
    or new.state->'exerciseSession'->>'speed' is distinct from '1'
    or coalesce(new.state->'exerciseSession'->>'lastCommandId', '') not like 'PREPARE-%'
    or length(coalesce(new.state->'exercisePackageReference'->>'packageId', '')) = 0
    or length(coalesce(new.state->'exercisePackageReference'->>'packageVersion', '')) = 0 then
    raise exception 'BOOTSTRAP_INITIAL_READY_PROJECTION_REQUIRED' using errcode = '42501';
  end if;
  update public.exercise_bootstrap_authorizations
    set consumed_exercise_id = new.exercise_id, consumed_at = v_now
    where id = v_authorization.id;
  return new;
end;
$$;

create function public.create_initial_exercise_state(
  p_exercise_id text, p_operation_id text, p_bootstrap_authorization_id uuid,
  p_package_id text, p_package_version text, p_state jsonb
) returns table(exercise_id text, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := clock_timestamp();
  v_hash text;
  v_op public.exercise_state_publication_operations%rowtype;
  v_created public.exercise_states%rowtype;
begin
  if v_actor is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_exercise_id is null or length(p_exercise_id) not between 1 and 160
    or p_operation_id is null or length(p_operation_id) not between 1 and 200
    or p_state->'exerciseSession'->>'exerciseId' is distinct from p_exercise_id
    or public.exercise_lifecycle_from_state(p_state) <> 'READY'
    or p_state->'exercisePackageReference'->>'packageId' is distinct from p_package_id
    or p_state->'exercisePackageReference'->>'packageVersion' is distinct from p_package_version then
    raise exception 'INVALID_EXERCISE_STATE' using errcode = '22023';
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('kind','READY','bootstrap',p_bootstrap_authorization_id,
      'packageId',p_package_id,'packageVersion',p_package_version,'state',p_state)::text,'UTF8')),'hex');
  -- Serialize a first create with an identical in-flight retry. The second
  -- request sees the committed operation receipt rather than a duplicate row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('EXSTATE_READY' || E'\n' || p_exercise_id,0));
  select op.* into v_op from public.exercise_state_publication_operations as op
    where op.exercise_id=p_exercise_id and op.operation_id=p_operation_id for update;
  if found then
    if v_op.operation_kind <> 'READY' or v_op.actor_user_id <> v_actor or v_op.request_hash <> v_hash then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    return query select p_exercise_id,v_op.result_revision,v_op.result_updated_at;
    return;
  end if;
  if exists(select 1 from public.exercise_states as es where es.exercise_id=p_exercise_id) then
    raise exception 'EXERCISE_ALREADY_EXISTS' using errcode = '23505';
  end if;
  if not exists(select 1 from public.exercise_bootstrap_authorizations as b
    where b.id=p_bootstrap_authorization_id and b.user_id=v_actor and b.status='ACTIVE'
      and b.expires_at>v_now and b.consumed_exercise_id is null) then
    raise exception 'BOOTSTRAP_AUTHORIZATION_REQUIRED' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('russicaptor.bootstrap_authorization_id',p_bootstrap_authorization_id::text,true);
  insert into public.exercise_states(exercise_id,revision,state,updated_at,updated_by)
    values(p_exercise_id,1,p_state,v_now,v_actor) returning * into v_created;
  if not exists(select 1 from public.exercise_bootstrap_authorizations as b
    where b.id=p_bootstrap_authorization_id and b.consumed_exercise_id=p_exercise_id and b.consumed_at is not null) then
    raise exception 'BOOTSTRAP_CONSUMPTION_FAILED' using errcode = '55000';
  end if;
  insert into public.exercise_state_publication_operations
    (exercise_id,operation_id,operation_kind,request_hash,actor_user_id,result_revision,result_updated_at)
    values(p_exercise_id,p_operation_id,'READY',v_hash,v_actor,1,v_created.updated_at);
  return query select p_exercise_id,1::bigint,v_created.updated_at;
end;
$$;

create function public.publish_exercise_state_current_writer(
  p_exercise_id text, p_operation_id text, p_lease_id uuid,
  p_writer_instance_id text, p_expected_revision bigint, p_state jsonb
) returns table(exercise_id text, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_lease public.runtime_writer_leases%rowtype;
  v_state public.exercise_states%rowtype;
  v_op public.exercise_state_publication_operations%rowtype;
  v_checkpoint_lifecycle text;
  v_next_lifecycle text;
  v_current_lifecycle text;
  v_hash text;
  v_now timestamptz;
begin
  if v_actor is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
    or not public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_exercise_id is null or p_operation_id is null or length(p_operation_id) not between 1 and 200
    or p_lease_id is null or p_writer_instance_id is null or length(p_writer_instance_id)=0
    or p_expected_revision is null or p_expected_revision < 1
    or p_state->'exerciseSession'->>'exerciseId' is distinct from p_exercise_id then
    raise exception 'INVALID_EXERCISE_STATE' using errcode = '22023';
  end if;
  v_next_lifecycle := public.exercise_lifecycle_from_state(p_state);
  if v_next_lifecycle not in ('RUNNING','PAUSED') then
    raise exception 'INVALID_EXERCISE_STATE' using errcode = '22023';
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('kind','ACTIVE','lease',p_lease_id,'writer',p_writer_instance_id,
      'expectedRevision',p_expected_revision,'state',p_state)::text,'UTF8')),'hex');
  select lease.* into v_lease from public.runtime_writer_leases as lease
    where lease.exercise_id=p_exercise_id for update;
  if not found then raise exception 'WRITER_NOT_FOUND' using errcode = '42501'; end if;
  -- A competing takeover/renewal can hold this row lock. Check expiry at the
  -- actual authority boundary, not at the start of a potentially blocked call.
  v_now := clock_timestamp();
  if v_lease.lease_id is distinct from p_lease_id or v_lease.writer_instance_id is distinct from p_writer_instance_id
    or v_lease.writer_user_id is distinct from v_actor then
    raise exception 'WRITER_GENERATION_STALE' using errcode = '42501';
  end if;
  if v_lease.released_at is not null then raise exception 'WRITER_REVOKED' using errcode = '42501'; end if;
  if v_lease.expires_at <= v_now then raise exception 'WRITER_EXPIRED' using errcode = '42501'; end if;
  -- Even an idempotent retry must prove current writer authority. Otherwise a
  -- replaced writer could receive an apparent ACK after a remote takeover.
  select op.* into v_op from public.exercise_state_publication_operations as op
    where op.exercise_id=p_exercise_id and op.operation_id=p_operation_id for update;
  if found then
    if v_op.operation_kind <> 'ACTIVE' or v_op.actor_user_id <> v_actor
      or v_op.lease_id is distinct from p_lease_id or v_op.request_hash <> v_hash then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    return query select p_exercise_id,v_op.result_revision,v_op.result_updated_at;
    return;
  end if;
  select es.* into v_state from public.exercise_states as es
    where es.exercise_id=p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_state.revision <> p_expected_revision then
    raise exception 'REVISION_CONFLICT' using errcode = '40001';
  end if;
  v_current_lifecycle := public.exercise_lifecycle_from_state(v_state.state);
  if v_current_lifecycle = 'COMPLETED' or exists(
    select 1 from public.runtime_completion_requests as req
    where req.exercise_id=p_exercise_id) then
    raise exception 'PUBLICATION_FENCED' using errcode = '55000';
  end if;
  select public.exercise_lifecycle_from_state(checkpoint.payload->'payload')
    into v_checkpoint_lifecycle from public.runtime_checkpoints as checkpoint
    where checkpoint.exercise_id=p_exercise_id;
  if v_checkpoint_lifecycle = 'COMPLETED' then
    raise exception 'TERMINAL_DOMINATES' using errcode = '55000';
  end if;
  if v_current_lifecycle not in ('READY','RUNNING','PAUSED')
    or (v_current_lifecycle='READY' and v_next_lifecycle<>'RUNNING')
    or p_state->'exercisePackageReference' is distinct from v_state.state->'exercisePackageReference' then
    raise exception 'INVALID_EXERCISE_STATE' using errcode = '22023';
  end if;
  update public.exercise_states as es
    set revision=v_state.revision+1,state=p_state,updated_at=v_now,updated_by=v_actor
    where es.exercise_id=p_exercise_id and es.revision=p_expected_revision;
  if not found then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
  insert into public.exercise_state_publication_operations
    (exercise_id,operation_id,operation_kind,request_hash,actor_user_id,lease_id,result_revision,result_updated_at)
    values(p_exercise_id,p_operation_id,'ACTIVE',v_hash,v_actor,p_lease_id,v_state.revision+1,v_now);
  return query select p_exercise_id,v_state.revision+1,v_now;
end;
$$;

-- Completion itself stays on finalize_runtime_completion*; this bounded
-- reconciliation can only copy an already durable terminal checkpoint.
create function public.reconcile_terminal_exercise_state(
  p_exercise_id text, p_operation_id text, p_expected_revision bigint,
  p_expected_checkpoint_revision bigint
) returns table(exercise_id text, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_state public.exercise_states%rowtype;
  v_checkpoint public.runtime_checkpoints%rowtype;
  v_request public.runtime_completion_requests%rowtype;
  v_op public.exercise_state_publication_operations%rowtype;
  v_hash text;
  v_terminal_state jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 200
    or p_expected_revision is null or p_expected_revision < 1
    or p_expected_checkpoint_revision is null or p_expected_checkpoint_revision < 1 then
    raise exception 'INVALID_EXERCISE_STATE' using errcode = '22023';
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('kind','TERMINAL','projectionRevision',p_expected_revision,
      'checkpointRevision',p_expected_checkpoint_revision)::text,'UTF8')),'hex');
  select op.* into v_op from public.exercise_state_publication_operations as op
    where op.exercise_id=p_exercise_id and op.operation_id=p_operation_id for update;
  if found then
    if v_op.operation_kind <> 'TERMINAL' or v_op.actor_user_id <> v_actor or v_op.request_hash <> v_hash then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    return query select p_exercise_id,v_op.result_revision,v_op.result_updated_at;
    return;
  end if;
  select req.* into v_request from public.runtime_completion_requests as req
    where req.exercise_id=p_exercise_id for share;
  if not found or v_request.status <> 'COMPLETED'
    or v_request.terminal_checkpoint_revision is distinct from p_expected_checkpoint_revision then
    raise exception 'TERMINAL_CHECKPOINT_INVALID' using errcode = '55000';
  end if;
  select checkpoint.* into v_checkpoint from public.runtime_checkpoints as checkpoint
    where checkpoint.exercise_id=p_exercise_id for share;
  if not found or v_checkpoint.checkpoint_revision <> p_expected_checkpoint_revision
    or public.exercise_lifecycle_from_state(v_checkpoint.payload->'payload') <> 'COMPLETED'
    or v_request.terminal_payload_hash is distinct from v_checkpoint.payload_hash then
    raise exception 'TERMINAL_CHECKPOINT_INVALID' using errcode = '55000';
  end if;
  select es.* into v_state from public.exercise_states as es where es.exercise_id=p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_state.revision <> p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
  v_terminal_state := v_checkpoint.payload->'payload';
  if v_state.state ? 'completedExerciseArchives' then
    v_terminal_state := pg_catalog.jsonb_set(v_terminal_state,'{completedExerciseArchives}',
      v_state.state->'completedExerciseArchives',true);
  end if;
  if public.exercise_lifecycle_from_state(v_state.state)='COMPLETED'
    and v_state.state=v_terminal_state then
    return query select p_exercise_id,v_state.revision,v_state.updated_at;
    return;
  end if;
  perform pg_catalog.set_config('russicaptor.terminal_finalize_command',v_request.command_id,true);
  update public.exercise_states as es set revision=v_state.revision+1,
    state=v_terminal_state,updated_at=v_now,updated_by=v_actor
    where es.exercise_id=p_exercise_id;
  insert into public.exercise_state_publication_operations
    (exercise_id,operation_id,operation_kind,request_hash,actor_user_id,result_revision,result_updated_at)
    values(p_exercise_id,p_operation_id,'TERMINAL',v_hash,v_actor,v_state.revision+1,v_now);
  return query select p_exercise_id,v_state.revision+1,v_now;
end;
$$;

create function public.append_completed_exercise_archive(
  p_exercise_id text, p_operation_id text, p_expected_revision bigint, p_archive jsonb
) returns table(exercise_id text, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_state public.exercise_states%rowtype;
  v_request public.runtime_completion_requests%rowtype;
  v_op public.exercise_state_publication_operations%rowtype;
  v_hash text;
  v_existing jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 200
    or p_expected_revision is null or p_expected_revision < 1
    or p_archive->>'exerciseId' is distinct from p_exercise_id then
    raise exception 'INVALID_EXERCISE_STATE' using errcode = '22023';
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('kind','ARCHIVE','expectedRevision',p_expected_revision,
      'archive',p_archive)::text,'UTF8')),'hex');
  select op.* into v_op from public.exercise_state_publication_operations as op
    where op.exercise_id=p_exercise_id and op.operation_id=p_operation_id for update;
  if found then
    if v_op.operation_kind <> 'ARCHIVE' or v_op.actor_user_id <> v_actor or v_op.request_hash <> v_hash then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    return query select p_exercise_id,v_op.result_revision,v_op.result_updated_at;
    return;
  end if;
  select req.* into v_request from public.runtime_completion_requests as req
    where req.exercise_id=p_exercise_id for share;
  if found and v_request.status <> 'COMPLETED' then
    raise exception 'PUBLICATION_FENCED' using errcode = '55000';
  end if;
  select es.* into v_state from public.exercise_states as es where es.exercise_id=p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_state.revision <> p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
  if public.exercise_lifecycle_from_state(v_state.state)<>'COMPLETED' then
    raise exception 'TERMINAL_STATE_REQUIRED' using errcode = '55000';
  end if;
  v_existing := v_state.state->'completedExerciseArchives';
  if v_existing is not null and v_existing <> '[]'::jsonb
    and v_existing <> pg_catalog.jsonb_build_array(p_archive) then
    raise exception 'ARCHIVE_CONFLICT' using errcode = '23505';
  end if;
  if v_existing = pg_catalog.jsonb_build_array(p_archive) then
    return query select p_exercise_id,v_state.revision,v_state.updated_at;
    return;
  end if;
  if v_request.exercise_id is not null then
    perform pg_catalog.set_config('russicaptor.terminal_finalize_command',v_request.command_id,true);
  end if;
  update public.exercise_states as es set revision=v_state.revision+1,
    state=pg_catalog.jsonb_set(v_state.state,'{completedExerciseArchives}',pg_catalog.jsonb_build_array(p_archive),true),
    updated_at=v_now,updated_by=v_actor where es.exercise_id=p_exercise_id;
  insert into public.exercise_state_publication_operations
    (exercise_id,operation_id,operation_kind,request_hash,actor_user_id,result_revision,result_updated_at)
    values(p_exercise_id,p_operation_id,'ARCHIVE',v_hash,v_actor,v_state.revision+1,v_now);
  return query select p_exercise_id,v_state.revision+1,v_now;
end;
$$;

revoke all on function public.create_initial_exercise_state(text,text,uuid,text,text,jsonb) from public, anon;
revoke all on function public.publish_exercise_state_current_writer(text,text,uuid,text,bigint,jsonb) from public, anon;
revoke all on function public.reconcile_terminal_exercise_state(text,text,bigint,bigint) from public, anon;
revoke all on function public.append_completed_exercise_archive(text,text,bigint,jsonb) from public, anon;
grant execute on function public.create_initial_exercise_state(text,text,uuid,text,text,jsonb) to authenticated;
grant execute on function public.publish_exercise_state_current_writer(text,text,uuid,text,bigint,jsonb) to authenticated;
grant execute on function public.reconcile_terminal_exercise_state(text,text,bigint,bigint) to authenticated;
grant execute on function public.append_completed_exercise_archive(text,text,bigint,jsonb) to authenticated;

-- Keep scoped SELECT policies; no authenticated table mutation is permitted.
drop policy if exists "excon creates exercise state" on public.exercise_states;
drop policy if exists "excon updates exercise state" on public.exercise_states;
drop policy if exists "scoped operators create exercise state" on public.exercise_states;
drop policy if exists "scoped operators update exercise state" on public.exercise_states;
drop policy if exists "authenticated users can create exercise state" on public.exercise_states;
drop policy if exists "authenticated users can update exercise state" on public.exercise_states;
revoke insert, update, delete on public.exercise_states from public, anon, authenticated;

-- The historical service-only recovery fixture predates one-shot READY
-- bootstrap. Replace only that test helper: it now creates READY through the
-- production RPC, transitions through a real writer, then releases the lease.
-- No application caller receives EXECUTE on this helper.
drop function public.create_runtime_recovery_acceptance_fixture();
create function public.create_runtime_recovery_acceptance_fixture(p_fixture_key text default 'DEFAULT')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_exercise_id text;
  v_latest_lifecycle text;
  v_bootstrap public.exercise_bootstrap_authorizations%rowtype;
  v_lease_id uuid;
  v_writer_instance_id text;
  v_ready jsonb;
  v_running jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or p_fixture_key is null or length(p_fixture_key) not between 1 and 80 then
    raise exception 'INVALID_RECOVERY_FIXTURE_REQUEST' using errcode = '22023';
  end if;
  v_exercise_id := 'RUNTIME-RECOVERY-ACCEPTANCE-' ||
    pg_catalog.md5(v_actor::text || E'\n' || p_fixture_key);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('RUNTIME_RECOVERY_FIXTURE' || E'\n' || v_exercise_id,0));
  if exists(select 1 from public.runtime_recovery_acceptance_fixture_audit
    where exercise_id=v_exercise_id) then
    if not exists(select 1 from public.exercise_states where exercise_id=v_exercise_id) then
      raise exception 'FIXTURE_STATE_MISSING' using errcode = '55000';
    end if;
    return v_exercise_id;
  end if;
  if exists(select 1 from public.exercise_states where exercise_id=v_exercise_id) then
    raise exception 'FIXTURE_STATE_CONFLICT' using errcode = '23505';
  end if;
  select coalesce(state->'exerciseSession'->>'lifecycleState',
    case state->'exerciseSession'->>'state' when 'running' then 'RUNNING'
      when 'paused' then 'PAUSED' else 'READY' end)
    into v_latest_lifecycle from public.exercise_states order by updated_at desc limit 1;
  if v_latest_lifecycle in ('RUNNING','PAUSED') then
    raise exception 'ACTIVE_EXERCISE_PRESENT' using errcode = '55000';
  end if;
  v_bootstrap := public.trusted_admin_grant_exercise_bootstrap(
    v_actor,v_actor,v_now+interval '14 minutes','RUNTIME_RECOVERY_ACCEPTANCE_FIXTURE');
  v_ready := pg_catalog.jsonb_build_object(
    'exerciseSession',pg_catalog.jsonb_build_object(
      'exerciseId',v_exercise_id,'lifecycleState','READY','simulationTimeSec',0,
      'speed',1,'version',1,'lastCommandId','PREPARE-'||v_exercise_id),
    'exercisePackageReference',pg_catalog.jsonb_build_object(
      'packageId','russicaptor.narva-trauma','packageVersion','1.0.5'),
    'patients','[]'::jsonb,'assignments','[]'::jsonb,
    'completedExerciseArchives','[]'::jsonb);
  perform public.create_initial_exercise_state(
    v_exercise_id,'RECOVERY-FIXTURE-READY-'||p_fixture_key,v_bootstrap.id,
    'russicaptor.narva-trauma','1.0.5',v_ready);
  perform public.trusted_admin_grant_exercise_role(
    v_actor,v_exercise_id,'EXCON',v_actor,null);
  v_writer_instance_id := 'RECOVERY-FIXTURE-' || pg_catalog.md5(v_exercise_id);
  select writer.lease_id into v_lease_id from public.acquire_runtime_writer(
    v_exercise_id,v_writer_instance_id,0,60) as writer;
  v_running := pg_catalog.jsonb_set(v_ready,'{exerciseSession,lifecycleState}',
    '"RUNNING"'::jsonb,true);
  perform public.publish_exercise_state_current_writer(
    v_exercise_id,'RECOVERY-FIXTURE-START-'||p_fixture_key,v_lease_id,
    v_writer_instance_id,1,v_running);
  perform public.release_runtime_writer(v_lease_id,v_writer_instance_id);
  insert into public.runtime_recovery_acceptance_fixture_audit(exercise_id,created_by)
    values(v_exercise_id,current_user);
  return v_exercise_id;
end;
$$;
revoke all on function public.create_runtime_recovery_acceptance_fixture(text)
  from public, anon, authenticated;
grant execute on function public.create_runtime_recovery_acceptance_fixture(text) to service_role;
