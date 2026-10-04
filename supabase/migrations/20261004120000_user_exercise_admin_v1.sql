-- USER-EXERCISE-ADMIN-V1: a platform-administration boundary that is
-- deliberately independent from exercise-scoped CM and EXCON authority.

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  granted_at timestamptz not null default now(),
  granted_by uuid not null references auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null)
  )
);

create table public.administrative_action_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null check (action in (
    'USER_INVITED', 'PASSWORD_RESET_REQUESTED', 'USER_DEACTIVATED',
    'USER_REACTIVATED', 'EXERCISE_BOOTSTRAP_GRANTED', 'CM_GRANTED',
    'EXCON_GRANTED', 'CM_REVOKED', 'EXCON_REVOKED'
  )),
  target_user_id uuid references auth.users(id),
  exercise_id text,
  outcome text not null check (outcome in ('SUCCESS', 'FAILURE', 'DENIED')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (jsonb_typeof(details) = 'object')
);

create index administrative_action_audit_actor_time_idx
  on public.administrative_action_audit (actor_user_id, occurred_at desc);
create index administrative_action_audit_exercise_time_idx
  on public.administrative_action_audit (exercise_id, occurred_at desc)
  where exercise_id is not null;

alter table public.platform_admins enable row level security;
alter table public.administrative_action_audit enable row level security;

-- There are intentionally no client table policies. The authenticated client
-- gets only the bounded self-check RPC; all management stays server-side.
revoke all on table public.platform_admins from public, anon, authenticated;
revoke all on table public.administrative_action_audit from public, anon, authenticated;
grant select, insert, update on table public.platform_admins to service_role;
grant select, insert on table public.administrative_action_audit to service_role;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
    and exists (
      select 1
      from public.platform_admins as administrator
      join public.operator_profiles as profile on profile.user_id = administrator.user_id
      where administrator.user_id = (select auth.uid())
        and administrator.status = 'ACTIVE'
        and profile.status = 'ACTIVE'
    );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.trusted_admin_grant_platform_admin(
  p_user_id uuid,
  p_granted_by uuid
)
returns public.platform_admins
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.platform_admins%rowtype;
begin
  if p_user_id is null or p_granted_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users as target
    join public.operator_profiles as profile on profile.user_id = target.id
    where target.id = p_user_id and not target.is_anonymous
      and profile.status = 'ACTIVE'
  ) then
    raise exception 'TARGET_OPERATOR_NOT_ACTIVE' using errcode = '22023';
  end if;
  insert into public.platform_admins (user_id, status, granted_at, granted_by)
  values (p_user_id, 'ACTIVE', clock_timestamp(), p_granted_by)
  on conflict (user_id) do update set
    status = 'ACTIVE', granted_at = excluded.granted_at,
    granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
  returning * into v_admin;
  return v_admin;
end;
$$;

create or replace function public.trusted_admin_revoke_platform_admin(
  p_user_id uuid,
  p_revoked_by uuid
)
returns public.platform_admins
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.platform_admins%rowtype;
begin
  if p_user_id is null or p_revoked_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  update public.platform_admins set status = 'REVOKED',
    revoked_at = clock_timestamp(), revoked_by = p_revoked_by
  where user_id = p_user_id and status = 'ACTIVE'
  returning * into v_admin;
  if not found then raise exception 'PLATFORM_ADMIN_NOT_FOUND' using errcode = 'P0002'; end if;
  return v_admin;
end;
$$;

create or replace function public.trusted_admin_upsert_operator_profile(
  p_user_id uuid,
  p_display_name text,
  p_status text,
  p_updated_by uuid
)
returns public.operator_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.operator_profiles%rowtype;
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if p_user_id is null or p_updated_by is null or length(v_name) not between 1 and 120
    or p_status not in ('ACTIVE', 'DISABLED') then
    raise exception 'INVALID_OPERATOR_PROFILE' using errcode = '22023';
  end if;
  insert into public.operator_profiles (user_id, display_name, status, created_at, updated_at, updated_by)
  values (p_user_id, v_name, p_status, clock_timestamp(), clock_timestamp(), p_updated_by)
  on conflict (user_id) do update set display_name = excluded.display_name,
    status = excluded.status, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.trusted_admin_record_action(
  p_actor_user_id uuid,
  p_action text,
  p_target_user_id uuid default null,
  p_exercise_id text default null,
  p_outcome text default 'SUCCESS',
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_actor_user_id is null or p_action is null or p_outcome is null
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ADMIN_AUDIT' using errcode = '22023';
  end if;
  insert into public.administrative_action_audit (
    actor_user_id, action, target_user_id, exercise_id, outcome, details
  ) values (
    p_actor_user_id, p_action, p_target_user_id, p_exercise_id, p_outcome,
    coalesce(p_details, '{}'::jsonb) - 'password' - 'token' - 'secret'
  ) returning id into v_id;
  return v_id;
end;
$$;

-- These are trusted server operations, never mobile-client capabilities.
revoke all on function public.trusted_admin_grant_platform_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.trusted_admin_revoke_platform_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.trusted_admin_upsert_operator_profile(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.trusted_admin_record_action(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.trusted_admin_grant_platform_admin(uuid, uuid) to service_role;
grant execute on function public.trusted_admin_revoke_platform_admin(uuid, uuid) to service_role;
grant execute on function public.trusted_admin_upsert_operator_profile(uuid, text, text, uuid) to service_role;
grant execute on function public.trusted_admin_record_action(uuid, text, uuid, text, text, jsonb) to service_role;

comment on table public.platform_admins is 'Narrow platform administrator allow-list; never implies CM, EXCON, patient ownership or writer authority.';
comment on table public.administrative_action_audit is 'Bounded audit evidence for platform administration; secrets and credentials are prohibited.';
