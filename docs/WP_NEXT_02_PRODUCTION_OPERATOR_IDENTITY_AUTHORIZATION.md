# WP-NEXT-02 — Production Operator Identity and Authorization

Date: 2026-08-29

## Purpose

WP-NEXT-02 replaces navigation-only login, anonymous Supabase sessions and device-local demo CM authority with an authenticated, server-assigned operator principal. It does not change clinical Runtime, checkpoint payloads, lease/CAS rules, exercise packages or historical records.

The backend deployment consists of the reviewed foundation migration
`20260829111354_production_operator_identity_authorization.sql` and the follow-up
`20260829124726_production_operator_identity_authorization_hardening.sql`. The
follow-up explicitly rejects Supabase anonymous Auth users from protected reads,
scopes checkpoint reads through `EXERCISE_JOIN`, removes anonymous/PUBLIC RPC
execution, and pins privileged function resolution to an empty `search_path`.

## Previous architecture

- The login button navigated directly to `/dashboard`.
- `CloudSyncService` and module import created anonymous Supabase users when no session existed.
- `CurrentUserService` selected hard-coded `CM-001 / Jaak` or `CM-002 / Mari`; the dashboard allowed switching between them.
- The existing role table supported only EXCON and only evaluation/recovery permissions.
- EXCON routes were not centrally guarded.
- `exercise_states` allowed any `authenticated` Postgres role to read/write; Supabase anonymous Auth users also receive that role.
- Runtime writer RPCs validated `auth.uid()` and lease ownership, but did not require an application role.
- Clinical display names were often the only actor field in local evidence.

## Production identity model

The immutable authority key is Supabase Auth `auth.uid()`. Password login uses `signInWithPassword`; persisted Supabase sessions are restored by the existing client storage and verified with `getUser`. Anonymous users are explicitly rejected even though Supabase exposes them through the Postgres `authenticated` role.

`operator_profiles` stores a trusted human-readable `display_name` keyed by `user_id`. The name is presentation only. Neither `user_metadata`, `raw_user_meta_data`, route state nor a free-text name grants permission.

The application session state is one of:

- `LOADING`
- `UNAUTHENTICATED`
- `UNAUTHORIZED`
- `UNAVAILABLE`
- `AUTHENTICATED`

Cloud discovery and Runtime writer acquisition begin only after the state is `AUTHENTICATED`. Logout stops CloudSync and Runtime checkpoint sync, removes the local Auth session and returns to login.

## Roles and scope

### CM

CM is exercise-scoped only.

Allowed permissions:

- `EXERCISE_JOIN`
- `CM_WORKFLOW_WRITE`

CM may open the assigned exercise, acquire/manage patients and record intended CM workflow/clinical actions. CM may not open EXCON routes, manage exercise lifecycle, import packages, recover Runtime or read/write instructor evaluation through privileged operations.

### EXCON

EXCON may be exercise-scoped or, only where operationally justified, GLOBAL.

Allowed permissions:

- `EXERCISE_JOIN`
- `EXCON_EXERCISE_CONTROL`
- `EXERCISE_RUNTIME_RECOVERY`
- `INSTRUCTOR_EVALUATION_READ`
- `INSTRUCTOR_EVALUATION_WRITE`
- `EXERCISE_PACKAGE_IMPORT` (GLOBAL only)

Exercise-scoped EXCON permission applies only when `scope_id` equals the target exercise. GLOBAL EXCON is intentionally broader and must be rare.

Assignments are effective only while `status = ACTIVE` and before `expires_at`. Revoked or expired assignments fail closed.

## Central authorization architecture

- `SupabaseAuthenticationAdapter` verifies a permanent Supabase user.
- `SupabaseRoleAuthority` reads only the caller’s authoritative assignments.
- `PrincipalService` combines identity and assignments.
- `PermissionResolver` owns the canonical role-to-permission mapping.
- `AuthorizationService` applies freshness, status, expiry, permission and exercise scope.
- `OperatorSessionService` resolves the trusted operator profile and publishes one application session state.
- `ProductionRouteGate` provides route UX. It is not the security boundary.
- `public.has_authorization_permission` is the backend decision boundary for RLS and privileged writes.

All decisions deny when identity, profile, role data or fresh authorization cannot be verified.

## Server enforcement

The deployed migrations:

1. adds trusted `operator_profiles` with self-read-only RLS;
2. extends role assignments to CM and EXCON and constrains CM to EXERCISE scope;
3. replaces `has_authorization_permission` with a permanent-user, active-profile, active-assignment and exercise-scope check;
4. hardens authorization audit helpers with `search_path = ''` and explicit grants;
5. replaces broad `exercise_states` policies with scoped operator policies;
6. adds Runtime lease/checkpoint triggers so SECURITY DEFINER writer RPCs cannot be used by a merely authenticated caller;
7. restricts package-import mutations to GLOBAL EXCON, including SECURITY DEFINER import paths;
8. leaves recovery and instructor evaluation checks using their existing explicit permissions.
9. revoke anonymous/PUBLIC execution from authenticated operator RPCs and explicitly
   deny anonymous Auth identities in protected read policies;
