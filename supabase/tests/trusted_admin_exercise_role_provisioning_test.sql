-- Transactional smoke for WP-NARVA-10B27C. It changes only authorization
-- assignments and rolls every test row back.
begin;

do $$
declare
  v_target uuid;
  v_issuer uuid;
  v_exercise_id text;
  v_first public.authorization_role_assignments%rowtype;
  v_retry public.authorization_role_assignments%rowtype;
  v_revoked public.authorization_role_assignments%rowtype;
  v_regrant public.authorization_role_assignments%rowtype;
  v_global_count_before bigint;
  v_global_count_after bigint;
  v_exercise_revision_before bigint;
  v_exercise_revision_after bigint;
  v_expiry timestamptz := now() + interval '30 minutes';
begin
  select profile.user_id
  into v_target
  from public.operator_profiles as profile
  join auth.users as auth_user on auth_user.id = profile.user_id
  where profile.status = 'ACTIVE'
    and not auth_user.is_anonymous
  order by profile.user_id
  limit 1;

  select auth_user.id
  into v_issuer
  from auth.users as auth_user
  where not auth_user.is_anonymous
  order by auth_user.created_at
  limit 1;

  select exercise_state.exercise_id, exercise_state.revision
  into v_exercise_id, v_exercise_revision_before
  from public.exercise_states as exercise_state
  order by exercise_state.updated_at desc
  limit 1;

  if v_target is null or v_issuer is null or v_exercise_id is null then
    raise exception 'Trusted-admin smoke requires one active permanent operator and one exercise';
  end if;

  select count(*) into v_global_count_before
  from public.authorization_role_assignments
  where scope_type = 'GLOBAL';

  v_first := public.trusted_admin_grant_exercise_role(
    v_target,
    v_exercise_id,
    'EXCON',
    v_issuer,
    v_expiry
  );
  v_retry := public.trusted_admin_grant_exercise_role(
    v_target,
    v_exercise_id,
    'EXCON',
    v_issuer,
    v_expiry
  );

  if v_first.id <> v_retry.id then
    raise exception 'Identical grant retry created a duplicate';
  end if;
  if (
    select count(*)
    from public.authorization_role_assignments
    where user_id = v_target
      and role = 'EXCON'
      and scope_type = 'EXERCISE'
      and scope_id = v_exercise_id
      and status = 'ACTIVE'
  ) <> 1 then
    raise exception 'Expected exactly one active assignment';
  end if;

  v_revoked := public.trusted_admin_revoke_exercise_role(
    v_first.id,
    v_exercise_id,
    v_issuer
  );
  if v_revoked.status <> 'REVOKED'
    or v_revoked.revoked_at is null
    or v_revoked.revoked_by <> v_issuer then
    raise exception 'Revocation audit fields were not preserved';
  end if;

  v_regrant := public.trusted_admin_grant_exercise_role(
    v_target,
    v_exercise_id,
    'EXCON',
    v_issuer,
    v_expiry
  );
  if v_regrant.id = v_first.id then
    raise exception 'Re-grant overwrote the revoked audit row';
  end if;
  perform public.trusted_admin_revoke_exercise_role(
    v_regrant.id,
    v_exercise_id,
    v_issuer
  );

  select count(*) into v_global_count_after
  from public.authorization_role_assignments
  where scope_type = 'GLOBAL';
  if v_global_count_after <> v_global_count_before then
    raise exception 'GLOBAL assignments changed';
  end if;

  select exercise_state.revision
  into v_exercise_revision_after
  from public.exercise_states as exercise_state
  where exercise_state.exercise_id = v_exercise_id;
  if v_exercise_revision_after <> v_exercise_revision_before then
    raise exception 'Operational exercise state changed';
  end if;
end;
$$;

-- Ordinary authenticated users, including CM and EXCON operators, cannot call
-- the trusted-admin RPC. Function ACLs fail before any row mutation occurs.
set local role authenticated;
do $$
begin
  begin
    perform public.trusted_admin_grant_exercise_role(
      gen_random_uuid(),
      'UNAUTHORIZED-EXERCISE',
      'EXCON',
      gen_random_uuid(),
      null
    );
    raise exception 'Authenticated grant unexpectedly executed';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.trusted_admin_revoke_exercise_role(
      gen_random_uuid(),
      'UNAUTHORIZED-EXERCISE',
      gen_random_uuid()
    );
    raise exception 'Authenticated revoke unexpectedly executed';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform public.trusted_admin_grant_exercise_role(
      gen_random_uuid(),
      'ANONYMOUS-EXERCISE',
      'CM',
      gen_random_uuid(),
      null
    );
    raise exception 'Anonymous grant unexpectedly executed';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
