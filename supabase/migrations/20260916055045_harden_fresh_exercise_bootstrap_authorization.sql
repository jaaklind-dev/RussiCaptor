-- The bootstrap predicate is read-only and its caller already has a narrowly
-- scoped SELECT policy.  Keep it SECURITY INVOKER and make the permanent-user
-- requirement explicit in that policy as defense in depth.

drop policy if exists "operator reads own exercise bootstrap authorization"
  on public.exercise_bootstrap_authorizations;
create policy "operator reads own exercise bootstrap authorization"
  on public.exercise_bootstrap_authorizations
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
    and user_id = (select auth.uid())
  );

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
          or bootstrap.consumed_exercise_id = p_exercise_id
        )
    );
$$;

revoke all on function public.has_exercise_bootstrap_authorization(text) from public, anon;
grant execute on function public.has_exercise_bootstrap_authorization(text) to authenticated;
