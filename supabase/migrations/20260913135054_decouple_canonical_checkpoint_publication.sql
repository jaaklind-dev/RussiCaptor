-- WP-NARVA-10B15: canonical-v1 is the single full semantic representation
-- transported by a writer. The database verifies and parses that exact text,
-- derives the queryable JSONB checkpoint in the same transaction, and installs
-- the reader authority without requiring a second multi-megabyte request body.

create or replace function public.runtime_checkpoint_from_canonical_payload(
  p_exercise_id text,
  p_checkpoint_revision bigint,
  p_persisted_runtime_version integer,
  p_payload_hash text,
  p_provenance_hash text,
  p_canonical_format_version integer,
  p_canonical_payload_text text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_payload jsonb;
  v_computed_hash text;
begin
  if p_canonical_format_version<>1
    or p_checkpoint_revision<1
    or p_persisted_runtime_version<1
    or p_payload_hash!~'^[0-9a-f]{64}$'
    or p_provenance_hash!~'^[0-9a-f]{64}$' then
    raise exception 'CANONICAL_CHECKPOINT_METADATA_INVALID' using errcode='22023';
  end if;
  v_computed_hash:=encode(extensions.digest(convert_to(p_canonical_payload_text,'UTF8'),'sha256'),'hex');
  if v_computed_hash<>p_payload_hash then
    raise exception 'CANONICAL_CHECKPOINT_HASH_INVALID' using errcode='22000';
  end if;
  begin
    v_payload:=p_canonical_payload_text::jsonb;
  exception when invalid_text_representation then
    raise exception 'CANONICAL_CHECKPOINT_MALFORMED' using errcode='22000';
  end;
  if v_payload#>>'{exerciseSession,exerciseId}' is distinct from p_exercise_id then
    raise exception 'CANONICAL_CHECKPOINT_IDENTITY_MISMATCH' using errcode='22000';
  end if;
  return jsonb_build_object(
    'envelopeVersion',1,
    'exerciseId',p_exercise_id,
    'checkpointRevision',p_checkpoint_revision,
    'persistedRuntimeVersion',p_persisted_runtime_version,
    'payload',v_payload,
    'payloadHash',p_payload_hash,
    'provenanceHash',p_provenance_hash
  );
end $$;

revoke all on function public.runtime_checkpoint_from_canonical_payload(text,bigint,integer,text,text,integer,text)
  from public,anon,authenticated;

-- This helper is reachable only by the security-definer writer wrappers. The
-- exact text has already been hashed by runtime_checkpoint_from_canonical_payload
-- in the same transaction, and the just-published structured row was derived
-- from that same parsed text. Same-revision retries are idempotent; a different
-- artifact for an already-bound revision is rejected.
create or replace function public.persist_verified_runtime_checkpoint_canonical_artifact(
  p_exercise_id text,
  p_checkpoint_revision bigint,
  p_payload_hash text,
  p_provenance_hash text,
  p_persisted_runtime_version integer,
  p_canonical_format_version integer,
  p_canonical_payload_text text
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_checkpoint public.runtime_checkpoints%rowtype;
  v_existing public.runtime_checkpoint_canonical_artifacts%rowtype;
  v_actor uuid:=(select auth.uid());
  v_bytes bigint:=octet_length(convert_to(p_canonical_payload_text,'UTF8'));
begin
  select * into v_checkpoint from public.runtime_checkpoints
    where exercise_id=p_exercise_id for update;
  if not found or v_checkpoint.checkpoint_revision<>p_checkpoint_revision
    or v_checkpoint.payload_hash<>p_payload_hash
    or v_checkpoint.provenance_hash<>p_provenance_hash
    or v_checkpoint.persisted_runtime_version<>p_persisted_runtime_version
    or v_checkpoint.payload->'payload' is distinct from p_canonical_payload_text::jsonb then
    raise exception 'CANONICAL_CHECKPOINT_SOURCE_MISMATCH' using errcode='55000';
  end if;

  select * into v_existing from public.runtime_checkpoint_canonical_artifacts
    where exercise_id=p_exercise_id for update;
  if found and v_existing.checkpoint_revision=p_checkpoint_revision then
    if v_existing.payload_hash<>p_payload_hash
      or v_existing.provenance_hash<>p_provenance_hash
      or v_existing.persisted_runtime_version<>p_persisted_runtime_version
      or v_existing.canonical_format_version<>p_canonical_format_version
      or v_existing.canonical_payload_text<>p_canonical_payload_text then
      raise exception 'CANONICAL_CHECKPOINT_IMMUTABILITY_VIOLATION' using errcode='23505';
    end if;
    return;
  end if;
  if found and v_existing.checkpoint_revision>p_checkpoint_revision then
    raise exception 'CANONICAL_CHECKPOINT_REVISION_STALE' using errcode='55000';
  end if;

  insert into public.runtime_checkpoint_canonical_artifacts(
    exercise_id,checkpoint_revision,persisted_runtime_version,canonical_format_version,
    payload_hash,provenance_hash,canonical_payload_text,canonical_payload_bytes,
    derivation_method,created_by,created_at,updated_at
  ) values(
    p_exercise_id,p_checkpoint_revision,p_persisted_runtime_version,p_canonical_format_version,
    p_payload_hash,p_provenance_hash,p_canonical_payload_text,v_bytes,
    'WRITER',v_actor,clock_timestamp(),clock_timestamp()
  ) on conflict(exercise_id) do update set
    checkpoint_revision=excluded.checkpoint_revision,
    persisted_runtime_version=excluded.persisted_runtime_version,
    canonical_format_version=excluded.canonical_format_version,
    payload_hash=excluded.payload_hash,
    provenance_hash=excluded.provenance_hash,
    canonical_payload_text=excluded.canonical_payload_text,
    canonical_payload_bytes=excluded.canonical_payload_bytes,
    derivation_method=excluded.derivation_method,
    created_by=excluded.created_by,
    updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_canonical_artifact_audit(
    exercise_id,checkpoint_revision,payload_hash,provenance_hash,canonical_format_version,
    canonical_payload_bytes,derivation_method,installed_by
  ) values(
    p_exercise_id,p_checkpoint_revision,p_payload_hash,p_provenance_hash,
    p_canonical_format_version,v_bytes,'WRITER',v_actor
  );
end $$;

revoke all on function public.persist_verified_runtime_checkpoint_canonical_artifact(text,bigint,text,text,integer,integer,text)
  from public,anon,authenticated;

create or replace function public.publish_runtime_checkpoint_canonical_payload(
  p_lease_id uuid,p_writer_instance_id text,p_expected_revision bigint,
  p_exercise_id text,p_checkpoint_revision bigint,p_persisted_runtime_version integer,
  p_payload_hash text,p_provenance_hash text,p_canonical_format_version integer,
  p_canonical_payload_text text
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_checkpoint jsonb;
begin
  v_checkpoint:=public.runtime_checkpoint_from_canonical_payload(
    p_exercise_id,p_checkpoint_revision,p_persisted_runtime_version,p_payload_hash,
    p_provenance_hash,p_canonical_format_version,p_canonical_payload_text);
  perform public.publish_runtime_checkpoint_metadata(
    p_lease_id,p_writer_instance_id,p_expected_revision,v_checkpoint);
  perform public.persist_verified_runtime_checkpoint_canonical_artifact(
    p_exercise_id,p_checkpoint_revision,p_payload_hash,p_provenance_hash,
    p_persisted_runtime_version,p_canonical_format_version,p_canonical_payload_text);
  return query select rc.checkpoint_revision,rc.payload_hash,rc.provenance_hash,rc.updated_at
    from public.runtime_checkpoints rc where rc.exercise_id=p_exercise_id;
end $$;

create or replace function public.publish_runtime_checkpoint_canonical_payload_delta(
  p_lease_id uuid,p_writer_instance_id text,p_expected_revision bigint,p_delta jsonb,
  p_exercise_id text,p_checkpoint_revision bigint,p_persisted_runtime_version integer,
  p_payload_hash text,p_provenance_hash text,p_canonical_format_version integer,
  p_canonical_payload_text text
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_checkpoint jsonb;
begin
  v_checkpoint:=public.runtime_checkpoint_from_canonical_payload(
    p_exercise_id,p_checkpoint_revision,p_persisted_runtime_version,p_payload_hash,
    p_provenance_hash,p_canonical_format_version,p_canonical_payload_text);
  perform public.publish_runtime_checkpoint_delta(
    p_lease_id,p_writer_instance_id,p_expected_revision,v_checkpoint,p_delta);
  perform public.persist_verified_runtime_checkpoint_canonical_artifact(
    p_exercise_id,p_checkpoint_revision,p_payload_hash,p_provenance_hash,
    p_persisted_runtime_version,p_canonical_format_version,p_canonical_payload_text);
  return query select rc.checkpoint_revision,rc.payload_hash,rc.provenance_hash,rc.updated_at
    from public.runtime_checkpoints rc where rc.exercise_id=p_exercise_id;
end $$;

create or replace function public.finalize_runtime_completion_canonical_payload(
  p_exercise_id text,p_command_id text,p_lease_id uuid,p_writer_instance_id text,
  p_expected_checkpoint_revision bigint,p_checkpoint_revision bigint,
  p_persisted_runtime_version integer,p_payload_hash text,p_provenance_hash text,
  p_canonical_format_version integer,p_canonical_payload_text text
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_checkpoint jsonb;
begin
  v_checkpoint:=public.runtime_checkpoint_from_canonical_payload(
    p_exercise_id,p_checkpoint_revision,p_persisted_runtime_version,p_payload_hash,
    p_provenance_hash,p_canonical_format_version,p_canonical_payload_text);
  perform public.finalize_runtime_completion(
    p_exercise_id,p_command_id,p_lease_id,p_writer_instance_id,
    p_expected_checkpoint_revision,v_checkpoint);
  perform public.persist_verified_runtime_checkpoint_canonical_artifact(
    p_exercise_id,p_checkpoint_revision,p_payload_hash,p_provenance_hash,
    p_persisted_runtime_version,p_canonical_format_version,p_canonical_payload_text);
  return query select rc.checkpoint_revision,rc.payload_hash,rc.provenance_hash,rc.updated_at
    from public.runtime_checkpoints rc where rc.exercise_id=p_exercise_id;
end $$;

revoke all on function public.publish_runtime_checkpoint_canonical_payload(uuid,text,bigint,text,bigint,integer,text,text,integer,text)
  from public,anon;
grant execute on function public.publish_runtime_checkpoint_canonical_payload(uuid,text,bigint,text,bigint,integer,text,text,integer,text)
  to authenticated;
revoke all on function public.publish_runtime_checkpoint_canonical_payload_delta(uuid,text,bigint,jsonb,text,bigint,integer,text,text,integer,text)
  from public,anon;
grant execute on function public.publish_runtime_checkpoint_canonical_payload_delta(uuid,text,bigint,jsonb,text,bigint,integer,text,text,integer,text)
  to authenticated;
revoke all on function public.finalize_runtime_completion_canonical_payload(text,text,uuid,text,bigint,bigint,integer,text,text,integer,text)
  from public,anon;
grant execute on function public.finalize_runtime_completion_canonical_payload(text,text,uuid,text,bigint,bigint,integer,text,text,integer,text)
  to authenticated;
