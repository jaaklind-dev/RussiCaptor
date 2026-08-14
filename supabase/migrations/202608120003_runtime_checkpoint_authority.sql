-- WP-44B: atomic canonical Runtime checkpoint CAS and expiring writer authority.
create table if not exists public.runtime_checkpoints (
  exercise_id text primary key,
  checkpoint_revision bigint not null check (checkpoint_revision > 0),
  persisted_runtime_version integer not null check (persisted_runtime_version > 0),
  payload_hash text not null,
  provenance_hash text not null,
  payload jsonb not null,
  writer_instance_id text not null,
  writer_user_id uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  check ((payload->>'exerciseId') = exercise_id),
  check ((payload->>'checkpointRevision')::bigint = checkpoint_revision),
  check ((payload->>'payloadHash') = payload_hash),
  check ((payload->>'provenanceHash') = provenance_hash)
);

create table if not exists public.runtime_writer_leases (
  exercise_id text primary key,
  lease_id uuid not null unique default gen_random_uuid(),
  writer_instance_id text not null,
  writer_user_id uuid not null references auth.users(id),
  acquired_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  check (expires_at > acquired_at)
);

create table if not exists public.runtime_checkpoint_authority_audit (
  id bigint generated always as identity primary key,
  exercise_id text not null,
  checkpoint_revision bigint,
  event_type text not null check (event_type in (
    'WRITER_ACQUIRED','WRITER_RENEWED','WRITER_RELEASED','WRITER_TAKEOVER',
    'CHECKPOINT_PUBLISHED','STALE_WRITE_REJECTED','REVISION_DIVERGENCE'
  )),
  writer_instance_id text,
  user_id uuid references auth.users(id),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists runtime_checkpoint_authority_audit_exercise_idx
  on public.runtime_checkpoint_authority_audit (exercise_id, occurred_at desc);

alter table public.runtime_checkpoints enable row level security;
alter table public.runtime_writer_leases enable row level security;
alter table public.runtime_checkpoint_authority_audit enable row level security;

drop policy if exists "authenticated users read runtime checkpoints" on public.runtime_checkpoints;
create policy "authenticated users read runtime checkpoints" on public.runtime_checkpoints
  for select to authenticated using (true);
drop policy if exists "users read own runtime writer lease" on public.runtime_writer_leases;
create policy "users read own runtime writer lease" on public.runtime_writer_leases
  for select to authenticated using (writer_user_id = auth.uid());
drop policy if exists "users read own runtime authority audit" on public.runtime_checkpoint_authority_audit;
create policy "users read own runtime authority audit" on public.runtime_checkpoint_authority_audit
  for select to authenticated using (user_id = auth.uid());

-- No direct INSERT/UPDATE/DELETE policies: all writes must pass guarded RPCs.

create or replace function public.acquire_runtime_writer(
  p_exercise_id text, p_writer_instance_id text, p_expected_revision bigint,
  p_lease_seconds integer default 60
) returns table (lease_id uuid, user_id uuid, expires_at timestamptz, checkpoint_revision bigint, already_owned boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_lease public.runtime_writer_leases%rowtype; v_revision bigint; v_now timestamptz := clock_timestamp(); v_takeover boolean := false;
begin
  if auth.uid() is null then raise exception 'WRITER_AUTHORITY_UNAVAILABLE'; end if;
  if p_lease_seconds < 15 or p_lease_seconds > 300 then raise exception 'WRITER_AUTHORITY_UNAVAILABLE'; end if;
  select checkpoint.checkpoint_revision into v_revision from public.runtime_checkpoints checkpoint where checkpoint.exercise_id=p_exercise_id for update;
  v_revision := coalesce(v_revision,0);
  if v_revision <> p_expected_revision then raise exception 'CHECKPOINT_REVISION_CONFLICT'; end if;
  select * into v_lease from public.runtime_writer_leases where exercise_id=p_exercise_id for update;
  if found and v_lease.released_at is null and v_lease.expires_at > v_now then
    if v_lease.writer_instance_id <> p_writer_instance_id or v_lease.writer_user_id <> auth.uid() then raise exception 'WRITER_AUTHORITY_HELD'; end if;
    update public.runtime_writer_leases set refreshed_at=v_now, expires_at=v_now+make_interval(secs=>p_lease_seconds)
      where exercise_id=p_exercise_id returning * into v_lease;
    return query select v_lease.lease_id, v_lease.writer_user_id, v_lease.expires_at, v_revision, true; return;
  end if;
  v_takeover := found;
  insert into public.runtime_writer_leases(exercise_id,lease_id,writer_instance_id,writer_user_id,acquired_at,refreshed_at,expires_at,released_at)
    values(p_exercise_id,gen_random_uuid(),p_writer_instance_id,auth.uid(),v_now,v_now,v_now+make_interval(secs=>p_lease_seconds),null)
    on conflict(exercise_id) do update set lease_id=excluded.lease_id,writer_instance_id=excluded.writer_instance_id,
      writer_user_id=excluded.writer_user_id,acquired_at=excluded.acquired_at,refreshed_at=excluded.refreshed_at,
      expires_at=excluded.expires_at,released_at=null returning * into v_lease;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
    values(p_exercise_id,v_revision,case when v_takeover then 'WRITER_TAKEOVER' else 'WRITER_ACQUIRED' end,p_writer_instance_id,auth.uid());
  return query select v_lease.lease_id,v_lease.writer_user_id,v_lease.expires_at,v_revision,false;
end $$;

create or replace function public.renew_runtime_writer(p_lease_id uuid,p_writer_instance_id text,p_lease_seconds integer default 60)
returns table(expires_at timestamptz,checkpoint_revision bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lease public.runtime_writer_leases%rowtype; v_revision bigint; v_now timestamptz:=clock_timestamp();
begin
  select * into v_lease from public.runtime_writer_leases where lease_id=p_lease_id for update;
  if not found or v_lease.writer_user_id<>auth.uid() or v_lease.writer_instance_id<>p_writer_instance_id or v_lease.released_at is not null or v_lease.expires_at<=v_now then raise exception 'STALE_WRITER'; end if;
  update public.runtime_writer_leases set refreshed_at=v_now,expires_at=v_now+make_interval(secs=>p_lease_seconds) where lease_id=p_lease_id returning * into v_lease;
  select coalesce(checkpoint.checkpoint_revision,0) into v_revision from public.runtime_checkpoints checkpoint where checkpoint.exercise_id=v_lease.exercise_id;
  return query select v_lease.expires_at,v_revision;
end $$;

create or replace function public.release_runtime_writer(p_lease_id uuid,p_writer_instance_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lease public.runtime_writer_leases%rowtype;
begin
  select * into v_lease from public.runtime_writer_leases where lease_id=p_lease_id for update;
  if not found or v_lease.writer_user_id<>auth.uid() or v_lease.writer_instance_id<>p_writer_instance_id then raise exception 'STALE_WRITER'; end if;
  update public.runtime_writer_leases set released_at=clock_timestamp() where lease_id=p_lease_id;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,event_type,writer_instance_id,user_id) values(v_lease.exercise_id,'WRITER_RELEASED',p_writer_instance_id,auth.uid());
end $$;

create or replace function public.publish_runtime_checkpoint(
  p_lease_id uuid,p_writer_instance_id text,p_expected_revision bigint,p_checkpoint jsonb
) returns setof public.runtime_checkpoints
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lease public.runtime_writer_leases%rowtype; v_current bigint; v_next bigint; v_now timestamptz:=clock_timestamp();
begin
  select * into v_lease from public.runtime_writer_leases where lease_id=p_lease_id for update;
  if not found or v_lease.writer_user_id<>auth.uid() or v_lease.writer_instance_id<>p_writer_instance_id or v_lease.released_at is not null or v_lease.expires_at<=v_now then
    insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id) values(coalesce(v_lease.exercise_id,p_checkpoint->>'exerciseId'),p_expected_revision,'STALE_WRITE_REJECTED',p_writer_instance_id,auth.uid());
    raise exception 'STALE_WRITER';
  end if;
  select checkpoint.checkpoint_revision into v_current from public.runtime_checkpoints checkpoint where checkpoint.exercise_id=v_lease.exercise_id for update;
  v_current:=coalesce(v_current,0); v_next:=(p_checkpoint->>'checkpointRevision')::bigint;
  if v_current<>p_expected_revision or v_next<=v_current or p_checkpoint->>'exerciseId'<>v_lease.exercise_id then raise exception 'CHECKPOINT_REVISION_CONFLICT'; end if;
  insert into public.runtime_checkpoints(exercise_id,checkpoint_revision,persisted_runtime_version,payload_hash,provenance_hash,payload,writer_instance_id,writer_user_id,updated_at)
    values(v_lease.exercise_id,v_next,(p_checkpoint->>'persistedRuntimeVersion')::integer,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_checkpoint,p_writer_instance_id,auth.uid(),v_now)
    on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,persisted_runtime_version=excluded.persisted_runtime_version,
      payload_hash=excluded.payload_hash,provenance_hash=excluded.provenance_hash,payload=excluded.payload,writer_instance_id=excluded.writer_instance_id,writer_user_id=excluded.writer_user_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id) values(v_lease.exercise_id,v_next,'CHECKPOINT_PUBLISHED',p_writer_instance_id,auth.uid());
  return query select * from public.runtime_checkpoints where exercise_id=v_lease.exercise_id;
end $$;

revoke all on function public.acquire_runtime_writer(text,text,bigint,integer) from public;
revoke all on function public.renew_runtime_writer(uuid,text,integer) from public;
revoke all on function public.release_runtime_writer(uuid,text) from public;
revoke all on function public.publish_runtime_checkpoint(uuid,text,bigint,jsonb) from public;
grant execute on function public.acquire_runtime_writer(text,text,bigint,integer) to authenticated;
grant execute on function public.renew_runtime_writer(uuid,text,integer) to authenticated;
grant execute on function public.release_runtime_writer(uuid,text) to authenticated;
grant execute on function public.publish_runtime_checkpoint(uuid,text,bigint,jsonb) to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'runtime_checkpoints'
  ) then alter publication supabase_realtime add table public.runtime_checkpoints; end if;
end $$;
