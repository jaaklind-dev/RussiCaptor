-- Prevent an active exercise projection from changing package identity. The
-- package is selected before Runtime starts; RUNNING/PAUSED projection writes
-- are derived state and may not silently replace that identity.
create or replace function public.enforce_active_exercise_package_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_lifecycle text;
  v_old_package_id text;
  v_old_package_version text;
  v_new_package_id text;
  v_new_package_version text;
begin
  v_old_lifecycle := coalesce(
    old.state->'exerciseSession'->>'lifecycleState',
    case old.state->'exerciseSession'->>'state'
      when 'running' then 'RUNNING'
      when 'paused' then 'PAUSED'
      else 'READY'
    end
  );
  if v_old_lifecycle not in ('RUNNING', 'PAUSED') then
    return new;
  end if;
  v_old_package_id := old.state->'exercisePackageReference'->>'packageId';
  v_old_package_version := old.state->'exercisePackageReference'->>'packageVersion';
  v_new_package_id := new.state->'exercisePackageReference'->>'packageId';
  v_new_package_version := new.state->'exercisePackageReference'->>'packageVersion';
  if v_old_package_id is null or v_old_package_version is null or
     v_new_package_id is null or v_new_package_version is null or
     (v_old_package_id, v_old_package_version) is distinct from
       (v_new_package_id, v_new_package_version) then
    raise exception 'ACTIVE_EXERCISE_PACKAGE_IDENTITY_CONFLICT' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_active_exercise_package_identity on public.exercise_states;
create trigger enforce_active_exercise_package_identity
before update on public.exercise_states
for each row execute function public.enforce_active_exercise_package_identity();

revoke all on function public.enforce_active_exercise_package_identity() from public;
revoke all on function public.enforce_active_exercise_package_identity() from anon;
revoke all on function public.enforce_active_exercise_package_identity() from authenticated;

