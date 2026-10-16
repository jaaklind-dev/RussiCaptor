-- An unused READY exercise is not a completed clinical exercise. Cancellation
-- retains its canonical row and package provenance but closes every writer and
-- patient-mutation path. The Admin Edge Function is the sole caller of the
-- bounded service-role RPC below.

alter table public.exercise_state_publication_operations
  drop constraint exercise_state_publication_operations_operation_kind_check;
alter table public.exercise_state_publication_operations
  add constraint exercise_state_publication_operations_operation_kind_check
  check (operation_kind in ('READY','ACTIVE','TERMINAL','ARCHIVE','CANCEL'));

alter table public.administrative_action_audit
  drop constraint administrative_action_audit_action_check;
alter table public.administrative_action_audit
  add constraint administrative_action_audit_action_check check (action in (
    'USER_INVITED', 'PASSWORD_RESET_REQUESTED', 'USER_DEACTIVATED',
    'USER_REACTIVATED', 'EXERCISE_BOOTSTRAP_GRANTED',
    'EXERCISE_BOOTSTRAP_REVOKED', 'CM_GRANTED', 'EXCON_GRANTED',
    'CM_REVOKED', 'EXCON_REVOKED',
    'PLATFORM_ADMIN_GRANTED', 'PLATFORM_ADMIN_REVOKED',
    'EXERCISE_READY_CANCELLED',
    'READY_CANCELLATION_ENABLED', 'READY_CANCELLATION_DISABLED'
  ));

-- Deployment is intentionally inert. A database deployment administrator must
-- explicitly enable this one feature after compatible clients are in place.
-- The service role may read the status for the Admin UI, but cannot change it.
create table public.ready_exercise_cancellation_activation (
  feature_key text primary key check (feature_key = 'READY_CANCELLATION'),
  enabled boolean not null default false,
  changed_at timestamptz not null default clock_timestamp(),
  change_reference text not null check (change_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,119}$')
);
insert into public.ready_exercise_cancellation_activation
  (feature_key, enabled, change_reference)
values ('READY_CANCELLATION', false, 'MIGRATION_DEFAULT_OFF');
alter table public.ready_exercise_cancellation_activation enable row level security;
revoke all on table public.ready_exercise_cancellation_activation
  from public,anon,authenticated,service_role;
grant select on table public.ready_exercise_cancellation_activation to service_role;

-- This is a database-deployment operation, not an application Admin/EXCON
-- capability. It uses the table row lock that cancellation reads FOR SHARE, so
-- an ON/OFF transition and an in-flight cancellation have one commit order.
-- A repeated request for the existing value is a read-only, idempotent result.
create function public.set_ready_exercise_cancellation_activation(
  p_enabled boolean, p_change_reference text
)
returns table(enabled boolean, changed boolean, changed_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  v_gate public.ready_exercise_cancellation_activation%rowtype;
  v_now timestamptz;
begin
  if p_enabled is null or p_change_reference is null
    or p_change_reference <> btrim(p_change_reference)
    or p_change_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,119}$' then
    raise exception 'INVALID_ACTIVATION_REQUEST' using errcode = '22023';
  end if;
  select gate.* into v_gate from public.ready_exercise_cancellation_activation as gate
    where gate.feature_key = 'READY_CANCELLATION' for update;
  if not found then
    raise exception 'READY_CANCELLATION_GATE_UNAVAILABLE' using errcode = '55000';
  end if;
  if v_gate.enabled = p_enabled then
    return query select v_gate.enabled,false,v_gate.changed_at;
    return;
  end if;
  v_now := clock_timestamp();
  update public.ready_exercise_cancellation_activation as gate
    set enabled = p_enabled, changed_at = v_now,
      change_reference = p_change_reference
    where gate.feature_key = 'READY_CANCELLATION';
  insert into public.administrative_action_audit
    (actor_user_id,action,outcome,details,occurred_at)
    values (null,
      case when p_enabled then 'READY_CANCELLATION_ENABLED'
        else 'READY_CANCELLATION_DISABLED' end,
      'SUCCESS',pg_catalog.jsonb_build_object(
        'mechanism','DATABASE_DEPLOYMENT_OPERATOR',
        'databaseRole',current_user,
        'changeReference',p_change_reference,
        'previousEnabled',v_gate.enabled,
        'enabled',p_enabled),v_now);
  return query select p_enabled,true,v_now;
