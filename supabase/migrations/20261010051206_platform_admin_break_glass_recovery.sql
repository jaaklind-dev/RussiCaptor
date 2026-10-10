-- Break-glass PLATFORM_ADMIN recovery is service-to-service only. A short-lived,
-- target-bound authorization is consumed in the same transaction as the role
-- change and its immutable audit entry. No exercise authority is touched.

alter table public.administrative_action_audit
  drop constraint administrative_action_audit_action_check;
alter table public.administrative_action_audit
  add constraint administrative_action_audit_action_check check (action in (
    'USER_INVITED', 'PASSWORD_RESET_REQUESTED', 'USER_DEACTIVATED',
    'USER_REACTIVATED', 'EXERCISE_BOOTSTRAP_GRANTED',
    'EXERCISE_BOOTSTRAP_REVOKED', 'CM_GRANTED', 'EXCON_GRANTED',
    'CM_REVOKED', 'EXCON_REVOKED',
    'PLATFORM_ADMIN_GRANTED', 'PLATFORM_ADMIN_REVOKED'
  ));

-- Recovery has a service mechanism actor, not a fabricated human actor.
alter table public.platform_admins alter column granted_by drop not null;
alter table public.platform_admins drop constraint platform_admins_check;
alter table public.platform_admins add constraint platform_admins_check check (
  (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
  or (status = 'REVOKED' and revoked_at is not null)
);

create table public.platform_admin_recovery_authorizations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  target_user_id uuid not null references auth.users(id),
  target_email text not null,
  operation text not null check (operation in ('GRANT', 'REVOKE')),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'REVOKED')),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  audit_id uuid references public.administrative_action_audit(id),
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  check ((status = 'CONSUMED') = (consumed_at is not null and audit_id is not null))
);

create index platform_admin_recovery_target_idx
  on public.platform_admin_recovery_authorizations (target_user_id, issued_at desc);
alter table public.platform_admin_recovery_authorizations enable row level security;
revoke all on table public.platform_admin_recovery_authorizations from public, anon, authenticated, service_role;
create policy "client cannot access platform administrator recovery"
  on public.platform_admin_recovery_authorizations for all to authenticated
  using (false) with check (false);

