-- Run only on a disposable/local database after the recovery migration.
-- Every effect is rolled back; never use this as a production grant procedure.
begin;

do $$
declare
  v_target uuid;
  v_email text;
  v_operation uuid := gen_random_uuid();
  v_authorization uuid;
  v_revoke_operation uuid := gen_random_uuid();
  v_revoke_authorization uuid;
  v_result jsonb;
  v_audit uuid;
  v_role_count bigint;
  v_lease_count bigint;
  v_owner_count bigint;
begin
  select users.id, users.email into v_target, v_email
  from auth.users as users
  join public.operator_profiles as profile on profile.user_id = users.id
  left join public.platform_admins as administrator
    on administrator.user_id = users.id and administrator.status = 'ACTIVE'
  where profile.status = 'ACTIVE' and users.email_confirmed_at is not null
    and (users.banned_until is null or users.banned_until <= clock_timestamp())
    and administrator.user_id is null
  order by users.id limit 1;
  if v_target is null then
    raise exception 'Recovery smoke needs one active confirmed non-admin fixture';
  end if;

  select count(*) into v_role_count from public.authorization_role_assignments
  where user_id = v_target and status = 'ACTIVE';
  select count(*) into v_lease_count from public.runtime_writer_leases
  where writer_user_id = v_target and released_at is null;
  select count(*) into v_owner_count from public.shared_workflow_patient_states
  where owner_user_id = v_target;

  v_authorization := public.trusted_admin_issue_platform_recovery(
    v_operation, v_target, v_email, 'GRANT', repeat('a', 64),
    clock_timestamp() + interval '5 minutes');
  v_result := public.trusted_admin_apply_platform_recovery(
    v_authorization, v_operation, v_target, v_email, 'GRANT', repeat('a', 64));
  v_audit := (v_result->>'auditId')::uuid;
  if v_result->>'status' <> 'ACTIVE'
    or not exists (select 1 from public.platform_admins
      where user_id = v_target and status = 'ACTIVE')
    or not exists (select 1 from public.administrative_action_audit
      where id = v_audit and action = 'PLATFORM_ADMIN_GRANTED'
        and target_user_id = v_target and actor_user_id is null) then
    raise exception 'Atomic grant or audit failed';
  end if;

  begin
    perform public.trusted_admin_apply_platform_recovery(
      v_authorization, v_operation, v_target, v_email, 'GRANT', repeat('a', 64));
    raise exception 'Consumed authorization replayed';
  exception when invalid_authorization_specification then null;
  end;

  v_revoke_authorization := public.trusted_admin_issue_platform_recovery(
    v_revoke_operation, v_target, v_email, 'REVOKE', repeat('b', 64),
    clock_timestamp() + interval '5 minutes');
  v_result := public.trusted_admin_apply_platform_recovery(
    v_revoke_authorization, v_revoke_operation, v_target, v_email,
    'REVOKE', repeat('b', 64));
  if v_result->>'status' <> 'REVOKED'
    or not exists (select 1 from public.administrative_action_audit
      where id = (v_result->>'auditId')::uuid
        and action = 'PLATFORM_ADMIN_REVOKED')
    or not exists (select 1 from auth.users where id = v_target)
    or (select count(*) from public.authorization_role_assignments
        where user_id = v_target and status = 'ACTIVE') <> v_role_count
    or (select count(*) from public.runtime_writer_leases
        where writer_user_id = v_target and released_at is null) <> v_lease_count
    or (select count(*) from public.shared_workflow_patient_states
        where owner_user_id = v_target) <> v_owner_count then
    raise exception 'Revoke altered account, scope or runtime authority';
  end if;
end;
$$;

-- Ordinary authenticated users cannot issue or apply break-glass operations.
set local role authenticated;
do $$ begin
  begin
    perform public.trusted_admin_issue_platform_recovery(
      gen_random_uuid(), gen_random_uuid(), 'nobody@example.invalid', 'GRANT',
      repeat('a', 64), clock_timestamp() + interval '5 minutes');
    raise exception 'Authenticated recovery unexpectedly executed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