end;
$$;
revoke all on function public.set_ready_exercise_cancellation_activation(boolean,text)
  from public,anon,authenticated,service_role;

create function public.trusted_admin_cancel_ready_exercise(
  p_exercise_id text, p_expected_revision bigint, p_operation_id uuid,
  p_reason text, p_actor_user_id uuid
)
returns table(exercise_id text, revision bigint, lifecycle_state text,
  cancelled_at timestamptz, idempotent boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.platform_admins%rowtype;
  v_state public.exercise_states%rowtype;
  v_lease public.runtime_writer_leases%rowtype;
  v_op public.exercise_state_publication_operations%rowtype;
  v_now timestamptz;
  v_hash text;
  v_next jsonb;
  v_activation_enabled boolean;
begin
  if p_exercise_id is null or p_exercise_id <> btrim(p_exercise_id)
    or length(p_exercise_id) not between 1 and 160
    or p_expected_revision is null or p_expected_revision < 1
    or p_operation_id is null or p_actor_user_id is null or p_reason is null
    or p_reason not in ('UNUSED_READY','FAILED_START','TEST_CLEANUP') then
    raise exception 'INVALID_CANCELLATION_REQUEST' using errcode = '22023';
  end if;
  select admin.* into v_actor from public.platform_admins as admin
    join public.operator_profiles as profile on profile.user_id = admin.user_id
    join auth.users as person on person.id = admin.user_id
    where admin.user_id = p_actor_user_id and admin.status = 'ACTIVE'
      and profile.status = 'ACTIVE' and not person.is_anonymous
      and (person.banned_until is null or person.banned_until <= clock_timestamp());
  if not found then raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode = '42501'; end if;

  -- Check before the old-operation receipt path: while OFF, even an exact
  -- retry must fail, and no state, receipt, or cancellation audit is written.
  -- Hold the shared row lock until commit. An activation UPDATE takes the
  -- exclusive lock, so it cannot overtake this cancellation transaction.
  select gate.enabled into v_activation_enabled
    from public.ready_exercise_cancellation_activation as gate
    where gate.feature_key = 'READY_CANCELLATION' for share;
  if v_activation_enabled is distinct from true then
    raise exception 'READY_CANCELLATION_DISABLED' using errcode = '55000';
  end if;

  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('kind','CANCEL','exerciseId',p_exercise_id,
      'expectedRevision',p_expected_revision,'reason',p_reason)::text,'UTF8')),'hex');
  -- This is the same per-exercise lock taken by acquire_runtime_writer before
  -- its lease/checkpoint/state locks. One of acquisition or cancellation wins.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_exercise_id,7621));
  select op.* into v_op from public.exercise_state_publication_operations as op
    where op.exercise_id = p_exercise_id and op.operation_id = p_operation_id::text for update;
  if found then
    if v_op.operation_kind <> 'CANCEL' or v_op.actor_user_id <> p_actor_user_id
      or v_op.request_hash <> v_hash then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    return query select p_exercise_id,v_op.result_revision,'CANCELLED'::text,
      v_op.result_updated_at,true;
    return;
  end if;

  select lease.* into v_lease from public.runtime_writer_leases as lease
    where lease.exercise_id = p_exercise_id for update;
  -- Match the writer-acquire lock order even when no checkpoint exists.
  perform 1 from public.runtime_checkpoints as checkpoint
    where checkpoint.exercise_id = p_exercise_id for update;
  select es.* into v_state from public.exercise_states as es
    where es.exercise_id = p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_state.revision <> p_expected_revision then
    raise exception 'REVISION_CONFLICT' using errcode = '40001';
  end if;
  if public.exercise_lifecycle_from_state(v_state.state) <> 'READY' then
    raise exception 'EXERCISE_NOT_READY' using errcode = '55000';
  end if;
  v_now := clock_timestamp();
  if v_lease.exercise_id is not null and v_lease.released_at is null
    and v_lease.expires_at > v_now then
    raise exception 'ACTIVE_WRITER_PRESENT' using errcode = '55000';
  end if;
  if exists(select 1 from public.runtime_checkpoints as checkpoint where checkpoint.exercise_id = p_exercise_id)
    or exists(select 1 from public.runtime_completion_requests as completion where completion.exercise_id = p_exercise_id)
    or exists(select 1 from public.shared_workflow_patient_states as patient where patient.exercise_id = p_exercise_id)
    or exists(select 1 from public.shared_workflow_commands as command where command.exercise_id = p_exercise_id)
    or exists(select 1 from public.runtime_patient_commands as command where command.exercise_id = p_exercise_id)
    or exists(select 1 from public.runtime_patient_command_notifications as notice where notice.exercise_id = p_exercise_id)
    or exists(select 1 from public.shared_workflow_notifications as notice where notice.exercise_id = p_exercise_id) then
    raise exception 'RUNTIME_ACTIVITY_PRESENT' using errcode = '55000';
  end if;

  -- An expired, not-yet-released lease is historical, not authority. Close it
  -- without deleting its generation or acquisition audit.
  if v_lease.exercise_id is not null and v_lease.released_at is null then
    update public.runtime_writer_leases as lease set released_at = v_now
      where lease.exercise_id = p_exercise_id;
  end if;
  v_next := pg_catalog.jsonb_set(v_state.state,
    '{exerciseSession,lifecycleState}','"CANCELLED"'::jsonb,false);
  v_next := pg_catalog.jsonb_set(v_next,'{exerciseSession,version}',
    pg_catalog.to_jsonb(v_state.revision + 1),false);
  v_next := pg_catalog.jsonb_set(v_next,'{exerciseSession,lastCommandId}',
    pg_catalog.to_jsonb('CANCEL-' || p_operation_id::text),true);
  v_next := pg_catalog.jsonb_set(v_next,'{exerciseSession,updatedAtWallClock}',
    pg_catalog.to_jsonb(v_now::text),true);
  update public.exercise_states as es set revision = v_state.revision + 1,
    state = v_next, updated_at = v_now, updated_by = p_actor_user_id
    where es.exercise_id = p_exercise_id and es.revision = p_expected_revision;
  if not found then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
  insert into public.exercise_state_publication_operations
    (exercise_id,operation_id,operation_kind,request_hash,actor_user_id,
      result_revision,result_updated_at)
    values (p_exercise_id,p_operation_id::text,'CANCEL',v_hash,p_actor_user_id,
      v_state.revision + 1,v_now);
  insert into public.administrative_action_audit
    (actor_user_id,action,exercise_id,outcome,details,occurred_at)
    values (p_actor_user_id,'EXERCISE_READY_CANCELLED',p_exercise_id,'SUCCESS',
      pg_catalog.jsonb_build_object('operationId',p_operation_id,
        'reason',p_reason,'previousRevision',v_state.revision,
        'resultRevision',v_state.revision + 1),v_now);
  return query select p_exercise_id,v_state.revision + 1,'CANCELLED'::text,v_now,false;
