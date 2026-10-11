-- WP-EGRESS-01: keep the authoritative full checkpoint unchanged while moving
-- Realtime invalidation to an atomic, metadata-only row.
create table if not exists public.runtime_checkpoint_notifications (
  exercise_id text primary key references public.runtime_checkpoints(exercise_id) on delete cascade,
  checkpoint_revision bigint not null check (checkpoint_revision > 0),
  payload_hash text not null,
  provenance_hash text not null,
  writer_instance_id text not null,
  updated_at timestamptz not null
);

insert into public.runtime_checkpoint_notifications(
  exercise_id,checkpoint_revision,payload_hash,provenance_hash,writer_instance_id,updated_at
)
select exercise_id,checkpoint_revision,payload_hash,provenance_hash,writer_instance_id,updated_at
from public.runtime_checkpoints
on conflict(exercise_id) do update set
  checkpoint_revision=excluded.checkpoint_revision,
  payload_hash=excluded.payload_hash,
  provenance_hash=excluded.provenance_hash,
  writer_instance_id=excluded.writer_instance_id,
  updated_at=excluded.updated_at;

alter table public.runtime_checkpoint_notifications enable row level security;
drop policy if exists "authenticated users read runtime checkpoint notifications" on public.runtime_checkpoint_notifications;
create policy "authenticated users read runtime checkpoint notifications"
  on public.runtime_checkpoint_notifications for select to authenticated using (true);
revoke all on table public.runtime_checkpoint_notifications from anon;
revoke all on table public.runtime_checkpoint_notifications from authenticated;
grant select on table public.runtime_checkpoint_notifications to authenticated;

create or replace function public.publish_runtime_checkpoint_metadata(
  p_lease_id uuid,p_writer_instance_id text,p_expected_revision bigint,p_checkpoint jsonb
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lease public.runtime_writer_leases%rowtype; v_current bigint; v_next bigint; v_now timestamptz:=clock_timestamp();
begin
  select * into v_lease from public.runtime_writer_leases where lease_id=p_lease_id for update;
  if not found or v_lease.writer_user_id<>auth.uid() or v_lease.writer_instance_id<>p_writer_instance_id or v_lease.released_at is not null or v_lease.expires_at<=v_now then
    insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
      values(coalesce(v_lease.exercise_id,p_checkpoint->>'exerciseId'),p_expected_revision,'STALE_WRITE_REJECTED',p_writer_instance_id,auth.uid());
    raise exception 'STALE_WRITER';
  end if;
  select checkpoint.checkpoint_revision into v_current from public.runtime_checkpoints checkpoint where checkpoint.exercise_id=v_lease.exercise_id for update;
  v_current:=coalesce(v_current,0); v_next:=(p_checkpoint->>'checkpointRevision')::bigint;
  if v_current<>p_expected_revision or v_next<=v_current or p_checkpoint->>'exerciseId'<>v_lease.exercise_id then raise exception 'CHECKPOINT_REVISION_CONFLICT'; end if;
  insert into public.runtime_checkpoints(exercise_id,checkpoint_revision,persisted_runtime_version,payload_hash,provenance_hash,payload,writer_instance_id,writer_user_id,updated_at)
    values(v_lease.exercise_id,v_next,(p_checkpoint->>'persistedRuntimeVersion')::integer,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_checkpoint,p_writer_instance_id,auth.uid(),v_now)
    on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,persisted_runtime_version=excluded.persisted_runtime_version,
      payload_hash=excluded.payload_hash,provenance_hash=excluded.provenance_hash,payload=excluded.payload,writer_instance_id=excluded.writer_instance_id,writer_user_id=excluded.writer_user_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_notifications(exercise_id,checkpoint_revision,payload_hash,provenance_hash,writer_instance_id,updated_at)
    values(v_lease.exercise_id,v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_writer_instance_id,v_now)
    on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,payload_hash=excluded.payload_hash,
      provenance_hash=excluded.provenance_hash,writer_instance_id=excluded.writer_instance_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
    values(v_lease.exercise_id,v_next,'CHECKPOINT_PUBLISHED',p_writer_instance_id,auth.uid());
  return query select v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',v_now;
end $$;

revoke all on function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) from public;
revoke all on function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) from anon;
grant execute on function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) to authenticated;

-- The superseded full-row RPC would bypass the atomic notification update.
-- Current clients have used the metadata-response RPC since WP-47A.
revoke all on function public.publish_runtime_checkpoint(uuid,text,bigint,jsonb) from public;
revoke all on function public.publish_runtime_checkpoint(uuid,text,bigint,jsonb) from anon;
revoke all on function public.publish_runtime_checkpoint(uuid,text,bigint,jsonb) from authenticated;

do $$ begin
  if exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='runtime_checkpoints'
  ) then alter publication supabase_realtime drop table public.runtime_checkpoints; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='runtime_checkpoint_notifications'
  ) then alter publication supabase_realtime add table public.runtime_checkpoint_notifications; end if;
end $$;
