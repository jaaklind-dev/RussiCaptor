-- An explicit EXCON takeover is different from ordinary acquisition: it
-- replaces an active lease without modifying the canonical checkpoint.
alter table public.runtime_writer_leases
  add column writer_generation bigint not null default 1
  check (writer_generation > 0);

-- Every new lease identity (including an ordinary reacquisition after expiry)
-- advances the generation. Renewals and releases retain the generation.
create function public.advance_runtime_writer_generation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.lease_id is distinct from old.lease_id then
    new.writer_generation := old.writer_generation + 1;
  else
    new.writer_generation := old.writer_generation;
  end if;
  return new;
end;
$$;
create trigger runtime_writer_generation_advance
  before update on public.runtime_writer_leases
  for each row execute function public.advance_runtime_writer_generation();
revoke all on function public.advance_runtime_writer_generation() from public, anon, authenticated;

-- Preserve ordinary acquire's revision and active-writer decisions while
-- aligning its lock order with every publication and explicit takeover:
-- lease first, checkpoint second. The advisory lock also serializes initial
-- acquisitions before a lease row exists.
create or replace function public.acquire_runtime_writer(
  p_exercise_id text, p_writer_instance_id text, p_expected_revision bigint,
  p_lease_seconds integer default 60
) returns table (lease_id uuid, user_id uuid, expires_at timestamptz,
  checkpoint_revision bigint, already_owned boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_lease public.runtime_writer_leases%rowtype;
  v_revision bigint;
  v_now timestamptz;
  v_had_lease boolean;
begin
  if (select auth.uid()) is null or p_exercise_id is null or length(p_exercise_id) = 0
    or p_lease_seconds not between 15 and 300 then
    raise exception 'WRITER_AUTHORITY_UNAVAILABLE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_exercise_id, 7621));
  select lease.* into v_lease from public.runtime_writer_leases lease
    where lease.exercise_id = p_exercise_id for update;
  v_had_lease := found;
  select checkpoint.checkpoint_revision into v_revision from public.runtime_checkpoints checkpoint
    where checkpoint.exercise_id = p_exercise_id for update;
  v_revision := coalesce(v_revision, 0);
  if v_revision <> p_expected_revision then raise exception 'CHECKPOINT_REVISION_CONFLICT'; end if;
  v_now := clock_timestamp();
  if v_had_lease and v_lease.released_at is null and v_lease.expires_at > v_now then
    if v_lease.writer_instance_id <> p_writer_instance_id or v_lease.writer_user_id <> (select auth.uid()) then
      raise exception 'WRITER_AUTHORITY_HELD';
    end if;
    update public.runtime_writer_leases lease
      set refreshed_at = v_now, expires_at = v_now + make_interval(secs => p_lease_seconds)
      where lease.exercise_id = p_exercise_id returning * into v_lease;
    return query select v_lease.lease_id, v_lease.writer_user_id, v_lease.expires_at, v_revision, true;
    return;
  end if;
  insert into public.runtime_writer_leases
    (exercise_id, lease_id, writer_instance_id, writer_user_id,
      acquired_at, refreshed_at, expires_at, released_at)
    values (p_exercise_id, gen_random_uuid(), p_writer_instance_id, (select auth.uid()),
      v_now, v_now, v_now + make_interval(secs => p_lease_seconds), null)
    on conflict (exercise_id) do update set
      lease_id = excluded.lease_id, writer_instance_id = excluded.writer_instance_id,
      writer_user_id = excluded.writer_user_id, acquired_at = excluded.acquired_at,
      refreshed_at = excluded.refreshed_at, expires_at = excluded.expires_at, released_at = null
    returning * into v_lease;
  insert into public.runtime_checkpoint_authority_audit
    (exercise_id, checkpoint_revision, event_type, writer_instance_id, user_id)
    values (p_exercise_id, v_revision,
      case when v_had_lease then 'WRITER_TAKEOVER' else 'WRITER_ACQUIRED' end,
      p_writer_instance_id, (select auth.uid()));
  return query select v_lease.lease_id, v_lease.writer_user_id, v_lease.expires_at, v_revision, false;
end;
$$;

-- The caller must observe the exact current lease before asking to replace it.
-- The takeover RPC then uses that lease ID as a compare-and-swap token.
create function public.read_runtime_writer_takeover_target(p_exercise_id text)
returns table (
  prior_lease_id uuid, prior_writer_instance_id text, prior_writer_generation bigint
)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_lease public.runtime_writer_leases%rowtype;
begin
  if v_actor is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
    or p_exercise_id is null or length(p_exercise_id) = 0
    or not public.has_authorization_permission('EXCON_EXERCISE_CONTROL', p_exercise_id)
    or not exists (
      select 1 from public.authorization_role_assignments assignment
      where assignment.user_id = v_actor and assignment.role = 'EXCON'
        and assignment.scope_type = 'EXERCISE' and assignment.scope_id = p_exercise_id
        and assignment.status = 'ACTIVE'
        and (assignment.expires_at is null or assignment.expires_at > now())
    ) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  select lease.* into v_lease from public.runtime_writer_leases lease
    where lease.exercise_id = p_exercise_id;
  if not found or v_lease.released_at is not null or v_lease.expires_at <= clock_timestamp() then
    raise exception 'WRITER_NOT_PRESENT' using errcode = '55000';
  end if;
  return query select v_lease.lease_id, v_lease.writer_instance_id, v_lease.writer_generation;
end;
$$;

create function public.takeover_runtime_writer(
  p_exercise_id text, p_writer_instance_id text, p_expected_prior_lease_id uuid,
  p_lease_seconds integer default 60
) returns table (
  exercise_id text, writer_instance_id text, lease_id uuid, user_id uuid,
  writer_generation bigint, prior_writer_instance_id text,
  checkpoint_revision bigint, checkpoint_payload_hash text,
  expires_at timestamptz, takeover_occurred boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_lease public.runtime_writer_leases%rowtype;
  v_checkpoint public.runtime_checkpoints%rowtype;
  v_state public.exercise_states%rowtype;
  v_prior_writer text;
  v_now timestamptz;
begin
  if v_actor is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
    or not public.has_authorization_permission('EXCON_EXERCISE_CONTROL', p_exercise_id)
    or not exists (
      select 1 from public.authorization_role_assignments assignment
      where assignment.user_id = v_actor and assignment.role = 'EXCON'
        and assignment.scope_type = 'EXERCISE' and assignment.scope_id = p_exercise_id
        and assignment.status = 'ACTIVE'
        and (assignment.expires_at is null or assignment.expires_at > now())
    ) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_exercise_id is null or length(p_exercise_id) = 0
    or p_writer_instance_id is null or length(p_writer_instance_id) not between 1 and 200
    or p_expected_prior_lease_id is null or p_lease_seconds not between 15 and 300 then
    raise exception 'TAKEOVER_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- All checkpoint publication paths lock the lease before the checkpoint.
  -- Thus either A's publication commits first and its revision is returned,
  -- or this lease replacement commits first and A becomes stale.
  select lease.* into v_lease from public.runtime_writer_leases lease
    where lease.exercise_id = p_exercise_id for update;
  if not found then raise exception 'WRITER_NOT_PRESENT' using errcode = '55000'; end if;
  v_now := clock_timestamp();
  if v_lease.released_at is not null or v_lease.expires_at <= v_now then
    raise exception 'WRITER_NOT_PRESENT' using errcode = '55000';
  end if;
  if v_lease.writer_instance_id = p_writer_instance_id and v_lease.writer_user_id = v_actor then
    select checkpoint.* into v_checkpoint from public.runtime_checkpoints checkpoint
      where checkpoint.exercise_id = p_exercise_id for share;
    return query select p_exercise_id, v_lease.writer_instance_id, v_lease.lease_id,
      v_lease.writer_user_id, v_lease.writer_generation, null::text,
      v_checkpoint.checkpoint_revision, v_checkpoint.payload_hash,
      v_lease.expires_at, false;
    return;
  end if;
  if v_lease.lease_id <> p_expected_prior_lease_id then
    raise exception 'TAKEOVER_CONCURRENT_CONFLICT' using errcode = '40001';
  end if;
  v_prior_writer := v_lease.writer_instance_id;
  select checkpoint.* into v_checkpoint from public.runtime_checkpoints checkpoint
    where checkpoint.exercise_id = p_exercise_id for share;
  if not found then raise exception 'TAKEOVER_NOT_ALLOWED' using errcode = '55000'; end if;
  select state.* into v_state from public.exercise_states state
    where state.exercise_id = p_exercise_id for share;
  if not found then raise exception 'EXERCISE_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.exercise_lifecycle_from_state(v_state.state) not in ('RUNNING','PAUSED')
    or public.exercise_lifecycle_from_state(v_checkpoint.payload->'payload') = 'COMPLETED' then
    raise exception 'INVALID_EXERCISE_STATE' using errcode = '55000';
  end if;
  update public.runtime_writer_leases lease
    set lease_id = gen_random_uuid(), writer_instance_id = p_writer_instance_id,
      writer_user_id = v_actor, acquired_at = v_now, refreshed_at = v_now,
      expires_at = v_now + make_interval(secs => p_lease_seconds), released_at = null
    where lease.exercise_id = p_exercise_id returning * into v_lease;
  insert into public.runtime_checkpoint_authority_audit
    (exercise_id, checkpoint_revision, event_type, writer_instance_id, user_id, details)
    values (p_exercise_id, v_checkpoint.checkpoint_revision, 'WRITER_TAKEOVER',
      p_writer_instance_id, v_actor,
      pg_catalog.jsonb_build_object('priorWriterInstanceId', v_prior_writer,
        'priorLeaseId', p_expected_prior_lease_id, 'writerGeneration', v_lease.writer_generation));
  return query select p_exercise_id, v_lease.writer_instance_id, v_lease.lease_id,
    v_lease.writer_user_id, v_lease.writer_generation, v_prior_writer,
    v_checkpoint.checkpoint_revision, v_checkpoint.payload_hash,
    v_lease.expires_at, true;
end;
$$;

revoke all on function public.read_runtime_writer_takeover_target(text) from public, anon;
revoke all on function public.takeover_runtime_writer(text,text,uuid,integer) from public, anon;
grant execute on function public.read_runtime_writer_takeover_target(text) to authenticated;
grant execute on function public.takeover_runtime_writer(text,text,uuid,integer) to authenticated;
