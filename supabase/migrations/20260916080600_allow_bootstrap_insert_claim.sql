-- Permit the initial INSERT policy check to observe an unconsumed bootstrap.
-- The BEFORE INSERT trigger then validates the exact READY projection and
-- atomically binds that one-shot authorization to the new exercise.  A
-- concurrent or replayed insert fails closed after the advisory lock.

create or replace function public.has_exercise_bootstrap_authorization(
  p_exercise_id text default null
)
returns boolean
language sql
stable
security invoker
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
          or bootstrap.consumed_exercise_id is null
          or bootstrap.consumed_exercise_id = p_exercise_id
        )
    );
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
    raise exception 'BOOTSTRAP_AUTHORIZATION_REQUIRED' using errcode = '42501';
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
    raise exception 'BOOTSTRAP_AUTHORIZATION_REQUIRED' using errcode = '42501';
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

revoke all on function public.has_exercise_bootstrap_authorization(text) from public, anon;
grant execute on function public.has_exercise_bootstrap_authorization(text) to authenticated;
revoke all on function public.claim_exercise_bootstrap_authorization() from public, anon, authenticated;

comment on function public.has_exercise_bootstrap_authorization(text)
  is 'Invoker-scoped bootstrap predicate allowing the one initial policy check before atomic trigger binding.';
comment on function public.claim_exercise_bootstrap_authorization()
  is 'Validates and atomically consumes one bootstrap; concurrent or replayed inserts fail closed.';