end;
$$;
revoke all on function public.trusted_admin_cancel_ready_exercise(text,bigint,uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.trusted_admin_cancel_ready_exercise(text,bigint,uuid,text,uuid)
  to service_role;

-- A new active lease must never be created or renewed for a terminal exercise.
-- This trigger protects the row boundary even if a future acquire path changes.
create function public.guard_terminal_runtime_writer_lease()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_lifecycle text;
begin
  if new.released_at is null and new.expires_at > clock_timestamp() then
    select public.exercise_lifecycle_from_state(es.state) into v_lifecycle
      from public.exercise_states as es where es.exercise_id = new.exercise_id
      for update;
    if v_lifecycle is null or v_lifecycle not in ('READY','RUNNING','PAUSED') then
      raise exception 'EXERCISE_TERMINAL' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_terminal_runtime_writer_lease
  before insert or update on public.runtime_writer_leases
  for each row execute function public.guard_terminal_runtime_writer_lease();
revoke all on function public.guard_terminal_runtime_writer_lease()
  from public,anon,authenticated;

-- A READY cancellation is forbidden once any workflow head exists. This
-- complementary guard closes an old COMPLETED-only patient mutation path.
create function public.guard_cancelled_shared_workflow_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_lifecycle text;
begin
  select public.exercise_lifecycle_from_state(es.state) into v_lifecycle
    from public.exercise_states as es where es.exercise_id = new.exercise_id
    for update;
  if v_lifecycle = 'CANCELLED' then
    raise exception 'EXERCISE_TERMINAL' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger guard_cancelled_shared_workflow_mutation
  before insert or update on public.shared_workflow_patient_states
  for each row execute function public.guard_cancelled_shared_workflow_mutation();
revoke all on function public.guard_cancelled_shared_workflow_mutation()
  from public,anon,authenticated;

-- Do not let the administrative role RPC grant fresh authority to a terminal
-- row. The EXCON/CM revocation RPC remains available for separate cleanup.
create or replace function public.trusted_admin_grant_exercise_role(
  p_user_id uuid,p_exercise_id text,p_role text,p_issued_by uuid,
  p_expires_at timestamptz default null
) returns public.authorization_role_assignments
language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.authorization_role_assignments%rowtype;
  v_state public.exercise_states%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null or p_issued_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  if p_exercise_id is null or p_exercise_id <> btrim(p_exercise_id)
    or length(p_exercise_id) not between 1 and 160 then
    raise exception 'INVALID_EXERCISE_IDENTIFIER' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('CM','EXCON') then
    raise exception 'UNSUPPORTED_EXERCISE_ROLE' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'INVALID_ASSIGNMENT_EXPIRY' using errcode = '22023';
  end if;
  -- The state lock serializes a grant with cancellation; neither can observe
  -- READY and then commit a grant after the other makes it terminal.
  select es.* into v_state from public.exercise_states as es
    where es.exercise_id = p_exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.exercise_lifecycle_from_state(v_state.state) in ('COMPLETED','CANCELLED','TERMINATED') then
    raise exception 'TERMINAL_EXERCISE_READ_ONLY' using errcode = '55000';
  end if;
  if not exists (
    select 1 from auth.users as target_user
    join public.operator_profiles as target_profile on target_profile.user_id = target_user.id
    where target_user.id = p_user_id and not target_user.is_anonymous
      and (target_user.banned_until is null or target_user.banned_until <= v_now)
      and target_profile.status = 'ACTIVE'
  ) then raise exception 'TARGET_OPERATOR_NOT_ACTIVE' using errcode = '22023'; end if;
  if not exists (
    select 1 from auth.users as issuer where issuer.id = p_issued_by
      and not issuer.is_anonymous
      and (issuer.banned_until is null or issuer.banned_until <= v_now)
  ) then raise exception 'INVALID_ISSUER' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_user_id::text || E'\n' || p_role || E'\nEXERCISE\n' || p_exercise_id,0));
  update public.authorization_role_assignments
    set status = 'REVOKED',revoked_at = v_now,revoked_by = p_issued_by
    where user_id = p_user_id and role = p_role and scope_type = 'EXERCISE'
      and scope_id = p_exercise_id and status = 'ACTIVE'
      and expires_at is not null and expires_at <= v_now;
  select assignment.* into v_assignment from public.authorization_role_assignments as assignment
    where assignment.user_id = p_user_id and assignment.role = p_role
      and assignment.scope_type = 'EXERCISE' and assignment.scope_id = p_exercise_id
      and assignment.status = 'ACTIVE' for update;
  if found then
    if v_assignment.expires_at is distinct from p_expires_at then
      raise exception 'ACTIVE_ASSIGNMENT_CONFLICT' using errcode = '23505';
    end if;
    return v_assignment;
  end if;
  insert into public.authorization_role_assignments
    (user_id,role,scope_type,scope_id,status,issued_at,expires_at,issued_by)
    values (p_user_id,p_role,'EXERCISE',p_exercise_id,'ACTIVE',v_now,p_expires_at,p_issued_by)
    returning * into v_assignment;
  return v_assignment;
