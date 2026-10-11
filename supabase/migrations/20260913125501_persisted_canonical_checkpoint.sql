-- WP-NARVA-10B14: a checkpoint's exact canonical payload is persisted outside
-- the Realtime row. Readers verify and parse this one authority instead of
-- rebuilding canonical bytes from a large Hermes object graph.
create table public.runtime_checkpoint_canonical_artifacts (
  exercise_id text primary key references public.runtime_checkpoints(exercise_id) on delete cascade,
  checkpoint_revision bigint not null check (checkpoint_revision > 0),
  persisted_runtime_version integer not null check (persisted_runtime_version > 0),
  canonical_format_version integer not null check (canonical_format_version = 1),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  provenance_hash text not null check (provenance_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload_text text not null,
  canonical_payload_bytes bigint not null check (canonical_payload_bytes > 0),
  derivation_method text not null check (derivation_method in ('WRITER','LEGACY_DERIVATION')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.runtime_checkpoint_canonical_artifact_audit (
  id bigint generated always as identity primary key,
  exercise_id text not null,
  checkpoint_revision bigint not null,
  payload_hash text not null,
  provenance_hash text not null,
  canonical_format_version integer not null,
  canonical_payload_bytes bigint not null,
  derivation_method text not null,
  installed_by uuid references auth.users(id),
  installed_at timestamptz not null default clock_timestamp()
);

alter table public.runtime_checkpoint_canonical_artifacts enable row level security;
alter table public.runtime_checkpoint_canonical_artifact_audit enable row level security;
create policy "scoped operators read canonical checkpoints"
  on public.runtime_checkpoint_canonical_artifacts for select to authenticated
  using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));
create policy "scoped operators read canonical checkpoint audit"
  on public.runtime_checkpoint_canonical_artifact_audit for select to authenticated
  using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));
revoke all on table public.runtime_checkpoint_canonical_artifacts from public,anon,authenticated;
revoke all on table public.runtime_checkpoint_canonical_artifact_audit from public,anon,authenticated;
grant select on table public.runtime_checkpoint_canonical_artifacts to authenticated;
grant select on table public.runtime_checkpoint_canonical_artifact_audit to authenticated;

