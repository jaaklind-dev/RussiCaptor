-- WP-41A / ADR-018: authoritative application role and permission foundation.
-- Existing Runtime and exercise-control tables are intentionally unchanged.

create table if not exists public.authorization_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('EXCON')),
  scope_type text not null check (scope_type in ('GLOBAL', 'EXERCISE')),
  scope_id text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  issued_by uuid not null references auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  check (
    (scope_type = 'GLOBAL' and scope_id is null)
    or (scope_type = 'EXERCISE' and nullif(btrim(scope_id), '') is not null)
  ),
  check (expires_at is null or expires_at > issued_at),
  check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null)
  ),
  unique nulls not distinct (user_id, role, scope_type, scope_id)
);

create index if not exists authorization_role_assignments_user_status_idx
  on public.authorization_role_assignments (user_id, status);

alter table public.authorization_role_assignments enable row level security;

drop policy if exists "users can read own authorization assignments" on public.authorization_role_assignments;
create policy "users can read own authorization assignments"
on public.authorization_role_assignments for select to authenticated
using (user_id = auth.uid());

-- No client INSERT/UPDATE/DELETE policy is defined. Provisioning and revocation
-- require a trusted SQL migration, service-role backend or future admin service.

create or replace function public.has_authorization_permission(
  p_permission text,
  p_exercise_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and p_permission in ('INSTRUCTOR_EVALUATION_READ', 'INSTRUCTOR_EVALUATION_WRITE')
    and exists (
      select 1
      from public.authorization_role_assignments assignment
      where assignment.user_id = auth.uid()
        and assignment.role = 'EXCON'
        and assignment.status = 'ACTIVE'
        and (assignment.expires_at is null or assignment.expires_at > now())
        and (
          assignment.scope_type = 'GLOBAL'
          or (
            assignment.scope_type = 'EXERCISE'
            and p_exercise_id is not null
            and assignment.scope_id = p_exercise_id
          )
        )
    );
$$;

revoke all on function public.has_authorization_permission(text, text) from public;
grant execute on function public.has_authorization_permission(text, text) to authenticated;

create table if not exists public.authorization_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  permission text not null check (permission in ('INSTRUCTOR_EVALUATION_READ', 'INSTRUCTOR_EVALUATION_WRITE')),
  exercise_id text,
  operation text not null,
  decision text not null check (decision in ('AUTHORIZED', 'DENIED')),
  reason text,
  freshness text check (freshness in ('VERIFIED_ONLINE', 'VERIFIED_CACHED', 'STALE', 'UNAVAILABLE')),
  assignment_ids uuid[] not null default '{}',
  occurred_at timestamptz not null default now()
);

create index if not exists authorization_audit_user_occurred_idx
  on public.authorization_audit (user_id, occurred_at desc);

alter table public.authorization_audit enable row level security;

drop policy if exists "users can read own authorization audit" on public.authorization_audit;
create policy "users can read own authorization audit"
on public.authorization_audit for select to authenticated
using (user_id = auth.uid());

drop function if exists public.record_authorization_decision(text, text, text, text, text, text, uuid[]);

create or replace function public.record_authorization_decision(
  p_permission text,
  p_exercise_id text,
  p_operation text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_authorized boolean;
  v_assignments uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_permission not in ('INSTRUCTOR_EVALUATION_READ', 'INSTRUCTOR_EVALUATION_WRITE') then raise exception 'Unsupported permission'; end if;
  v_authorized := public.has_authorization_permission(p_permission, p_exercise_id);
  select coalesce(array_agg(assignment.id order by assignment.id), '{}') into v_assignments
  from public.authorization_role_assignments assignment
  where assignment.user_id = auth.uid() and assignment.role = 'EXCON' and assignment.status = 'ACTIVE'
    and (assignment.expires_at is null or assignment.expires_at > now())
    and (assignment.scope_type = 'GLOBAL' or (assignment.scope_type = 'EXERCISE' and assignment.scope_id = p_exercise_id));
  insert into public.authorization_audit (user_id, permission, exercise_id, operation, decision, reason, freshness, assignment_ids)
  values (auth.uid(), p_permission, p_exercise_id, p_operation, case when v_authorized then 'AUTHORIZED' else 'DENIED' end,
    case when v_authorized then null else 'PERMISSION_DENIED' end, 'VERIFIED_ONLINE', v_assignments)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_authorization_decision(text, text, text) from public;
grant execute on function public.record_authorization_decision(text, text, text) to authenticated;
