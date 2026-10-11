-- WP-NARVA-10B27C: supported, audited trusted-administrator lifecycle for
-- exercise-scoped operator role assignments. Runtime and exercise state are
-- read only to these functions.

-- The original all-history uniqueness constraint prevented a revoked
-- assignment from remaining intact when the same role was granted again.
-- Preserve every revoked row and enforce uniqueness only for the active row.
alter table public.authorization_role_assignments
  drop constraint if exists authorization_role_assignment_user_id_role_scope_type_scope_key;

create unique index if not exists authorization_role_assignments_one_active_scope_idx
  on public.authorization_role_assignments (
    user_id,
    role,
    scope_type,
    coalesce(scope_id, '')
  )
  where status = 'ACTIVE';

create or replace function public.trusted_admin_grant_exercise_role(
  p_user_id uuid,
  p_exercise_id text,
  p_role text,
  p_issued_by uuid,
  p_expires_at timestamptz default null
)
returns public.authorization_role_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.authorization_role_assignments%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null or p_issued_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  if p_exercise_id is null
    or p_exercise_id <> btrim(p_exercise_id)
    or length(p_exercise_id) not between 1 and 160 then
    raise exception 'INVALID_EXERCISE_IDENTIFIER' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('CM', 'EXCON') then
    raise exception 'UNSUPPORTED_EXERCISE_ROLE' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'INVALID_ASSIGNMENT_EXPIRY' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.exercise_states as exercise_state
    where exercise_state.exercise_id = p_exercise_id
  ) then
    raise exception 'EXERCISE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from auth.users as target_user
    join public.operator_profiles as target_profile
      on target_profile.user_id = target_user.id
    where target_user.id = p_user_id
      and not target_user.is_anonymous
      and (target_user.banned_until is null or target_user.banned_until <= v_now)
      and target_profile.status = 'ACTIVE'
  ) then
    raise exception 'TARGET_OPERATOR_NOT_ACTIVE' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from auth.users as issuer
    where issuer.id = p_issued_by
      and not issuer.is_anonymous
      and (issuer.banned_until is null or issuer.banned_until <= v_now)
  ) then
    raise exception 'INVALID_ISSUER' using errcode = '22023';
  end if;

  -- Serialize grants for one semantic assignment identity. This complements
  -- the partial unique index and keeps retries deterministic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || E'\n' || p_role || E'\nEXERCISE\n' || p_exercise_id,
      0
    )
  );

  -- An elapsed assignment is no longer effective. Close it audibly before
  -- inserting a new row so its historical lifecycle remains immutable.
  update public.authorization_role_assignments
  set status = 'REVOKED',
      revoked_at = v_now,
      revoked_by = p_issued_by
  where user_id = p_user_id
    and role = p_role
    and scope_type = 'EXERCISE'
    and scope_id = p_exercise_id
    and status = 'ACTIVE'
    and expires_at is not null
    and expires_at <= v_now;

  select assignment.*
  into v_assignment
  from public.authorization_role_assignments as assignment
  where assignment.user_id = p_user_id
    and assignment.role = p_role
    and assignment.scope_type = 'EXERCISE'
    and assignment.scope_id = p_exercise_id
    and assignment.status = 'ACTIVE'
  for update;

  if found then
    if v_assignment.expires_at is distinct from p_expires_at then
      raise exception 'ACTIVE_ASSIGNMENT_CONFLICT' using errcode = '23505';
    end if;
    return v_assignment;
  end if;

  insert into public.authorization_role_assignments (
    user_id,
    role,
    scope_type,
    scope_id,
    status,
    issued_at,
    expires_at,
    issued_by
  ) values (
    p_user_id,
    p_role,
    'EXERCISE',
    p_exercise_id,
    'ACTIVE',
    v_now,
    p_expires_at,
    p_issued_by
  )
  returning * into v_assignment;

  return v_assignment;
end;
$$;

create or replace function public.trusted_admin_revoke_exercise_role(
  p_assignment_id uuid,
  p_exercise_id text,
  p_revoked_by uuid
)
returns public.authorization_role_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.authorization_role_assignments%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_assignment_id is null or p_revoked_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  if p_exercise_id is null
    or p_exercise_id <> btrim(p_exercise_id)
    or length(p_exercise_id) not between 1 and 160 then
    raise exception 'INVALID_EXERCISE_IDENTIFIER' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from auth.users as revoker
    where revoker.id = p_revoked_by
      and not revoker.is_anonymous
      and (revoker.banned_until is null or revoker.banned_until <= v_now)
  ) then
    raise exception 'INVALID_REVOKER' using errcode = '22023';
  end if;

  select assignment.*
  into v_assignment
  from public.authorization_role_assignments as assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_assignment.scope_type <> 'EXERCISE'
    or v_assignment.scope_id <> p_exercise_id then
    raise exception 'ASSIGNMENT_SCOPE_MISMATCH' using errcode = '42501';
  end if;
  if v_assignment.status = 'REVOKED' then
    return v_assignment;
  end if;

  update public.authorization_role_assignments
  set status = 'REVOKED',
      revoked_at = v_now,
      revoked_by = p_revoked_by
  where id = p_assignment_id
  returning * into v_assignment;

  return v_assignment;
end;
$$;

-- These definer functions are a backend administrative API, not a mobile
-- client capability. Possession of an ordinary authenticated CM/EXCON session
-- never grants execution; the service-role credential stays server-side.
revoke all on function public.trusted_admin_grant_exercise_role(uuid, text, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.trusted_admin_revoke_exercise_role(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.trusted_admin_grant_exercise_role(uuid, text, text, uuid, timestamptz)
  to service_role;
grant execute on function public.trusted_admin_revoke_exercise_role(uuid, text, uuid)
  to service_role;

comment on function public.trusted_admin_grant_exercise_role(uuid, text, text, uuid, timestamptz)
  is 'Service-role-only audited grant lifecycle for one exercise-scoped CM or EXCON assignment.';
comment on function public.trusted_admin_revoke_exercise_role(uuid, text, uuid)
  is 'Service-role-only audited revocation of one exact exercise-scoped assignment; rows are never deleted.';
