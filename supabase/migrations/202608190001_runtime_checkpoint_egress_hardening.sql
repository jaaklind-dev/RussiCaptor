-- WP-47A: keep the canonical checkpoint write unchanged while returning only
-- the acknowledgement metadata needed by the client. The checkpoint payload
-- is already held and hashed by the authenticated writer.
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
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
    values(v_lease.exercise_id,v_next,'CHECKPOINT_PUBLISHED',p_writer_instance_id,auth.uid());
  return query select v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',v_now;
end $$;

revoke all on function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) from public;
grant execute on function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) to authenticated;