-- Safely terminalize only the observed state where a completely validated
-- client checkpoint and the active discovery projection have the same
-- exercise/session/lifecycle but different package identities. The client
-- performs canonical root, Runtime-artifact and provenance validation; this
-- transaction rechecks every immutable envelope expectation under row locks.
create or replace function public.terminalize_package_projection_divergence(
  p_exercise_id text,
  p_expected_projection_revision bigint,
  p_expected_checkpoint_revision bigint,
  p_expected_payload_hash text,
  p_expected_provenance_hash text,
  p_expected_session_version integer,
  p_expected_lifecycle text,
  p_expected_projection_package_id text,
  p_expected_projection_package_version text,
  p_expected_checkpoint_package_id text,
  p_expected_checkpoint_package_version text
) returns table(result_code text, audit_id uuid, recovered_state jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.exercise_states%rowtype;
  v_checkpoint public.runtime_checkpoints%rowtype;
  v_lease public.runtime_writer_leases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_authorized boolean := false;
  v_state_exists boolean := false;
  v_checkpoint_exists boolean := false;
  v_lease_exists boolean := false;
  v_checkpoint_envelope_valid boolean := false;
  v_runtime_items_valid boolean := false;
  v_projection_session jsonb;
  v_checkpoint_session jsonb;
  v_projection_lifecycle text;
  v_checkpoint_lifecycle text;
  v_projection_version integer;
  v_checkpoint_version integer;
  v_projection_package_id text;
  v_projection_package_version text;
  v_checkpoint_package_id text;
  v_checkpoint_package_version text;
  v_result text;
  v_audit uuid;
  v_assignment_ids uuid[];
  v_scopes text[];
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_row
  from public.exercise_states
  where exercise_id = p_exercise_id
  for update;
  v_state_exists := found;

  select public.has_authorization_permission('EXERCISE_RUNTIME_RECOVERY', p_exercise_id)
  into v_authorized;

  select coalesce(array_agg(id order by id), '{}'),
         coalesce(array_agg(scope_type || coalesce(':' || scope_id, '') order by id), '{}')
  into v_assignment_ids, v_scopes
  from public.authorization_role_assignments
  where user_id = auth.uid()
    and role = 'EXCON'
    and status = 'ACTIVE'
    and (expires_at is null or expires_at > v_now)
    and (scope_type = 'GLOBAL' or (scope_type = 'EXERCISE' and scope_id = p_exercise_id));

  if v_state_exists then
    select * into v_checkpoint
    from public.runtime_checkpoints
    where exercise_id = p_exercise_id
    for update;
    v_checkpoint_exists := found;

    select * into v_lease
    from public.runtime_writer_leases
    where exercise_id = p_exercise_id
    for update;
    v_lease_exists := found;

    v_projection_session := v_row.state->'exerciseSession';
    v_projection_lifecycle := coalesce(
      v_projection_session->>'lifecycleState',
      case v_projection_session->>'state'
        when 'running' then 'RUNNING'
        when 'paused' then 'PAUSED'
        else 'READY'
      end
    );
    v_projection_package_id := v_row.state->'exercisePackageReference'->>'packageId';
    v_projection_package_version := v_row.state->'exercisePackageReference'->>'packageVersion';
    begin
      if coalesce(v_projection_session->>'version', '') ~ '^[0-9]+$' then
        v_projection_version := (v_projection_session->>'version')::integer;
      end if;
    exception when others then
      v_projection_version := null;
    end;
  end if;

  if v_checkpoint_exists then
    v_checkpoint_session := v_checkpoint.payload->'payload'->'exerciseSession';
    v_checkpoint_lifecycle := coalesce(
      v_checkpoint_session->>'lifecycleState',
      case v_checkpoint_session->>'state'
        when 'running' then 'RUNNING'
        when 'paused' then 'PAUSED'
        else 'READY'
      end
    );
    v_checkpoint_package_id := v_checkpoint.payload->'payload'->'exercisePackageReference'->>'packageId';
    v_checkpoint_package_version := v_checkpoint.payload->'payload'->'exercisePackageReference'->>'packageVersion';
    begin
      if coalesce(v_checkpoint_session->>'version', '') ~ '^[0-9]+$' then
        v_checkpoint_version := (v_checkpoint_session->>'version')::integer;
      end if;
      v_checkpoint_envelope_valid :=
        v_checkpoint.payload->>'exerciseId' = p_exercise_id and
        v_checkpoint_session->>'exerciseId' = p_exercise_id and
        coalesce(v_checkpoint.payload->>'checkpointRevision', '') ~ '^[0-9]+$' and
        (v_checkpoint.payload->>'checkpointRevision')::bigint = v_checkpoint.checkpoint_revision and
        v_checkpoint.payload->>'payloadHash' = v_checkpoint.payload_hash and
        v_checkpoint.payload->>'provenanceHash' = v_checkpoint.provenance_hash and
        v_checkpoint.payload_hash ~ '^[0-9a-f]{64}$' and
        v_checkpoint.provenance_hash ~ '^[0-9a-f]{64}$' and
        jsonb_typeof(v_checkpoint.payload->'payload'->'persistedRuntimeStates') = 'array';
      v_runtime_items_valid := v_checkpoint_envelope_valid and not exists (
        select 1
        from jsonb_array_elements(v_checkpoint.payload->'payload'->'persistedRuntimeStates') item
        where coalesce(item->>'payloadHash', '') !~ '^[0-9a-f]{64}$'
           or item->'provenance'->>'exerciseId' is distinct from p_exercise_id
      );
    exception when others then
      v_checkpoint_envelope_valid := false;
      v_runtime_items_valid := false;
    end;
  end if;

  if not v_authorized then
    v_result := 'RECOVERY_NOT_AUTHORIZED';
  elsif not v_state_exists then
    v_result := 'RECOVERY_NOT_REQUIRED';
  elsif v_projection_lifecycle = 'COMPLETED' then
    v_result := 'ALREADY_TERMINAL';
  elsif not v_checkpoint_exists then
    v_result := 'MISSING_CHECKPOINT';
  elsif v_lease_exists and v_lease.released_at is null and v_lease.expires_at > v_now then
    v_result := 'ACTIVE_LEASE_PRESENT';
  elsif not v_checkpoint_envelope_valid or not v_runtime_items_valid then
    v_result := 'CHECKPOINT_INVALID';
  elsif v_checkpoint.checkpoint_revision > p_expected_checkpoint_revision then
    v_result := 'NEWER_CHECKPOINT_EXISTS';
  elsif v_checkpoint.checkpoint_revision <> p_expected_checkpoint_revision or
        v_row.revision <> p_expected_projection_revision or
        v_checkpoint.payload_hash is distinct from p_expected_payload_hash or
        v_checkpoint.provenance_hash is distinct from p_expected_provenance_hash then
    v_result := 'PACKAGE_IDENTITY_AMBIGUOUS';
  elsif v_projection_lifecycle not in ('RUNNING', 'PAUSED') or
        v_checkpoint_lifecycle is distinct from v_projection_lifecycle or
        v_projection_lifecycle is distinct from p_expected_lifecycle then
    v_result := 'LIFECYCLE_CONFLICT';
  elsif v_projection_version is null or v_checkpoint_version is null or
        v_projection_version <> v_checkpoint_version or
        v_projection_version <> p_expected_session_version then
    v_result := 'SESSION_VERSION_MISMATCH';
  elsif v_projection_package_id is null or v_projection_package_version is null or
        v_checkpoint_package_id is null or v_checkpoint_package_version is null or
        v_projection_package_id is distinct from p_expected_projection_package_id or
        v_projection_package_version is distinct from p_expected_projection_package_version or
        v_checkpoint_package_id is distinct from p_expected_checkpoint_package_id or
        v_checkpoint_package_version is distinct from p_expected_checkpoint_package_version then
    v_result := 'PACKAGE_IDENTITY_AMBIGUOUS';
  elsif (v_projection_package_id, v_projection_package_version) is not distinct from
        (v_checkpoint_package_id, v_checkpoint_package_version) then
    v_result := 'NOT_DIVERGENT';
  else
    v_projection_session := v_projection_session || jsonb_build_object(
      'lifecycleState', 'COMPLETED',
      'version', v_projection_version + 1,
      'lastCommandId', 'PACKAGE-DIVERGENCE-RECOVERY-' || p_exercise_id,
      'updatedAtWallClock', v_now
    );
    v_row.state := jsonb_set(v_row.state, '{exerciseSession}', v_projection_session, false);
    update public.exercise_states
    set state = v_row.state,
        revision = revision + 1,
        updated_at = v_now,
        updated_by = auth.uid()
    where exercise_id = p_exercise_id
    returning * into v_row;
    if v_lease_exists and v_lease.released_at is null then
      update public.runtime_writer_leases
      set released_at = v_now
      where exercise_id = p_exercise_id;
    end if;
    v_result := 'TERMINALIZED_DIVERGENT_STATE';
  end if;

  insert into public.exercise_runtime_recovery_audit(
    exercise_id, user_id, permission, assignment_ids, assignment_scopes,
    prior_lifecycle, persistence_failure, checkpoint_state, lease_state,
    result, checkpoint_revision, projection_revision, recovery_reason
  ) values (
    p_exercise_id, auth.uid(), 'EXERCISE_RUNTIME_RECOVERY',
    coalesce(v_assignment_ids, '{}'), coalesce(v_scopes, '{}'),
    v_projection_lifecycle, 'PACKAGE_PROJECTION_DIVERGENCE',
    case when not v_checkpoint_exists then 'MISSING'
         when v_checkpoint_envelope_valid and v_runtime_items_valid then 'CLIENT_VALIDATED_AND_ENVELOPE_MATCHED'
         else 'INVALID' end,
    case when v_lease_exists and v_lease.released_at is null and v_lease.expires_at > v_now then 'ACTIVE'
         when not v_lease_exists then 'ABSENT' else 'INACTIVE' end,
    v_result,
    case when v_checkpoint_exists then v_checkpoint.checkpoint_revision end,
    case when v_state_exists then v_row.revision end,
    'PACKAGE_PROJECTION_DIVERGENCE'
  ) returning id into v_audit;

  return query select v_result, v_audit,
    case when v_result in ('TERMINALIZED_DIVERGENT_STATE', 'ALREADY_TERMINAL') then v_row.state else null end;
end;
$$;

revoke all on function public.terminalize_package_projection_divergence(
  text, bigint, bigint, text, text, integer, text, text, text, text, text
) from public;
revoke all on function public.terminalize_package_projection_divergence(
  text, bigint, bigint, text, text, integer, text, text, text, text, text
) from anon;
grant execute on function public.terminalize_package_projection_divergence(
  text, bigint, bigint, text, text, integer, text, text, text, text, text
) to authenticated;
