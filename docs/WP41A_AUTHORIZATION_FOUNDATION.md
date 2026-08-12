# WP-41A — Authorization Foundation

## Architecture Gate

```text
Authentication adapter: EXTENSION_REQUIRED → IMPLEMENTED
Supabase user identity: SUFFICIENT
Application identity boundary: EXTENSION_REQUIRED → IMPLEMENTED
Persistence abstraction: EXTENSION_REQUIRED → IMPLEMENTED
Supabase migration path: SUFFICIENT
RLS/policy infrastructure: EXTENSION_REQUIRED → IMPLEMENTED
Audit infrastructure: EXTENSION_REQUIRED → IMPLEMENTED
Offline persistence: EXTENSION_REQUIRED → IMPLEMENTED

Canonical Runtime contract change required: NO
Replay contract change required: NO
RuntimeOwnershipResolver change required: NO
Dependency-direction change required: NO
New ADR required: NO
```

## ADR-018 mapping

WP-41A implements an infrastructure-only chain:

```text
Supabase Auth
→ SupabaseAuthenticationAdapter
→ SupabaseRoleAuthority
→ immutable Principal
→ PermissionResolver
→ AuthorizationService
→ backend has_authorization_permission()
→ authorization audit
```

It adds no Instructor Evaluation model, table or UI. Existing ExCon routes and
exercise controls are deliberately unchanged and are not authorization evidence.

## Principal, roles and permissions

`Principal` is recursively immutable, keyed only by the stable Supabase user ID
and contains canonical assignments, permissions, freshness and provenance. Raw
Supabase sessions do not cross the authentication adapter.

The v1 role authority supports `EXCON`, with global or exercise scope. The model
supports multiple assignments without a single `user.role` field. The only v1
permissions are independent:

- `INSTRUCTOR_EVALUATION_READ`
- `INSTRUCTOR_EVALUATION_WRITE`

`PermissionResolver` sorts assignments and deduplicates/sorts permissions, so
database row order cannot change a decision.

## Authoritative role source and schema

Migration `202608120001_authorization_foundation.sql` adds:

- `authorization_role_assignments`, bound to `auth.users.id`;
- strict role/status/scope/revocation invariants and duplicate prevention;
- SELECT-only self visibility; no client assignment mutation policy;
- `has_authorization_permission(permission, exerciseId)`, which derives access
  from `auth.uid()` and active server assignments;
- append-only `authorization_audit` and a trusted audit RPC whose decision is
  calculated by the backend, not accepted from the client.

Ordinary clients cannot self-promote. Production provisioning requires trusted
SQL/service-role administration. For development, create a dedicated Supabase
test user normally, then insert its UUID through SQL Editor as a trusted admin:

```sql
insert into public.authorization_role_assignments
  (user_id, role, scope_type, scope_id, issued_by)
values
  ('<TEST_USER_UUID>', 'EXCON', 'GLOBAL', null, '<ADMIN_UUID>');
```

No credentials, user UUIDs or hardcoded development identity are committed.

## AuthorizationService and decisions

Future WP-41 calls only:

```ts
authorizationService.authorize(
  principalState,
  "INSTRUCTOR_EVALUATION_WRITE",
  { exerciseId }
)
```

Typed denial reasons cover unauthenticated, no role, permission denial,
unavailable/stale authority and scope mismatch. Unknown, route state, forged
local labels, revoked/expired assignments and missing backend authority all fail
closed. Authorization audit is mandatory: audit persistence failure changes an
otherwise authorized client decision to `AUTHORIZATION_UNAVAILABLE`.

## Offline, cache and session policy

WP-41A uses the stricter ADR-018-permitted v1 policy:

- authoritative online resolution is `VERIFIED_ONLINE`;
- a principal-bound bounded cache may restore metadata after restart as
  `VERIFIED_CACHED` or `STALE`;
- `VERIFIED_CACHED`, `STALE` and `UNAVAILABLE` are denied for privileged writes;
- loss of authentication clears the cache;
- a different authenticated user cannot load the previous user's cache.

Thus WP-41 writes are online-only in v1. No locally self-signed proof exists and
offline privilege cannot be manufactured. Existing offline simulation remains
unchanged because current controls do not consume AuthorizationService.

## Revocation, scope and user switching

Online refresh observes revocation immediately. Offline cached metadata never
authorizes a write. Global assignments match every exercise; exercise scope must
match the requested exercise ID exactly. Assignment and permission order is
canonical. Cache lookup is bound to the authenticated `userId` and is cleared on
logout/session loss.

## Backend enforcement and audit

Client checks are not represented as the security boundary. Future protected
tables/RPCs must call `has_authorization_permission()` in RLS or trusted RPCs.
The live project migration and transactional backend smoke test were executed
successfully; the smoke transaction verifies assigned read/write, no-role,
scope mismatch, revocation, unknown permission, unauthenticated denial and
server-derived audit, then rolls back.

Authorization audit is separate from clinical Timeline and contains no JWT,
access token or refresh token. For future protected writes, authorization,
mutation and audit should be coupled in one trusted transaction/RPC. Audit
failure blocks the privileged client decision in the application service.

## Runtime ownership, replay and hash isolation

ScenarioEngine, clinical Runtime, WP-38, WP-39, WP-40 and
`RuntimeOwnershipResolver` import no authorization foundation. No per-tick
fetch, polling or Runtime dependency was added. Existing Package, Definition,
Clinical Module, Protocol, Assessment, Analytics, Evaluation and replay hashes
are unchanged.

## Test strategy and results

Dedicated tests cover immutable/canonical permissions, EXCON read/write,
unauthenticated/no-role/stale/cached/unavailable denial, scope mismatch,
revoked/expired assignments, forged UI labels, audit attribution and failure,
Supabase adapter user binding, unavailable/mismatched role sources, user-bound
cache restore, logout clearing, migration/RLS invariants and architecture guards.

Backend verification distinguishes real enforcement from mocks: the migration
and `authorization_foundation_test.sql` were both executed against the configured
Supabase project. No Runtime or exercise row was altered; smoke data rolled back.

## Manual verification and known limitations

WP-41A intentionally has no production role-management or diagnostics UI.
Emulator and physical Huawei verification confirmed that the fresh development
build launches normally with no new React Native or Scenario Runtime errors.
Existing control semantics are protected by the complete unchanged regression
suite. Authoritative permission behaviour was additionally exercised against
the live backend with two isolated temporary principals: assigned EXCON was
allowed, the ordinary user was denied, and self-promotion was rejected by RLS.
Both temporary users and their cascading assignment were removed afterwards.

Known v1 limitations:

- privileged WP-41 writes require online verification;
- role provisioning is trusted-admin SQL/backend only;
- existing ExCon controls are not yet protected;
- Instructor Evaluation storage/RLS is deferred to WP-41 and must use the
  reusable backend permission primitive.

## WP-41 release condition

```text
Stable Principal available: YES
Authoritative EXCON assignment available: YES
Permission resolver available: YES
Service-level AuthorizationService available: YES
INSTRUCTOR_EVALUATION_READ enforceable: YES
INSTRUCTOR_EVALUATION_WRITE enforceable: YES
Offline/freshness policy implemented: YES (online-only privileged writes)
Authorization audit available: YES
Backend/RLS enforcement available: YES (reusable primitive; WP-41 policy pending its table)
UI mode cannot grant permission: VERIFIED
```

Subject to full regression and device smoke verification, **WP-41: UNBLOCKED / READY**.
