-- WP-NARVA-10B30C: one-shot, service-role-provisioned authorization for the
-- first READY projection of a new exercise.  This is deliberately separate
-- from GLOBAL EXCON: it cannot join, control, recover, import into, or acquire
-- Runtime authority for an existing exercise.

create table if not exists public.exercise_bootstrap_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  purpose text not null check (length(btrim(purpose)) between 1 and 160),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  issued_by uuid not null references auth.users(id),
  consumed_exercise_id text,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  constraint exercise_bootstrap_expiry_check check (expires_at > issued_at),
  constraint exercise_bootstrap_consumption_pair_check check (
    (consumed_exercise_id is null and consumed_at is null)
    or (consumed_exercise_id is not null and consumed_at is not null)
  ),
  constraint exercise_bootstrap_revocation_pair_check check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null)
  )
);

alter table public.exercise_bootstrap_authorizations enable row level security;

create unique index if not exists exercise_bootstrap_one_active_per_user_idx
  on public.exercise_bootstrap_authorizations (user_id)
  where status = 'ACTIVE';

create unique index if not exists exercise_bootstrap_one_consumed_exercise_idx
  on public.exercise_bootstrap_authorizations (consumed_exercise_id)
  where consumed_exercise_id is not null;

drop policy if exists "operator reads own exercise bootstrap authorization"
  on public.exercise_bootstrap_authorizations;
create policy "operator reads own exercise bootstrap authorization"
  on public.exercise_bootstrap_authorizations
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.exercise_bootstrap_authorizations from public, anon, authenticated;
grant select on table public.exercise_bootstrap_authorizations to authenticated;
grant select, insert, update on table public.exercise_bootstrap_authorizations to service_role;

create or replace function public.trusted_admin_grant_exercise_bootstrap(
  p_user_id uuid,
  p_issued_by uuid,
  p_expires_at timestamptz,
  p_purpose text default 'FRESH_EXERCISE_BOOTSTRAP'
)
returns public.exercise_bootstrap_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.exercise_bootstrap_authorizations%rowtype;
  v_now timestamptz := clock_timestamp();
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if p_user_id is null or p_issued_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  if p_expires_at is null
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '15 minutes' then
    raise exception 'INVALID_BOOTSTRAP_EXPIRY' using errcode = '22023';
  end if;
  if length(v_purpose) not between 1 and 160 then
    raise exception 'INVALID_BOOTSTRAP_PURPOSE' using errcode = '22023';
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('EXERCISE_BOOTSTRAP' || E'\n' || p_user_id::text, 0)
  );

  update public.exercise_bootstrap_authorizations
  set status = 'REVOKED',
      revoked_at = v_now,
      revoked_by = p_issued_by
  where user_id = p_user_id
    and status = 'ACTIVE'
    and expires_at <= v_now;

  select bootstrap.*
  into v_authorization
  from public.exercise_bootstrap_authorizations as bootstrap
  where bootstrap.user_id = p_user_id
    and bootstrap.status = 'ACTIVE'
  for update;

  if found then
    if v_authorization.expires_at is distinct from p_expires_at
      or v_authorization.purpose is distinct from v_purpose then
      raise exception 'ACTIVE_BOOTSTRAP_CONFLICT' using errcode = '23505';
    end if;
    return v_authorization;
  end if;

  insert into public.exercise_bootstrap_authorizations (
    user_id,
    status,
    purpose,
    issued_at,
    expires_at,
    issued_by
  ) values (
    p_user_id,
    'ACTIVE',
    v_purpose,
    v_now,
    p_expires_at,
    p_issued_by
  )
  returning * into v_authorization;

  return v_authorization;
end;
$$;

create or replace function public.trusted_admin_revoke_exercise_bootstrap(
  p_bootstrap_id uuid,
  p_revoked_by uuid
)
returns public.exercise_bootstrap_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.exercise_bootstrap_authorizations%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_bootstrap_id is null or p_revoked_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
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

  select bootstrap.*
  into v_authorization
  from public.exercise_bootstrap_authorizations as bootstrap
  where bootstrap.id = p_bootstrap_id
  for update;

  if not found then
    raise exception 'BOOTSTRAP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_authorization.status = 'REVOKED' then
    return v_authorization;
  end if;

  update public.exercise_bootstrap_authorizations
  set status = 'REVOKED',
      revoked_at = v_now,
      revoked_by = p_revoked_by
  where id = p_bootstrap_id
  returning * into v_authorization;

  return v_authorization;
end;
$$;

