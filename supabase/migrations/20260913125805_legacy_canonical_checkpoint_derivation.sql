-- Additive, service-role-only compatibility path for checkpoints written
-- before canonical format v1. The original runtime_checkpoints row is locked
-- and read, never rewritten. The installer rejects any byte/hash divergence.
create or replace function public.is_canonical_json_array_index(p_key text)
returns boolean language sql immutable strict set search_path='' as $$
  select p_key ~ '^(0|[1-9][0-9]*)$'
    and p_key::numeric between 0 and 4294967294
    and p_key::numeric::text=p_key
$$;

create or replace function public.legacy_stable_json(p_value jsonb)
returns text language plpgsql immutable strict set search_path='' as $$
declare v_type text:=jsonb_typeof(p_value); v_result text;
begin
  if v_type='object' then
    select '{'||coalesce(string_agg(to_json(key)::text||':'||public.legacy_stable_json(value),',' order by
      case when public.is_canonical_json_array_index(key) then 0 else 1 end,
      case when public.is_canonical_json_array_index(key) then key::numeric end,
      case when not public.is_canonical_json_array_index(key) then key collate "en-US-x-icu" end),'')||'}'
      into v_result from jsonb_each(p_value);
    return v_result;
  elsif v_type='array' then
    select '['||coalesce(string_agg(public.legacy_stable_json(value),',' order by ordinal),'')||']'
      into v_result from jsonb_array_elements(p_value) with ordinality as item(value,ordinal);
    return v_result;
  elsif v_type='number' then
    -- Application JSON is IEEE-754. Re-emitting through float8 removes jsonb
    -- numeric scale (for example 1.0 -> 1) just as JSON.stringify does.
    return to_jsonb((p_value#>>'{}')::double precision)::text;
  end if;
  return p_value::text;
end $$;

create or replace function public.derive_legacy_runtime_checkpoint_canonical_artifact(
  p_exercise_id text
) returns table(
  exercise_id text,checkpoint_revision bigint,payload_hash text,provenance_hash text,
  canonical_payload_bytes bigint,derivation_method text
)
language plpgsql security definer set search_path='' as $$
declare v_checkpoint public.runtime_checkpoints%rowtype; v_canonical text;
begin
  select * into v_checkpoint from public.runtime_checkpoints rc
    where rc.exercise_id=p_exercise_id for update;
  if not found then raise exception 'CHECKPOINT_NOT_FOUND' using errcode='P0002'; end if;
  v_canonical:=public.legacy_stable_json(v_checkpoint.payload->'payload');
  perform public.install_runtime_checkpoint_canonical_artifact(
    v_checkpoint.exercise_id,v_checkpoint.checkpoint_revision,v_checkpoint.payload_hash,
    v_checkpoint.provenance_hash,v_checkpoint.persisted_runtime_version,1,v_canonical,'LEGACY_DERIVATION');
  return query select artifact.exercise_id,artifact.checkpoint_revision,artifact.payload_hash,
    artifact.provenance_hash,artifact.canonical_payload_bytes,artifact.derivation_method
    from public.runtime_checkpoint_canonical_artifacts artifact
    where artifact.exercise_id=p_exercise_id;
end $$;

revoke all on function public.is_canonical_json_array_index(text) from public,anon,authenticated;
revoke all on function public.legacy_stable_json(jsonb) from public,anon,authenticated;
revoke all on function public.derive_legacy_runtime_checkpoint_canonical_artifact(text)
  from public,anon,authenticated;
grant execute on function public.derive_legacy_runtime_checkpoint_canonical_artifact(text)
  to service_role;