create or replace function public.install_runtime_checkpoint_canonical_artifact(
  p_exercise_id text,
  p_checkpoint_revision bigint,
  p_payload_hash text,
  p_provenance_hash text,
  p_persisted_runtime_version integer,
  p_canonical_format_version integer,
  p_canonical_payload_text text,
  p_derivation_method text
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_checkpoint public.runtime_checkpoints%rowtype;
  v_actor uuid := (select auth.uid());
  v_computed_hash text;
begin
  if p_canonical_format_version<>1 or p_derivation_method not in ('WRITER','LEGACY_DERIVATION') then
    raise exception 'CANONICAL_CHECKPOINT_FORMAT_INVALID' using errcode='22023';
  end if;
  select * into v_checkpoint from public.runtime_checkpoints
    where exercise_id=p_exercise_id for update;
  if not found or v_checkpoint.checkpoint_revision<>p_checkpoint_revision
    or v_checkpoint.payload_hash<>p_payload_hash
    or v_checkpoint.provenance_hash<>p_provenance_hash
    or v_checkpoint.persisted_runtime_version<>p_persisted_runtime_version then
    raise exception 'CANONICAL_CHECKPOINT_SOURCE_MISMATCH' using errcode='55000';
  end if;
  v_computed_hash:=encode(extensions.digest(convert_to(p_canonical_payload_text,'UTF8'),'sha256'),'hex');
  if v_computed_hash<>p_payload_hash then
    raise exception 'CANONICAL_CHECKPOINT_HASH_INVALID' using errcode='22000';
  end if;
  if p_canonical_payload_text::jsonb is distinct from v_checkpoint.payload->'payload' then
    raise exception 'CANONICAL_CHECKPOINT_PAYLOAD_DIVERGENCE' using errcode='22000';
  end if;
  insert into public.runtime_checkpoint_canonical_artifacts(
    exercise_id,checkpoint_revision,persisted_runtime_version,canonical_format_version,
    payload_hash,provenance_hash,canonical_payload_text,canonical_payload_bytes,
    derivation_method,created_by,created_at,updated_at
  ) values(
    p_exercise_id,p_checkpoint_revision,p_persisted_runtime_version,p_canonical_format_version,
    p_payload_hash,p_provenance_hash,p_canonical_payload_text,
    octet_length(convert_to(p_canonical_payload_text,'UTF8')),p_derivation_method,v_actor,
    clock_timestamp(),clock_timestamp()
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
    p_exercise_id,p_checkpoint_revision,p_payload_hash,p_provenance_hash,p_canonical_format_version,
    octet_length(convert_to(p_canonical_payload_text,'UTF8')),p_derivation_method,v_actor
  );
end $$;
revoke all on function public.install_runtime_checkpoint_canonical_artifact(text,bigint,text,text,integer,integer,text,text)
  from public,anon,authenticated;

create or replace function public.publish_runtime_checkpoint_canonical(
  p_lease_id uuid,p_writer_instance_id text,p_expected_revision bigint,p_checkpoint jsonb,
  p_canonical_format_version integer,p_canonical_payload_text text
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform public.publish_runtime_checkpoint_metadata(
    p_lease_id,p_writer_instance_id,p_expected_revision,p_checkpoint);
  perform public.install_runtime_checkpoint_canonical_artifact(
    p_checkpoint->>'exerciseId',(p_checkpoint->>'checkpointRevision')::bigint,
    p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',
    (p_checkpoint->>'persistedRuntimeVersion')::integer,p_canonical_format_version,
    p_canonical_payload_text,'WRITER');
  return query select rc.checkpoint_revision,rc.payload_hash,rc.provenance_hash,rc.updated_at
    from public.runtime_checkpoints rc where rc.exercise_id=p_checkpoint->>'exerciseId';
end $$;

create or replace function public.publish_runtime_checkpoint_canonical_delta(
  p_lease_id uuid,p_writer_instance_id text,p_expected_revision bigint,p_checkpoint jsonb,p_delta jsonb,
  p_canonical_format_version integer,p_canonical_payload_text text
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform public.publish_runtime_checkpoint_delta(
    p_lease_id,p_writer_instance_id,p_expected_revision,p_checkpoint,p_delta);
  perform public.install_runtime_checkpoint_canonical_artifact(
    p_checkpoint->>'exerciseId',(p_checkpoint->>'checkpointRevision')::bigint,
    p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',
    (p_checkpoint->>'persistedRuntimeVersion')::integer,p_canonical_format_version,
    p_canonical_payload_text,'WRITER');
  return query select rc.checkpoint_revision,rc.payload_hash,rc.provenance_hash,rc.updated_at
    from public.runtime_checkpoints rc where rc.exercise_id=p_checkpoint->>'exerciseId';
end $$;

create or replace function public.finalize_runtime_completion_canonical(
  p_exercise_id text,p_command_id text,p_lease_id uuid,p_writer_instance_id text,
  p_expected_checkpoint_revision bigint,p_checkpoint jsonb,
  p_canonical_format_version integer,p_canonical_payload_text text
) returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform public.finalize_runtime_completion(
    p_exercise_id,p_command_id,p_lease_id,p_writer_instance_id,
    p_expected_checkpoint_revision,p_checkpoint);
  perform public.install_runtime_checkpoint_canonical_artifact(
    p_exercise_id,(p_checkpoint->>'checkpointRevision')::bigint,
    p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',
    (p_checkpoint->>'persistedRuntimeVersion')::integer,p_canonical_format_version,
    p_canonical_payload_text,'WRITER');
  return query select rc.checkpoint_revision,rc.payload_hash,rc.provenance_hash,rc.updated_at
    from public.runtime_checkpoints rc where rc.exercise_id=p_exercise_id;
end $$;

revoke all on function public.publish_runtime_checkpoint_canonical(uuid,text,bigint,jsonb,integer,text)
  from public,anon;
grant execute on function public.publish_runtime_checkpoint_canonical(uuid,text,bigint,jsonb,integer,text)
  to authenticated;
revoke all on function public.publish_runtime_checkpoint_canonical_delta(uuid,text,bigint,jsonb,jsonb,integer,text)
  from public,anon;
grant execute on function public.publish_runtime_checkpoint_canonical_delta(uuid,text,bigint,jsonb,jsonb,integer,text)
  to authenticated;
revoke all on function public.finalize_runtime_completion_canonical(text,text,uuid,text,bigint,jsonb,integer,text)
  from public,anon;
grant execute on function public.finalize_runtime_completion_canonical(text,text,uuid,text,bigint,jsonb,integer,text)
  to authenticated;

-- Only trusted administrative service-role tooling may add a derived artifact
-- for an unchanged legacy checkpoint. Source identity/hash matching and the
-- JSONB equality check make the operation additive and idempotent.
grant execute on function public.install_runtime_checkpoint_canonical_artifact(text,bigint,text,text,integer,integer,text,text)
  to service_role;
