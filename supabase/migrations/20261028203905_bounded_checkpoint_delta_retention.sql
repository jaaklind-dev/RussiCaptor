-- LOCAL DESIGN PROTOTYPE. Not a deployment or deletion authorization.
-- Requires the qualified publication fix (no inline DELETE) first.
-- Policy: newest32 actual delta rows retained, at most128 older rows per call.
-- Private administrator maintenance only; no scheduler or application grant.
SET LOCAL search_path=pg_catalog;
DO $prerequisites$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('rc_history.guard_runtime()'::regprocedure),'UTF8')),'hex')
   <>'ce4ab6c02b3ea5858b8643938b8ec4aa9a344c852d135f4aebb1a3e0bba83262'
   OR encode(sha256(convert_to(pg_get_functiondef('public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb)'::regprocedure),'UTF8')),'hex')
   <>'1f2027be3849144bae8ed1d77c28a506d84ab0f39376bf11cb5e92fc3194c382' THEN
   RAISE EXCEPTION 'RETENTION_SOURCE_CAS_MISMATCH' USING ERRCODE='55000';
 END IF;
 IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.runtime_checkpoint_deltas'::regclass AND tgname='a0_historical_identity_guard')
  IS DISTINCT FROM 'CREATE TRIGGER a0_historical_identity_guard BEFORE INSERT OR DELETE OR UPDATE ON public.runtime_checkpoint_deltas FOR EACH ROW EXECUTE FUNCTION rc_history.guard_runtime()' THEN
   RAISE EXCEPTION 'RETENTION_TRIGGER_CAS_MISMATCH' USING ERRCODE='55000';
 END IF;
END $prerequisites$;