end;
$$;
revoke all on function public.trusted_admin_grant_exercise_role(uuid,text,text,uuid,timestamptz)
  from public,anon,authenticated;

-- acquire_runtime_writer already takes the advisory lock, then lease and
-- checkpoint locks. Add the canonical state check in that same transaction.
create or replace function public.acquire_runtime_writer(
  p_exercise_id text,p_writer_instance_id text,p_expected_revision bigint,
  p_lease_seconds integer default 60
) returns table(lease_id uuid,user_id uuid,expires_at timestamptz,
  checkpoint_revision bigint,already_owned boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_lease public.runtime_writer_leases%rowtype;
  v_revision bigint;
  v_lifecycle text;
  v_now timestamptz;
  v_had_lease boolean;
begin
  if (select auth.uid()) is null or p_exercise_id is null or length(p_exercise_id)=0
    or p_lease_seconds not between 15 and 300 then
    raise exception 'WRITER_AUTHORITY_UNAVAILABLE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_exercise_id,7621));
  select lease.* into v_lease from public.runtime_writer_leases as lease
    where lease.exercise_id = p_exercise_id for update;
  v_had_lease := found;
  select checkpoint.checkpoint_revision into v_revision
    from public.runtime_checkpoints as checkpoint
    where checkpoint.exercise_id = p_exercise_id for update;
  v_revision := coalesce(v_revision,0);
  if v_revision <> p_expected_revision then raise exception 'CHECKPOINT_REVISION_CONFLICT'; end if;
  select public.exercise_lifecycle_from_state(es.state) into v_lifecycle
    from public.exercise_states as es where es.exercise_id = p_exercise_id for update;
  if v_lifecycle is null or v_lifecycle not in ('READY','RUNNING','PAUSED') then
    raise exception 'EXERCISE_TERMINAL' using errcode = '55000';
  end if;
  v_now := clock_timestamp();
  if v_had_lease and v_lease.released_at is null and v_lease.expires_at > v_now then
    if v_lease.writer_instance_id <> p_writer_instance_id
      or v_lease.writer_user_id <> (select auth.uid()) then
      raise exception 'WRITER_AUTHORITY_HELD';
    end if;
    update public.runtime_writer_leases as lease
      set refreshed_at = v_now,expires_at = v_now + make_interval(secs => p_lease_seconds)
      where lease.exercise_id = p_exercise_id returning * into v_lease;
    return query select v_lease.lease_id,v_lease.writer_user_id,v_lease.expires_at,v_revision,true;
    return;
  end if;
  insert into public.runtime_writer_leases
    (exercise_id,lease_id,writer_instance_id,writer_user_id,
      acquired_at,refreshed_at,expires_at,released_at)
    values (p_exercise_id,gen_random_uuid(),p_writer_instance_id,(select auth.uid()),
      v_now,v_now,v_now + make_interval(secs => p_lease_seconds),null)
    on conflict(exercise_id) do update set
      lease_id=excluded.lease_id,writer_instance_id=excluded.writer_instance_id,
      writer_user_id=excluded.writer_user_id,acquired_at=excluded.acquired_at,
      refreshed_at=excluded.refreshed_at,expires_at=excluded.expires_at,released_at=null
    returning * into v_lease;
  insert into public.runtime_checkpoint_authority_audit
    (exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
    values(p_exercise_id,v_revision,
      case when v_had_lease then 'WRITER_TAKEOVER' else 'WRITER_ACQUIRED' end,
      p_writer_instance_id,(select auth.uid()));
  return query select v_lease.lease_id,v_lease.writer_user_id,v_lease.expires_at,v_revision,false;
end;
$$;
revoke all on function public.acquire_runtime_writer(text,text,bigint,integer) from public,anon;
grant execute on function public.acquire_runtime_writer(text,text,bigint,integer) to authenticated;
