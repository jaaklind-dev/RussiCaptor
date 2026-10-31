-- Additive migration candidate. NOT DEPLOYED; requires separate explicit authorization.
-- Function body is byte-identical to the qualified retention-v1 correction.
-- Deltas are retained; no grant, guard, pruning worker or historical-data change.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
DO $precondition$
BEGIN
  IF encode(sha256(convert_to(pg_get_functiondef('public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb)'::regprocedure),'UTF8')),'hex')
    <> '1d1e2585080156974fab2943805a05b0aa43a7fae49a14a9ea960200d13060d9' THEN
    RAISE EXCEPTION 'DELTA_PUBLICATION_SOURCE_CAS_MISMATCH' USING ERRCODE='55000';
  END IF;
  IF encode(sha256(convert_to(pg_get_functiondef('rc_history.guard_runtime()'::regprocedure),'UTF8')),'hex')
    <> 'ce4ab6c02b3ea5858b8643938b8ec4aa9a344c852d135f4aebb1a3e0bba83262' THEN
    RAISE EXCEPTION 'HISTORICAL_GUARD_SOURCE_CAS_MISMATCH' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb)'::regprocedure
    AND pg_get_userbyid(proowner)='postgres' AND proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'DELTA_PUBLICATION_OWNER_ACL_MISMATCH' USING ERRCODE='55000';
  END IF;
END $precondition$;
CREATE OR REPLACE FUNCTION public.publish_runtime_checkpoint_delta(p_lease_id uuid, p_writer_instance_id text, p_expected_revision bigint, p_checkpoint jsonb, p_delta jsonb)
 RETURNS TABLE(checkpoint_revision bigint, payload_hash text, provenance_hash text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_lease public.runtime_writer_leases%rowtype; v_current bigint; v_current_hash text; v_next bigint;
  v_checkpoint_bytes bigint:=octet_length(p_checkpoint::text); v_delta_bytes bigint:=octet_length(p_delta::text); v_now timestamptz:=clock_timestamp();
begin
 PERFORM rc_history.assert_operational_id((SELECT exercise_id FROM public.runtime_writer_leases WHERE lease_id=p_lease_id));

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

  insert into public.runtime_checkpoints(exercise_id,checkpoint_revision,persisted_runtime_version,payload_hash,provenance_hash,payload,payload_bytes,writer_instance_id,writer_user_id,updated_at)
    values(v_lease.exercise_id,v_next,(p_checkpoint->>'persistedRuntimeVersion')::integer,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_checkpoint,v_checkpoint_bytes,p_writer_instance_id,auth.uid(),v_now)
    on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,persisted_runtime_version=excluded.persisted_runtime_version,
      payload_hash=excluded.payload_hash,provenance_hash=excluded.provenance_hash,payload=excluded.payload,payload_bytes=excluded.payload_bytes,writer_instance_id=excluded.writer_instance_id,writer_user_id=excluded.writer_user_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_deltas(exercise_id,from_revision,to_revision,base_hash,target_hash,provenance_hash,delta_payload,payload_bytes,delta_version,persisted_runtime_version,writer_instance_id,created_at)
    values(v_lease.exercise_id,v_current,v_next,v_current_hash,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_delta,v_delta_bytes,(p_delta->>'deltaVersion')::integer,(p_delta->>'targetPersistedRuntimeVersion')::integer,p_writer_instance_id,v_now);
  -- Retain deltas: archive deletion is not a prerequisite for publishing a checkpoint.
  insert into public.runtime_checkpoint_notifications(exercise_id,checkpoint_revision,payload_hash,provenance_hash,writer_instance_id,checkpoint_bytes,updated_at)
    values(v_lease.exercise_id,v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_writer_instance_id,v_checkpoint_bytes,v_now)
    on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,payload_hash=excluded.payload_hash,
      provenance_hash=excluded.provenance_hash,writer_instance_id=excluded.writer_instance_id,checkpoint_bytes=excluded.checkpoint_bytes,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,writer_instance_id,user_id)
    values(v_lease.exercise_id,v_next,'CHECKPOINT_PUBLISHED',p_writer_instance_id,auth.uid());
  return query select v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',v_now;
end $function$
;
DO $postcondition$
BEGIN
  IF encode(sha256(convert_to(pg_get_functiondef('public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb)'::regprocedure),'UTF8')),'hex')
    <> '1f2027be3849144bae8ed1d77c28a506d84ab0f39376bf11cb5e92fc3194c382'
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb)'::regprocedure
      AND pg_get_userbyid(proowner)='postgres' AND proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'DELTA_PUBLICATION_POSTCONDITION_FAILED' USING ERRCODE='55000';
  END IF;
END $postcondition$;
