-- An unconsumed bootstrap authorizes one initial INSERT, but must not make any
-- pre-existing exercise row readable.  Keep creation and bound-row read
-- predicates separate so SELECT remains least-privilege.

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

create or replace function public.has_unconsumed_exercise_bootstrap_authorization()
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
        and bootstrap.consumed_exercise_id is null
    );
$$;

drop policy if exists "excon creates exercise state" on public.exercise_states;
create policy "excon creates exercise state" on public.exercise_states
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and (
    public.has_authorization_permission('EXCON_EXERCISE_CONTROL', exercise_id)
    or public.has_unconsumed_exercise_bootstrap_authorization()
  )
);

revoke all on function public.has_exercise_bootstrap_authorization(text) from public, anon;
grant execute on function public.has_exercise_bootstrap_authorization(text) to authenticated;
revoke all on function public.has_unconsumed_exercise_bootstrap_authorization() from public, anon;
grant execute on function public.has_unconsumed_exercise_bootstrap_authorization() to authenticated;

comment on function public.has_exercise_bootstrap_authorization(text)
  is 'Invoker-scoped read predicate: an exercise is visible only after the bootstrap is bound to that exact identity.';
comment on function public.has_unconsumed_exercise_bootstrap_authorization()
  is 'Invoker-scoped creation predicate for one unconsumed, active, short-lived bootstrap.';