CREATE SCHEMA rc_checkpoint_maintenance AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA rc_checkpoint_maintenance FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE rc_checkpoint_maintenance.delta_delete_permits(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,
 exercise_id text NOT NULL,to_revision bigint NOT NULL,row_sha256 text NOT NULL,
 canonical_revision bigint NOT NULL,canonical_hash text NOT NULL,
 canonical_provenance text NOT NULL,retention_floor bigint NOT NULL,
 PRIMARY KEY(backend_pid,transaction_id,exercise_id,to_revision)
);
CREATE TABLE rc_checkpoint_maintenance.delta_retention_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 exercise_id text NOT NULL,canonical_revision bigint NOT NULL,canonical_hash text NOT NULL,
 retention_floor bigint NOT NULL,deleted_count integer NOT NULL,
 remaining_eligible bigint NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_role text NOT NULL DEFAULT session_user
);
ALTER TABLE rc_checkpoint_maintenance.delta_delete_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rc_checkpoint_maintenance.delta_retention_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON rc_checkpoint_maintenance.delta_delete_permits TO postgres USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON rc_checkpoint_maintenance.delta_retention_audit TO postgres USING(true) WITH CHECK(true);
REVOKE ALL ON ALL TABLES IN SCHEMA rc_checkpoint_maintenance FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA rc_checkpoint_maintenance FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION rc_checkpoint_maintenance.guard_delta_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $guard$
DECLARE v_state text; v_permit rc_checkpoint_maintenance.delta_delete_permits%rowtype; v_floor bigint;
BEGIN
 IF TG_OP<>'DELETE' OR TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'runtime_checkpoint_deltas' THEN
  RAISE EXCEPTION 'RETENTION_TRIGGER_SCOPE_INVALID' USING ERRCODE='42501';
 END IF;
 SELECT state INTO v_state FROM rc_history.identities WHERE exercise_id=OLD.exercise_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_IDENTITY_NOT_REGISTERED' USING ERRCODE='42501'; END IF;
 IF v_state<>'ACTIVE_ID' THEN RAISE EXCEPTION 'HISTORICAL_ID_RESERVED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_permit FROM rc_checkpoint_maintenance.delta_delete_permits
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current()
   AND exercise_id=OLD.exercise_id AND to_revision=OLD.to_revision
   AND row_sha256=encode(sha256(convert_to(to_jsonb(OLD)::text,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'ARCHIVE_DELETE_NOT_READY' USING ERRCODE='42501'; END IF;
 SELECT to_revision INTO v_floor FROM public.runtime_checkpoint_deltas
  WHERE exercise_id=OLD.exercise_id ORDER BY to_revision DESC OFFSET 31 LIMIT 1;
 IF v_floor IS NULL OR OLD.to_revision>=v_floor OR v_permit.retention_floor<>v_floor THEN
  RAISE EXCEPTION 'RETENTION_WINDOW_PROTECTED' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.runtime_checkpoints c
   JOIN public.runtime_checkpoint_canonical_artifacts a ON a.exercise_id=c.exercise_id
    AND a.checkpoint_revision=c.checkpoint_revision AND a.payload_hash=c.payload_hash
    AND a.provenance_hash=c.provenance_hash AND a.persisted_runtime_version=c.persisted_runtime_version
   WHERE c.exercise_id=OLD.exercise_id AND c.checkpoint_revision=v_permit.canonical_revision
    AND c.payload_hash=v_permit.canonical_hash AND c.provenance_hash=v_permit.canonical_provenance
    AND OLD.to_revision<=c.checkpoint_revision) THEN
  RAISE EXCEPTION 'RETENTION_CANONICAL_BINDING_CHANGED' USING ERRCODE='55000';
 END IF;
 RETURN OLD;
END $guard$;
REVOKE ALL ON FUNCTION rc_checkpoint_maintenance.guard_delta_delete() FROM PUBLIC,anon,authenticated,service_role;

-- Explicit narrow control revision: keep the original guard for INSERT/UPDATE;
-- DELETE still has a mandatory guard, now requiring a private per-row permit.
-- The original rc_history.guard_runtime() function is NOT modified.
DROP TRIGGER a0_historical_identity_guard ON public.runtime_checkpoint_deltas;
CREATE TRIGGER a0_historical_identity_guard BEFORE INSERT OR UPDATE ON public.runtime_checkpoint_deltas
 FOR EACH ROW EXECUTE FUNCTION rc_history.guard_runtime();
CREATE TRIGGER a0_bounded_delta_delete_guard BEFORE DELETE ON public.runtime_checkpoint_deltas
 FOR EACH ROW EXECUTE FUNCTION rc_checkpoint_maintenance.guard_delta_delete();

CREATE FUNCTION rc_checkpoint_maintenance.prune_delta_batch(p_exercise_id text,p_batch_limit integer DEFAULT 32)
RETURNS TABLE(status text,deleted_count integer,remaining_eligible bigint,keep_rows integer,canonical_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $prune$
DECLARE v_state text; v_lease public.runtime_writer_leases%rowtype;
 v_checkpoint public.runtime_checkpoints%rowtype;
 v_artifact public.runtime_checkpoint_canonical_artifacts%rowtype;
 v_floor bigint; v_deleted integer; v_remaining bigint; v_after text;
BEGIN
 IF p_exercise_id IS NULL OR p_exercise_id<>btrim(p_exercise_id) OR length(p_exercise_id)=0
   OR p_batch_limit IS NULL OR p_batch_limit NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'RETENTION_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 BEGIN
  -- Same advisory key as writer acquisition. NOWAIT everywhere: skip busy work.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_exercise_id,7621)) THEN
   RETURN QUERY SELECT 'SKIPPED_BUSY'::text,0,NULL::bigint,32,NULL::bigint; RETURN;
  END IF;
  SELECT state INTO v_state FROM rc_history.identities WHERE exercise_id=p_exercise_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_IDENTITY_NOT_REGISTERED' USING ERRCODE='42501'; END IF;
  IF v_state<>'ACTIVE_ID' THEN RAISE EXCEPTION 'HISTORICAL_ID_RESERVED' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_lease FROM public.runtime_writer_leases WHERE exercise_id=p_exercise_id FOR UPDATE NOWAIT;
  IF FOUND AND v_lease.released_at IS NULL AND v_lease.expires_at>clock_timestamp() THEN
   RETURN QUERY SELECT 'SKIPPED_WRITER_ACTIVE'::text,0,NULL::bigint,32,NULL::bigint; RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM public.runtime_completion_requests r WHERE r.exercise_id=p_exercise_id AND r.status='PENDING') THEN
   RETURN QUERY SELECT 'SKIPPED_COMPLETION_PENDING'::text,0,NULL::bigint,32,NULL::bigint; RETURN;
  END IF;
  SELECT * INTO v_checkpoint FROM public.runtime_checkpoints WHERE exercise_id=p_exercise_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'RETENTION_FULL_CHECKPOINT_REQUIRED' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_artifact FROM public.runtime_checkpoint_canonical_artifacts WHERE exercise_id=p_exercise_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR v_artifact.checkpoint_revision<>v_checkpoint.checkpoint_revision
   OR v_artifact.payload_hash<>v_checkpoint.payload_hash
   OR v_artifact.provenance_hash<>v_checkpoint.provenance_hash
   OR v_artifact.persisted_runtime_version<>v_checkpoint.persisted_runtime_version
   OR v_artifact.canonical_format_version<>1
   OR encode(sha256(convert_to(v_artifact.canonical_payload_text,'UTF8')),'hex')<>v_checkpoint.payload_hash
   OR v_checkpoint.payload->'payload' IS DISTINCT FROM v_artifact.canonical_payload_text::jsonb THEN
   RAISE EXCEPTION 'RETENTION_CANONICAL_INVALID' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.runtime_checkpoint_deltas WHERE exercise_id=p_exercise_id AND to_revision>v_checkpoint.checkpoint_revision) THEN
   RAISE EXCEPTION 'RETENTION_DELTA_AHEAD_OF_CANONICAL' USING ERRCODE='55000';
  END IF;
  SELECT to_revision INTO v_floor FROM public.runtime_checkpoint_deltas
   WHERE exercise_id=p_exercise_id ORDER BY to_revision DESC OFFSET 31 LIMIT 1;
  IF v_floor IS NULL THEN
   RETURN QUERY SELECT 'NOTHING_TO_PRUNE'::text,0,0::bigint,32,v_checkpoint.checkpoint_revision; RETURN;
  END IF;
  INSERT INTO rc_checkpoint_maintenance.delta_delete_permits
   SELECT pg_backend_pid(),txid_current(),d.exercise_id,d.to_revision,
    encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),v_checkpoint.checkpoint_revision,
    v_checkpoint.payload_hash,v_checkpoint.provenance_hash,v_floor
   FROM public.runtime_checkpoint_deltas d WHERE d.exercise_id=p_exercise_id AND d.to_revision<v_floor
   ORDER BY d.to_revision LIMIT p_batch_limit;
  DELETE FROM public.runtime_checkpoint_deltas d USING rc_checkpoint_maintenance.delta_delete_permits p
   WHERE p.backend_pid=pg_backend_pid() AND p.transaction_id=txid_current()
    AND d.exercise_id=p.exercise_id AND d.to_revision=p.to_revision;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  DELETE FROM rc_checkpoint_maintenance.delta_delete_permits
   WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND exercise_id=p_exercise_id;
  SELECT count(*) INTO v_remaining FROM public.runtime_checkpoint_deltas
   WHERE exercise_id=p_exercise_id AND to_revision<v_floor;
  INSERT INTO rc_checkpoint_maintenance.delta_retention_audit
   (exercise_id,canonical_revision,canonical_hash,retention_floor,deleted_count,remaining_eligible)
   VALUES(p_exercise_id,v_checkpoint.checkpoint_revision,v_checkpoint.payload_hash,v_floor,v_deleted,v_remaining);
  RETURN QUERY SELECT CASE WHEN v_deleted=0 THEN 'NOTHING_TO_PRUNE' ELSE 'PRUNED' END, v_deleted,v_remaining,32,v_checkpoint.checkpoint_revision;
 EXCEPTION WHEN lock_not_available THEN
  RETURN QUERY SELECT 'SKIPPED_BUSY'::text,0,NULL::bigint,32,NULL::bigint;
 END;
END $prune$;
REVOKE ALL ON FUNCTION rc_checkpoint_maintenance.prune_delta_batch(text,integer) FROM PUBLIC,anon,authenticated,service_role;