create or replace function public.trusted_admin_issue_platform_recovery(
  p_operation_id uuid,
  p_target_user_id uuid,
  p_target_email text,
  p_operation text,
  p_token_sha256 text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null or p_target_user_id is null
    or p_operation not in ('GRANT', 'REVOKE')
    or p_token_sha256 !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= v_now
    or p_expires_at > v_now + interval '10 minutes' then
    raise exception 'INVALID_RECOVERY_AUTHORIZATION' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users as target
    where target.id = p_target_user_id
      and lower(target.email) = lower(btrim(p_target_email))
      and target.deleted_at is null
      and not coalesce(target.is_anonymous, false)
  ) then
    raise exception 'RECOVERY_TARGET_MISMATCH' using errcode = '22023';
  end if;
  insert into public.platform_admin_recovery_authorizations (
    operation_id, target_user_id, target_email, operation,
    token_sha256, issued_at, expires_at
  ) values (
    p_operation_id, p_target_user_id, lower(btrim(p_target_email)), p_operation,
    p_token_sha256, v_now, p_expires_at
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.trusted_admin_apply_platform_recovery(
  p_authorization_id uuid,
  p_operation_id uuid,
  p_target_user_id uuid,
  p_target_email text,
  p_operation text,
  p_token_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.platform_admin_recovery_authorizations%rowtype;
  v_target auth.users%rowtype;
  v_now timestamptz := clock_timestamp();
  v_audit_id uuid;
begin
  select * into v_authorization
  from public.platform_admin_recovery_authorizations
  where id = p_authorization_id
  for update;
  if not found or v_authorization.status <> 'ACTIVE'
    or v_authorization.expires_at <= v_now
    or v_authorization.operation_id is distinct from p_operation_id
    or v_authorization.target_user_id is distinct from p_target_user_id
    or v_authorization.target_email is distinct from lower(btrim(p_target_email))
    or v_authorization.operation is distinct from p_operation
    or v_authorization.token_sha256 is distinct from p_token_sha256 then
    raise exception 'RECOVERY_AUTHORIZATION_INVALID' using errcode = '28000';
  end if;

  select * into v_target from auth.users where id = p_target_user_id;
  if not found or v_target.deleted_at is not null
    or coalesce(v_target.is_anonymous, false)
    or lower(v_target.email) is distinct from v_authorization.target_email then
    raise exception 'RECOVERY_TARGET_MISMATCH' using errcode = '22023';
  end if;

  if p_operation = 'GRANT' then
    if v_target.email_confirmed_at is null then
      raise exception 'RECOVERY_TARGET_UNCONFIRMED' using errcode = '22023';
    end if;
    if v_target.banned_until is not null and v_target.banned_until > v_now then
      raise exception 'RECOVERY_TARGET_BANNED' using errcode = '22023';
    end if;
    if not exists (select 1 from public.operator_profiles
      where user_id = p_target_user_id and status = 'ACTIVE') then
      raise exception 'RECOVERY_TARGET_INACTIVE' using errcode = '22023';
    end if;
    if exists (select 1 from public.platform_admins
      where user_id = p_target_user_id and status = 'ACTIVE') then
      raise exception 'PLATFORM_ADMIN_ALREADY_ACTIVE' using errcode = '23505';
    end if;
    insert into public.platform_admins (user_id, status, granted_at, granted_by,
      revoked_at, revoked_by)
    values (p_target_user_id, 'ACTIVE', v_now, null, null, null)
    on conflict (user_id) do update set
      status = 'ACTIVE', granted_at = excluded.granted_at,
      granted_by = null, revoked_at = null, revoked_by = null;
  else
    update public.platform_admins set status = 'REVOKED',
      revoked_at = v_now, revoked_by = null
    where user_id = p_target_user_id and status = 'ACTIVE';
    if not found then
      raise exception 'PLATFORM_ADMIN_NOT_ACTIVE' using errcode = 'P0002';
    end if;
  end if;

  insert into public.administrative_action_audit (
    actor_user_id, action, target_user_id, outcome, details, occurred_at
  ) values (
    null,
    case when p_operation = 'GRANT' then 'PLATFORM_ADMIN_GRANTED'
      else 'PLATFORM_ADMIN_REVOKED' end,
    p_target_user_id,
    'SUCCESS',
    pg_catalog.jsonb_build_object(
      'mechanism', 'SERVICE_ROLE_BREAK_GLASS',
      'authorizationId', p_authorization_id,
      'operationId', p_operation_id,
      'scope', 'PLATFORM_ADMIN'
    ),
    v_now
  ) returning id into v_audit_id;

  update public.platform_admin_recovery_authorizations
  set status = 'CONSUMED', consumed_at = v_now, audit_id = v_audit_id
  where id = p_authorization_id;

  return pg_catalog.jsonb_build_object(
    'targetUserId', p_target_user_id,
    'operation', p_operation,
    'auditId', v_audit_id,
    'status', case when p_operation = 'GRANT' then 'ACTIVE' else 'REVOKED' end
  );
end;
$$;

create or replace function public.trusted_admin_cancel_platform_recovery(
  p_authorization_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.platform_admin_recovery_authorizations
  set status = 'REVOKED'
  where id = p_authorization_id and status = 'ACTIVE';
  return found;
end;
$$;

create or replace function public.trusted_admin_platform_recovery_status(
  p_operation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'operationId', recovery.operation_id,
    'targetUserId', recovery.target_user_id,
    'operation', recovery.operation,
    'status', recovery.status,
    'auditId', recovery.audit_id,
    'expiresAt', recovery.expires_at
  ) from public.platform_admin_recovery_authorizations as recovery
  where recovery.operation_id = p_operation_id;
$$;

-- Remove the legacy, unaudited grant/revoke entry points from service_role.
-- Existing ordinary Admin services use neither function.
revoke all on function public.trusted_admin_grant_platform_admin(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.trusted_admin_revoke_platform_admin(uuid, uuid) from public, anon, authenticated, service_role;
revoke insert, update on table public.platform_admins from service_role;

revoke all on function public.trusted_admin_issue_platform_recovery(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.trusted_admin_apply_platform_recovery(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.trusted_admin_cancel_platform_recovery(uuid)
  from public, anon, authenticated;
revoke all on function public.trusted_admin_platform_recovery_status(uuid)
  from public, anon, authenticated;
grant execute on function public.trusted_admin_issue_platform_recovery(uuid, uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.trusted_admin_apply_platform_recovery(uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.trusted_admin_cancel_platform_recovery(uuid)
  to service_role;
grant execute on function public.trusted_admin_platform_recovery_status(uuid)
  to service_role;
