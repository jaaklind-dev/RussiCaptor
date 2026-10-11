-- WP-NEXT-02 post-deployment defense in depth: Supabase anonymous Auth users
-- carry the `authenticated` database role, so self-read policies must also
-- reject the JWT is_anonymous claim explicitly.

drop policy if exists "operator reads own profile" on public.operator_profiles;
create policy "permanent operator reads own profile" on public.operator_profiles for select to authenticated
using (
  user_id=(select auth.uid()) and status='ACTIVE'
  and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
);

drop policy if exists "users can read own authorization assignments" on public.authorization_role_assignments;
create policy "permanent users read own authorization assignments" on public.authorization_role_assignments for select to authenticated
using (
  user_id=(select auth.uid())
  and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
);

drop policy if exists "users can read own authorization audit" on public.authorization_audit;
create policy "permanent users read own authorization audit" on public.authorization_audit for select to authenticated
using (
  user_id=(select auth.uid())
  and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
);

drop policy if exists "users read own runtime recovery audit" on public.exercise_runtime_recovery_audit;
create policy "permanent users read own runtime recovery audit" on public.exercise_runtime_recovery_audit for select to authenticated
using (
  user_id=(select auth.uid())
  and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
);

drop policy if exists "users read own runtime authority audit" on public.runtime_checkpoint_authority_audit;
create policy "permanent users read own runtime authority audit" on public.runtime_checkpoint_authority_audit for select to authenticated
using (
  user_id=(select auth.uid())
  and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
);

drop policy if exists "users read own runtime writer lease" on public.runtime_writer_leases;
create policy "permanent scoped users read own runtime writer lease" on public.runtime_writer_leases for select to authenticated
using (
  writer_user_id=(select auth.uid())
  and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
  and public.has_authorization_permission('EXERCISE_JOIN',exercise_id)
);

-- Runtime payloads contain clinical exercise data and are readable only in a
-- currently authorized exercise scope. Historical policies were authenticated-only.
drop policy if exists "authenticated users read runtime checkpoints" on public.runtime_checkpoints;
create policy "scoped operators read runtime checkpoints" on public.runtime_checkpoints for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));

drop policy if exists "authenticated users read runtime checkpoint deltas" on public.runtime_checkpoint_deltas;
create policy "scoped operators read runtime checkpoint deltas" on public.runtime_checkpoint_deltas for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));

drop policy if exists "authenticated users read runtime checkpoint notifications" on public.runtime_checkpoint_notifications;
create policy "scoped operators read runtime checkpoint notifications" on public.runtime_checkpoint_notifications for select to authenticated
using (public.has_authorization_permission('EXERCISE_JOIN',exercise_id));
