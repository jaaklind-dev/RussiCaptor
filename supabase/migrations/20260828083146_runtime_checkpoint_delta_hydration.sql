-- WP-EGRESS-03: bounded, verified incremental hydration. The existing full
-- runtime_checkpoints row remains the sole authority and fallback.
create table public.runtime_checkpoint_deltas (
  exercise_id text not null references public.runtime_checkpoints(exercise_id) on delete cascade,
  from_revision bigint not null check (from_revision >= 0),
  to_revision bigint not null check (to_revision > from_revision),
  base_hash text not null,
  target_hash text not null,
  provenance_hash text not null,
  delta_payload jsonb not null,
  writer_instance_id text not null,
  created_at timestamptz not null default now(),
  primary key (exercise_id,to_revision),
  unique (exercise_id,from_revision,to_revision)
);

create index runtime_checkpoint_deltas_chain_idx
  on public.runtime_checkpoint_deltas(exercise_id,from_revision,to_revision);

alter table public.runtime_checkpoint_deltas enable row level security;
create policy "authenticated users read runtime checkpoint deltas"
  on public.runtime_checkpoint_deltas for select to authenticated using (true);
revoke all on table public.runtime_checkpoint_deltas from anon;
revoke all on table public.runtime_checkpoint_deltas from authenticated;
grant select on table public.runtime_checkpoint_deltas to authenticated;

create or replace function public.publish_runtime_checkpoint_delta(
  p_lease_id uuid,p_writer_instance_id text,p_expected_revision bigint,p_checkpoint jsonb,p_delta jsonb
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lease public.runtime_writer_leases%rowtype; v_current bigint; v_current_hash text; v_next bigint; v_now timestamptz:=clock_timestamp();
begin
  select * into v_lease from public.runtime_writer_leases where lease_id=p_lease_id for update;
  if not found or v_lease.writer_user_id<>auth.uid() or v_lease.writer_instance_id<>p_writer_instance_id or v_lease.released_at is not null or v_lease.expires_at<=v_now then
    insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
      values(coalesce(v_lease.exercise_id,p_checkpoint->>'exerciseId'),p_expected_revision,'STALE_WRITE_REJECTED',p_writer_instance_id,auth.uid());
    raise exception 'STALE_WRITER';
  end if;
  select checkpoint.checkpoint_revision,checkpoint.payload_hash into v_current,v_current_hash
    from public.runtime_checkpoints checkpoint where checkpoint.exercise_id=v_lease.exercise_id for update;
  v_current:=coalesce(v_current,0); v_next:=(p_checkpoint->>'checkpointRevision')::bigint;
  if v_current<>p_expected_revision or v_next<=v_current or p_checkpoint->>'exerciseId'<>v_lease.exercise_id then raise exception 'CHECKPOINT_REVISION_CONFLICT'; end if;
  if (p_delta->>'deltaVersion')::integer<>1 or p_delta->>'exerciseId'<>v_lease.exercise_id or
     (p_delta->>'fromRevision')::bigint<>v_current or (p_delta->>'toRevision')::bigint<>v_next or
     p_delta->>'baseHash'<>v_current_hash or p_delta->>'targetHash'<>p_checkpoint->>'payloadHash' or
     p_delta->>'targetProvenanceHash'<>p_checkpoint->>'provenanceHash' then raise exception 'CHECKPOINT_DELTA_INVALID'; end if;

  insert into public.runtime_checkpoints(exercise_id,checkpoint_revision,persisted_runtime_version,payload_hash,provenance_hash,payload,writer_instance_id,writer_user_id,updated_at)
    values(v_lease.exercise_id,v_next,(p_checkpoint->>'persistedRuntimeVersion')::integer,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_checkpoint,p_writer_instance_id,auth.uid(),v_now)
    on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,persisted_runtime_version=excluded.persisted_runtime_version,
      payload_hash=excluded.payload_hash,provenance_hash=excluded.provenance_hash,payload=excluded.payload,writer_instance_id=excluded.writer_instance_id,writer_user_id=excluded.writer_user_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_deltas(exercise_id,from_revision,to_revision,base_hash,target_hash,provenance_hash,delta_payload,writer_instance_id,created_at)
    values(v_lease.exercise_id,v_current,v_next,v_current_hash,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_delta,p_writer_instance_id,v_now);
  delete from public.runtime_checkpoint_deltas where exercise_id=v_lease.exercise_id and to_revision <= v_next-32;
  insert into public.runtime_checkpoint_notifications(exercise_id,checkpoint_revision,payload_hash,provenance_hash,writer_instance_id,updated_at)
    values(v_lease.exercise_id,v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_writer_instance_id,v_now)
    on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,payload_hash=excluded.payload_hash,
      provenance_hash=excluded.provenance_hash,writer_instance_id=excluded.writer_instance_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
    values(v_lease.exercise_id,v_next,'CHECKPOINT_PUBLISHED',p_writer_instance_id,auth.uid());
  return query select v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',v_now;
end $$;

revoke all on function public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb) from public;
revoke all on function public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb) from anon;
grant execute on function public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb) to authenticated;