create or replace function public.has_exercise_bootstrap_authorization(
  p_exercise_id text default null
)
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
      from public.operator_profiles as profile
      join public.exercise_bootstrap_authorizations as bootstrap
        on bootstrap.user_id = profile.user_id
      where profile.user_id = (select auth.uid())
        and profile.status = 'ACTIVE'
        and bootstrap.status = 'ACTIVE'
        and bootstrap.expires_at > now()
        and (
          p_exercise_id is null
          or bootstrap.consumed_exercise_id = p_exercise_id
        )
    );
$$;

create or replace function public.has_authorization_permission(
  p_permission text,
  p_exercise_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
    and p_permission in (
      'EXERCISE_JOIN', 'CM_WORKFLOW_WRITE', 'EXCON_EXERCISE_CONTROL',
      'EXERCISE_PACKAGE_IMPORT', 'INSTRUCTOR_EVALUATION_READ',
      'INSTRUCTOR_EVALUATION_WRITE', 'EXERCISE_RUNTIME_RECOVERY',
      'EXERCISE_BOOTSTRAP_CREATE'
    )
    and (
      (
        p_permission = 'EXERCISE_BOOTSTRAP_CREATE'
        and public.has_exercise_bootstrap_authorization(p_exercise_id)
      )
      or (
        p_permission <> 'EXERCISE_BOOTSTRAP_CREATE'
        and exists (
          select 1
          from public.operator_profiles as profile
          join public.authorization_role_assignments as assignment
            on assignment.user_id = profile.user_id
          where profile.user_id = (select auth.uid())
            and profile.status = 'ACTIVE'
            and assignment.status = 'ACTIVE'
            and (assignment.expires_at is null or assignment.expires_at > now())
            and (
              (assignment.role = 'CM' and p_permission in ('EXERCISE_JOIN', 'CM_WORKFLOW_WRITE'))
              or (
                assignment.role = 'EXCON'
                and p_permission in (
                  'EXERCISE_JOIN', 'EXCON_EXERCISE_CONTROL',
                  'EXERCISE_PACKAGE_IMPORT', 'INSTRUCTOR_EVALUATION_READ',
                  'INSTRUCTOR_EVALUATION_WRITE', 'EXERCISE_RUNTIME_RECOVERY'
                )
              )
            )
            and (
              assignment.scope_type = 'GLOBAL'
              or (
                assignment.scope_type = 'EXERCISE'
                and p_exercise_id is not null
                and assignment.scope_id = p_exercise_id
              )
            )
            and (p_permission <> 'EXERCISE_PACKAGE_IMPORT' or assignment.scope_type = 'GLOBAL')
        )
      )
    );
$$;

alter table public.authorization_audit
  drop constraint if exists authorization_audit_permission_check;
alter table public.authorization_audit
  add constraint authorization_audit_permission_check check (
    permission in (
      'EXERCISE_JOIN', 'CM_WORKFLOW_WRITE', 'EXCON_EXERCISE_CONTROL',
      'EXERCISE_PACKAGE_IMPORT', 'INSTRUCTOR_EVALUATION_READ',
      'INSTRUCTOR_EVALUATION_WRITE', 'EXERCISE_RUNTIME_RECOVERY',
      'EXERCISE_BOOTSTRAP_CREATE'
    )
  );

create or replace function public.record_authorization_decision(
  p_permission text,
  p_exercise_id text,
  p_operation text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_authorized boolean;
  v_assignments uuid[];
begin
  if (select auth.uid()) is null
    or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_permission not in (
    'EXERCISE_JOIN', 'CM_WORKFLOW_WRITE', 'EXCON_EXERCISE_CONTROL',
    'EXERCISE_PACKAGE_IMPORT', 'INSTRUCTOR_EVALUATION_READ',
    'INSTRUCTOR_EVALUATION_WRITE', 'EXERCISE_RUNTIME_RECOVERY',
    'EXERCISE_BOOTSTRAP_CREATE'
  ) then
    raise exception 'UNSUPPORTED_PERMISSION';
  end if;

  v_authorized := public.has_authorization_permission(p_permission, p_exercise_id);
  if p_permission = 'EXERCISE_BOOTSTRAP_CREATE' then
    select coalesce(array_agg(id order by id), '{}')
    into v_assignments
    from public.exercise_bootstrap_authorizations
    where user_id = (select auth.uid())
      and status = 'ACTIVE'
      and expires_at > now()
      and (p_exercise_id is null or consumed_exercise_id = p_exercise_id);
  else
    select coalesce(array_agg(id order by id), '{}')
    into v_assignments
    from public.authorization_role_assignments
    where user_id = (select auth.uid())
      and status = 'ACTIVE'
      and (expires_at is null or expires_at > now())
      and (
        scope_type = 'GLOBAL'
        or (scope_type = 'EXERCISE' and scope_id = p_exercise_id)
      );
  end if;

  insert into public.authorization_audit (
    user_id, permission, exercise_id, operation, decision, reason, freshness, assignment_ids
  ) values (
    (select auth.uid()), p_permission, p_exercise_id, p_operation,
    case when v_authorized then 'AUTHORIZED' else 'DENIED' end,
    case when v_authorized then null else 'PERMISSION_DENIED' end,
    'VERIFIED_ONLINE', v_assignments
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_exercise_bootstrap_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_authorization public.exercise_bootstrap_authorizations%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if public.has_authorization_permission('EXCON_EXERCISE_CONTROL', new.exercise_id) then
    return new;
  end if;
  if v_user_id is null
    or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('EXERCISE_BOOTSTRAP' || E'\n' || v_user_id::text, 0)
  );

  select bootstrap.*
  into v_authorization
  from public.exercise_bootstrap_authorizations as bootstrap
  where bootstrap.user_id = v_user_id
    and bootstrap.status = 'ACTIVE'
    and bootstrap.expires_at > v_now
    and bootstrap.consumed_exercise_id is null
  for update;

  if not found then
    return new;
  end if;

  if new.revision <> 1
    or new.updated_by is distinct from v_user_id
    or new.exercise_id is null
    or new.exercise_id <> btrim(new.exercise_id)
    or length(new.exercise_id) not between 1 and 160
    or new.state->'exerciseSession'->>'exerciseId' is distinct from new.exercise_id
    or new.state->'exerciseSession'->>'lifecycleState' is distinct from 'READY'
    or new.state->'exerciseSession'->>'simulationTimeSec' is distinct from '0'
    or new.state->'exerciseSession'->>'speed' is distinct from '1'
    or coalesce(new.state->'exerciseSession'->>'lastCommandId', '') not like 'PREPARE-%'
    or length(coalesce(new.state->'exercisePackageReference'->>'packageId', '')) = 0
    or length(coalesce(new.state->'exercisePackageReference'->>'packageVersion', '')) = 0 then
    raise exception 'BOOTSTRAP_INITIAL_READY_PROJECTION_REQUIRED' using errcode = '42501';
  end if;

  update public.exercise_bootstrap_authorizations
  set consumed_exercise_id = new.exercise_id,
      consumed_at = v_now
  where id = v_authorization.id;

  return new;
end;
$$;

drop trigger if exists claim_exercise_bootstrap_before_insert on public.exercise_states;
create trigger claim_exercise_bootstrap_before_insert
before insert on public.exercise_states
for each row execute function public.claim_exercise_bootstrap_authorization();

-- Bootstrap may insert exactly the first validated READY projection and read
-- that one bound row.  It cannot update it, create a Runtime lease/checkpoint,
-- or see any unrelated exercise.
drop policy if exists "scoped operators read exercise state" on public.exercise_states;
create policy "scoped operators read exercise state" on public.exercise_states
for select to authenticated
using (
  public.has_authorization_permission('EXERCISE_JOIN', exercise_id)
  or public.has_exercise_bootstrap_authorization(exercise_id)
);

drop policy if exists "excon creates exercise state" on public.exercise_states;
create policy "excon creates exercise state" on public.exercise_states
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and (
    public.has_authorization_permission('EXCON_EXERCISE_CONTROL', exercise_id)
    or public.has_exercise_bootstrap_authorization(exercise_id)
  )
);

revoke all on function public.trusted_admin_grant_exercise_bootstrap(uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.trusted_admin_revoke_exercise_bootstrap(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.trusted_admin_grant_exercise_bootstrap(uuid, uuid, timestamptz, text)
  to service_role;
grant execute on function public.trusted_admin_revoke_exercise_bootstrap(uuid, uuid)
  to service_role;

revoke all on function public.has_exercise_bootstrap_authorization(text) from public, anon;
grant execute on function public.has_exercise_bootstrap_authorization(text) to authenticated;
revoke all on function public.claim_exercise_bootstrap_authorization() from public, anon, authenticated;

comment on table public.exercise_bootstrap_authorizations
  is 'Audited, short-lived, one-shot authority for one operator to register one fresh READY exercise projection.';
comment on function public.trusted_admin_grant_exercise_bootstrap(uuid, uuid, timestamptz, text)
  is 'Service-role-only grant for a maximum fifteen-minute, one-shot fresh-exercise bootstrap.';
comment on function public.trusted_admin_revoke_exercise_bootstrap(uuid, uuid)
  is 'Service-role-only idempotent revocation; the authorization row and consumption audit are retained.';
