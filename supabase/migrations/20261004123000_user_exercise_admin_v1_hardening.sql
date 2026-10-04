-- Follow-up hardening for USER-EXERCISE-ADMIN-V1. Explicit deny policies make
-- the client boundary machine-auditable even though table privileges are also
-- revoked. Covering indexes support administrative audit/authority relations.

create policy "client cannot read or mutate platform administrators"
  on public.platform_admins for all to authenticated
  using (false) with check (false);

create policy "client cannot read or mutate administrative audit"
  on public.administrative_action_audit for all to authenticated
  using (false) with check (false);

create index platform_admins_granted_by_idx on public.platform_admins (granted_by);
create index platform_admins_revoked_by_idx on public.platform_admins (revoked_by)
  where revoked_by is not null;
create index administrative_action_audit_target_time_idx
  on public.administrative_action_audit (target_user_id, occurred_at desc)
  where target_user_id is not null;