10. scope checkpoint, delta and checkpoint-notification reads to an authorized exercise.

The migration uses only the publishable client role. It exposes no service-role key.

## SECURITY DEFINER audit

The repository contains 26 SECURITY DEFINER declarations across 13 migration files. They fall into these groups:

- authorization decision/audit;
- module import and rollback;
- instructor evaluation revision;
- Runtime lease/checkpoint publication;
- missing-Runtime recovery;
- service-role-only recovery fixture.

Existing functions already check `auth.uid()` and generally revoke PUBLIC execution, but historical definitions use `search_path = public, pg_temp`. WP-NEXT-02 replaces the relevant authenticated operator RPCs with `search_path = ''` and explicit authenticated-only grants. Runtime table triggers enforce CM/EXCON scope even when invoked from definer RPCs. Import table triggers enforce GLOBAL EXCON. The acceptance-fixture RPC remains service-role-only. Recovery and evaluation retain explicit permission checks.

Remote validation must verify function grants from the deployed catalog and run Supabase security advisors. Historical migrations are not rewritten.

## Login, restore, expiry and logout

- Method: email/password through Supabase Auth.
- Clean launch: shows email/password login.
- Restore: the persisted session is verified against Supabase, then role assignments and profile are resolved.
- Expired/invalid session: operator becomes unauthenticated/unavailable and live routes fail closed.
- Logout: local session is removed, sync loops stop and login is shown.
- The current operator display name is visible on CM/EXCON screens.
- No self-sign-up or client role editor is provided.

## Provisioning and revocation

Provisioning remains a trusted administrative task using an approved Supabase administrative environment or future secure admin backend. It must not be run from the mobile client.

Provisioning order:

1. create/invite and verify the Supabase Auth user;
2. insert/update `operator_profiles` using the Auth UUID;
3. issue the minimum `authorization_role_assignments` row with issuer, scope and optional expiry;
4. record/retain administrative evidence according to the exercise runbook;
5. revoke by setting `status`, `revoked_at` and `revoked_by` consistently.

The existing table constraints enforce coherent revocation. No INSERT/UPDATE/DELETE client policy is added for profiles or assignments.

Temporary physical-test roles must be exercise-scoped, time-bounded where practical and revoked after acceptance. A GLOBAL EXCON role is appropriate only for trusted package-import administration.

## Ownership and attribution

After authorization resolves, the CM authority ID becomes the authenticated user UUID. Patient assignments and transfers therefore use a stable user ID rather than `CM-001`/`CM-002`.

New intervention, medication, note, vital-sign and Timeline rows store an optional immutable actor UUID alongside the display name. The optional shape preserves backward compatibility: legacy rows containing only a free-text actor remain readable and are not rewritten. Cloud projection `updated_by`, checkpoint `writer_user_id`, recovery audit and instructor evaluation already use `auth.uid()`.

Operator identity and device writer identity remain separate:

- operator = authenticated person (`auth.uid()`);
- writer = Runtime writer instance/device identity plus authenticated user.

The same account may have sessions on multiple devices; Runtime lease semantics still determine the single canonical writer.

## Authorization failure UX

- Bad credentials: generic login failure without user enumeration detail.
- Missing/expired/revoked role: authenticated but unauthorized message; no demo fallback.
- Missing profile: unauthorized, with no free-text identity synthesis.
- Role service/network unavailable: distinct authorization-unavailable state.
- CM attempting EXCON route: redirected to the permitted entry path.
- Recovery and evaluation continue to surface their typed permission-denied results.

## Production release invariant

A production build must not start remote discovery, CloudSync or Runtime authority acquisition, or allow entry to CM/EXCON workflows, unless all are true:

1. a valid non-anonymous Supabase session exists;
2. an active trusted operator profile exists;
3. at least one fresh active server-side role assignment exists;
4. the target route/action matches role and exercise scope.

Demo identity selection has been removed from the dashboard. `setCurrentCaseManager` is development-only and cannot replace an already bound authenticated identity. Anonymous fallback has been removed from CloudSync and package import.

## Backward compatibility

- Existing exercise packages, projections, checkpoints, Runtime clocks, clinical semantics, lease/CAS and WP-EGRESS behavior are unchanged.
- No historical actor field is rewritten.
- New actor UUID fields are optional for legacy projection decoding.
- Existing EXCON evaluation and recovery permissions remain.
- Deployment must provision profiles/roles before operators use the new release; otherwise the correct result is fail-closed unauthorized access.

## Deployment and validation plan

1. Deploy both tracked WP-NEXT-02 migrations in order.
2. Run migration list/schema checks and Supabase security advisors.
3. Provision temporary backend-only test profiles and minimum scoped assignments through a trusted administrative session.
4. Validate unauthenticated, anonymous, no-role, CM, correct-scope EXCON, wrong-scope EXCON, expired and revoked cases against the real backend.
5. Validate Runtime acquisition denial/allow paths, RLS scope and immutable actor attribution.
6. Remove all temporary test profiles, assignments and synthetic exercise rows.
7. Defer physical Android login, restart/session restore, CM/EXCON denial/allow, logout and visible attribution checks to final physical acceptance.
