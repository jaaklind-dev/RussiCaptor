-- RLS WITH CHECK observes the row after BEFORE INSERT triggers have run.  The
-- bootstrap trigger atomically binds the grant to NEW.exercise_id, so the
-- insert predicate must accept either the unconsumed pre-trigger state or the
-- exact post-trigger binding.  This SECURITY DEFINER helper is a boolean-only
-- authority boundary; callers never receive or mutate authorization rows.

create or replace function public.has_exercise_bootstrap_insert_authorization(
  p_exercise_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
    and p_exercise_id is not null
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
          bootstrap.consumed_exercise_id is null
          or bootstrap.consumed_exercise_id = p_exercise_id
        )
    );
$$;

drop policy if exists "excon creates exercise state" on public.exercise_states;
create policy "excon creates exercise state" on public.exercise_states
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and (
    public.has_authorization_permission('EXCON_EXERCISE_CONTROL', exercise_id)
    or public.has_exercise_bootstrap_insert_authorization(exercise_id)
  )
);

revoke all on function public.has_exercise_bootstrap_insert_authorization(text)
  from public, anon;
grant execute on function public.has_exercise_bootstrap_insert_authorization(text)
  to authenticated;

drop function if exists public.has_unconsumed_exercise_bootstrap_authorization();

comment on function public.has_exercise_bootstrap_insert_authorization(text)
  is 'Boolean-only SECURITY DEFINER insert predicate accepting one active unconsumed grant or its exact trigger-bound exercise identity.';
