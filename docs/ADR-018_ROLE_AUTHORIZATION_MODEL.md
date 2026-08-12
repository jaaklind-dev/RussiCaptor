# ADR-018 — Role & Authorization Model

**Status:** ACCEPTED — ready for WP-41A Authorization Foundation

**Proposed and reviewed:** 2026-08-12

**Decision owners:** RussiCaptor architecture maintainers

**Related decisions:** Architecture v0.7 Freeze; ADR-016; ADR-017; WP-40

## Context and problem

WP-41 stopped at its mandatory architecture gate. Supabase Auth can identify a
user, but RussiCaptor cannot currently prove that the user may perform an
ExCon-protected write. The `/excon` route is a navigation choice, not an
authorization authority. WP-41 therefore remains
`BLOCKED_BY_AUTHORIZATION_FOUNDATION` until WP-41A implements this decision.

This ADR changes no application behaviour. It defines the future trust chain:

```text
Supabase Auth identity
        ↓
server-owned role assignment
        ↓
application Principal
        ↓
permission resolution
        ↓
AuthorizationService
        ↓
protected application service
        ↓
RLS/backend enforcement
        ↓
authorization audit
```

Authentication answers **who the principal is**. Authorization answers **what
that principal may do**. UI access, route access, local state and Runtime
ownership answer neither question by themselves.

## Current architecture inventory

### Authentication and identity

- `SupabaseService` creates one persisted Supabase client session.
- `CloudSyncService.startCloudSync()` reads that session and currently falls
  back to anonymous sign-in. `supabase.auth.getUser()` supplies the stable
  backend-authenticated `user.id` used as `exercise_states.updated_by`.
- Supabase owns session persistence and refresh. Application services do not
  expose a canonical authenticated Principal, auth freshness or session-expiry
  result.
- `CurrentUserService` separately stores a demo `CaseManager` (`CM-001`, Jaak)
  and persists it locally. This is an exercise-local application identity, not
  evidence that the corresponding Supabase user has a privileged role.
- No trusted display-name/profile mapping from `auth.users.id` exists.

### EXCON semantics

EXCON is currently a route/UI workspace. Any logged-in app user can navigate
from Dashboard to `/excon`. Existing control factories use `EXCON` in command
IDs or actor labels, and several factual records use the text `EXCON`, but
there is no role assignment, permission resolver or service authorization
check behind the route. None of those strings proves authorization.

After ADR-018 these terms are distinct:

```text
ExCon workspace       = presentation/navigation mode
authorized EXCON      = Principal with authoritative role assignment
```

No existing call site may treat the first as proof of the second.

### Case Manager and Runtime ownership

Case Manager identity and patient assignment are exercise-local domain state.
`RuntimeOwnershipResolver` determines which process/module may contribute to
canonical Runtime fields. Neither is application authorization. ADR-018 does
not redefine patient ownership, CM handover, contributor ownership or Runtime
write ownership.

Future operations may require both checks independently:

```text
AuthorizationService: may this Principal request the operation?
RuntimeOwnershipResolver: may this actor/process change this Runtime entity?
```

### Persistence, synchronization and backend boundary

- `StatePersistenceService` writes one local JSON snapshot and restores it on
  restart.
- `CloudSyncService` upserts a shared `exercise_states` JSON document and uses
  a client-maintained revision. It is not a general identity/role store.
- Current `exercise_states` RLS permits authenticated reads and permits writes
  based primarily on authenticated identity/`updated_by`; it does not prove
  exercise membership or EXCON permission.
- Module-import tables already demonstrate server tables, RLS and RPC patterns,
  but they do not provide application roles.
- Clinical audit, Exercise Timeline and Debrief are not authorization audit
  stores. Authorization records must remain outside clinical Runtime Timeline.

## Threat and failure model

The design must fail closed when an ordinary authenticated user opens the
ExCon route, a client toggles local ExCon state, a role cache is missing/stale,
a session expires, an offline role was revoked, a user changes device, a client
claims an unassigned role, or a role has the wrong exercise scope. Multiple
roles and role changes during an exercise must resolve deterministically.

Unknown authorization, network failure and missing assignment never imply
authorization. A modified client must also be unable to bypass the application
check and write protected rows directly; this is the backend/RLS responsibility.

## Considered authorization authorities

| Option | Decision | Architectural consequence |
|---|---|---|
| EXCON route/UI mode | Rejected | Navigation is client-controlled and cannot establish trust. |
| AsyncStorage/local role | Rejected as authority | Useful only as a signed/bounded cache; ordinary local state can be modified and cannot provide revocation or RLS evidence. |
| Hardcoded user IDs | Rejected | Unsafe provisioning, no lifecycle, scope or auditable administration; development shortcuts can leak into production. |
| Email/domain convention | Rejected | Email is identity metadata, not a role assignment; domain rules cannot express scope or revocation safely. |
| Database-backed assignments | Accepted as authority | Supports revocation, multiple/scoped roles, RLS and auditable provisioning. |
| JWT/custom claims only | Rejected as sole authority | Claims may be stale until refresh and are awkward for exercise scope/revocation; they may be a signed cache hint only. |
| Hybrid backend authority + permission resolver | **Selected** | Stable Auth identity, authoritative assignments, app abstraction and backend enforcement with bounded offline semantics. |
| RuntimeOwnershipResolver | Rejected | It governs deterministic simulation contributors, not application principals. Coupling would change Runtime semantics. |
| All authenticated users are EXCON | Rejected | Authentication is not authorization and anonymous users would become privileged. |

## Decision

RussiCaptor will use a **hybrid authorization model**:

1. Supabase Auth is the canonical authentication authority and supplies
   `user.id`.
2. Server-owned role assignments are the canonical authorization authority.
3. An authentication adapter exposes an application Principal; domain services
   never receive the Supabase session object or inspect JWT claims directly.
4. A deterministic permission resolver maps active assignments to permissions.
5. `AuthorizationService` is the mandatory application-service boundary.
6. Protected persistent writes also require backend/RLS enforcement based on
   `auth.uid()` and authoritative assignments.
7. Authorization-sensitive decisions create a separate audit record.

The server role store is not part of shared `exercise_states`. Ordinary clients
cannot create, update or delete their own assignments. Provisioning belongs to
a trusted migration/backend/admin process; no admin UI is part of WP-41A.

## Principal contract

The application-level immutable Principal is conceptually:

```ts
type Principal = Readonly<{
  userId: string;
  authentication: "AUTHENTICATED";
  assignments: readonly RoleAssignment[];
  permissions: readonly Permission[];
  authorizationFreshness:
    | "VERIFIED_ONLINE"
    | "VERIFIED_CACHED"
    | "STALE"
    | "UNAVAILABLE";
  verifiedAt: string;
  expiresAt?: string;
}>;
```

Display metadata may be attached but is not canonical identity. Unauthenticated
and unavailable states are typed results, not Principals with fabricated IDs.
Application services depend on this contract, not the Supabase SDK.

## Role, scope and permission model

Users may have multiple role assignments. Roles are not one permanent string.
The model supports both global and exercise scope:

```text
RoleAssignment
  userId
  role                 EXCON | CASE_MANAGER | OBSERVER | ADMIN (extensible)
  scopeType            GLOBAL | EXERCISE
  scopeId              absent for GLOBAL; exerciseId for EXERCISE
  status               ACTIVE | REVOKED
  issuedAt / expiresAt
  issuedBy
```

WP-41A only needs enough role resolution to support EXCON. Listing future roles
does not grant or implement their permissions. Global EXCON applies to every
exercise; exercise-scoped EXCON applies only to its matching exercise.

Services check capabilities, not role strings. Initial WP-41 capabilities are:

```text
INSTRUCTOR_EVALUATION_READ
INSTRUCTOR_EVALUATION_WRITE
```

An active EXCON assignment grants both within its scope. Future finalization
may introduce `INSTRUCTOR_EVALUATION_FINALIZE`; it is not part of WP-41A or
WP-41. ADMIN does not implicitly exist merely because the enum can represent it.

Read policy: a Principal needs `INSTRUCTOR_EVALUATION_READ` to read instructor
comments/revision history. Existing machine-derived WP-38/39/40 read behaviour
is unchanged. Write policy: creation, judgement/comment changes and every new
revision require `INSTRUCTOR_EVALUATION_WRITE` for the exercise.

## Service authorization boundary

All protected operations follow:

```text
UI
 ↓
InstructorEvaluationService
 ↓
AuthorizationService.authorize(principal, permission, { exerciseId })
 ↓ AUTHORIZED only
repository/persistence operation
```

The typed decision is either `AUTHORIZED` with decision provenance or denied:

```text
UNAUTHENTICATED
ROLE_NOT_ASSIGNED
PERMISSION_DENIED
AUTHORIZATION_UNAVAILABLE
AUTHORIZATION_STALE
SCOPE_MISMATCH
```

Raw backend errors are mapped to typed diagnostics. UI visibility is only a
convenience; it cannot bypass the service check. WP-41 does not know role table
names, JWT shape or Supabase APIs.

## Supabase/backend trust boundary

Client-side checks improve application correctness but are not the security
boundary. Protected Instructor Evaluation rows require RLS/policy (or a trusted
RPC) that verifies:

- `auth.uid()` equals the authoring principal;
- an active authoritative assignment grants the requested permission/scope;
- revision/source integrity conditions required by the persistence contract.

Role tables deny client self-provisioning. RLS reads and writes role authority
server-side; a client-provided role, permission or display name is never
trusted. JWT claims may accelerate reads only when their issuer, expiry and
freshness satisfy the same policy; the database assignment remains canonical.

## Offline, cache and session policy

RussiCaptor must remain operational during degraded connectivity. ADR-018 is
initially applied only to newly protected Instructor Evaluation operations; it
does **not** retroactively block existing exercise lifecycle or clinical
Runtime controls. Migrating those controls requires a separate reviewed WP.

The selected v1 policy is bounded verified authorization:

- online verification produces a signed/server-verifiable authorization grant
  containing user, assignments/permissions, scope, issuer, `verifiedAt` and
  `expiresAt`;
- the grant may be persisted across restart and used as
  `VERIFIED_CACHED` only while its Supabase authentication session is still
  valid and the grant has not expired;
- WP-41A must choose and centralize a conservative duration; it may not create
  unlimited cached authorization;
- missing, expired or unverifiable grants yield `STALE`/`UNAVAILABLE` and deny
  privileged writes;
- session expiry invalidates privileged writes even if a cached grant remains;
- online revocation takes effect on the next verification/refresh. An offline
  device may retain permission only until bounded expiry—this residual window
  is an explicit accepted risk.

WP-41A may choose to require online writes initially if a securely verifiable
bounded grant and protected offline queue cannot be completed safely. That is a
valid stricter implementation. It must not simulate offline authorization with
an unsigned local role.

Offline Instructor Evaluation writes, if later supported, carry authorization
grant provenance and are revalidated at sync. Backend rejection retains a local
conflict/audit item but does not publish the write as authoritative. WP-41 does
not build collaborative editing; one current evaluation per exercise with
optimistic revisions remains the intended model.

## Revocation and role changes

Online revocation invalidates subsequent decisions and pending backend writes.
Cached permission expires at its defined boundary. Revocation never deletes
historical authored evaluation revisions or evaluator provenance. Multiple
active assignments are normalized and permission resolution is deterministic;
scope mismatch denies even if the same role exists for another exercise.

## Audit

Every authorization-sensitive write attempt records outside the clinical
Timeline:

```text
authenticated userId
effective assignment/permission and scope
authorization freshness/provenance
exerciseId
operation
timestamp
AUTHORIZED or denied reason
evaluationId/revision when available
```

Audit storage is append-only from the application perspective and protected by
backend policy. It does not enter physiological state, Debrief Timeline or
deterministic replay hashes.

## Runtime, replay and hash isolation

ADR-018 changes neither `RuntimeOwnershipResolver` nor Scenario Runtime. Roles,
permissions, JWT data and authorization timestamps are excluded from Package,
Definition, Clinical Module, Protocol, Assessment, Evaluation, Analytics and
Runtime replay hashes. WP-38/39/40 remain immutable inputs to WP-41.

## Legacy and development compatibility

Existing authenticated users without an assignment receive no privileged
authorization. They are never silently promoted to EXCON. Existing offline
exercise behaviour remains unchanged because the first protected consumer is
WP-41.

Development/test EXCON users are provisioned through explicit test fixtures or
trusted local Supabase seed/migration data. `__DEV__`, routes, email substrings,
hardcoded production IDs and local toggles cannot grant production permission.

## WP-41 integration contract

WP-41 consumes only:

```ts
AuthorizationService.authorize(
  principal,
  "INSTRUCTOR_EVALUATION_WRITE",
  { exerciseId }
): AuthorizationResult
```

and the equivalent read permission. The authorized decision supplies audit
provenance. WP-41 neither queries Supabase roles nor reads claims/UI mode.

## Migration strategy

1. Define immutable Principal, assignment, permission, freshness and typed
   authorization result contracts.
2. Add Supabase identity/role adapters and protected authoritative assignment
   storage; provide trusted test provisioning.
3. Implement deterministic permission resolution and `AuthorizationService`.
4. Add RLS/trusted RPC enforcement and authorization audit persistence.
5. Add bounded cache or explicitly online-only v1 semantics, plus expiry and
   revocation handling.
6. Resume WP-41 against the application contract.
7. Consider existing ExCon controls separately; do not bundle that migration.

## Next implementation package

**WP-41A — Authorization Foundation** implements only phases 1–5 above. It
adds no Instructor Evaluation model/UI, no Runtime changes and no retroactive
ExCon control migration.

Required tests include:

- authenticated EXCON authorized; no/wrong role and unauthenticated denied;
- ExCon route or forged local state without assignment denied;
- revoked, expired and stale roles denied according to freshness policy;
- valid bounded offline grant follows its documented policy;
- multiple roles resolve deterministically; scope mismatch denied;
- direct backend write without permission denied;
- audit attributes correct principal, permission, scope and result;
- Runtime ownership and every historical replay/hash remain unchanged.

## WP-41 release condition

WP-41 remains `BLOCKED_BY_AUTHORIZATION_FOUNDATION` until all are demonstrated:

- stable authenticated Principal;
- authoritative EXCON assignment bound to Supabase `user.id`;
- service-level read/write permission checks;
- backend/RLS enforcement for protected persistence;
- implemented offline/freshness/session policy;
- authorization audit;
- tests proving UI mode/local forgery cannot grant permission;
- WP-41 can request permissions without knowing storage implementation.

## Architecture review answers

1. **EXCON authority:** server-owned role assignments.
2. **Binding:** assignment `userId` references Supabase Auth `user.id`.
3. **Self-assignment:** forbidden by backend policy.
4. **Check location:** AuthorizationService inside protected application service.
5. **UI bypass:** impossible at service layer; backend independently enforces.
6. **Offline:** bounded verified grant or stricter online-only v1; unknown denies.
7. **Stale:** typed `AUTHORIZATION_STALE`, privileged write denied.
8. **Revoked:** online denial; cached grant expires within bounded window.
9. **Backend enforcement:** required for protected persistence.
10. **Backend role knowledge:** authoritative assignments joined to `auth.uid()` by RLS/RPC.
11. **Scope:** global and exercise-scoped model; v1 resolves both.
12. **Multiple roles:** supported and deterministically resolved.
13. **Runtime ownership:** unchanged and separate.
14. **Replay:** unchanged.
15. **Hashes:** unchanged.
16. **Existing offline exercises:** unchanged; no retroactive protection in WP-41A.
17. **Audit:** separate authorization audit with principal/decision provenance.
18. **WP-41 API:** capability-based `AuthorizationService.authorize`.
19. **Next WP:** WP-41A Authorization Foundation.
20. **Unblock evidence:** all release conditions and tests above.

No material design ambiguity remains. The architecture review therefore accepts
ADR-018 for WP-41A implementation while keeping WP-41 blocked until that
implementation is verified.

## Consequences and risks

Benefits are a real trust boundary, explainable decisions, scoped/multiple-role
extensibility, service decoupling from Supabase and safe WP-41 provenance.
Costs are backend schema/RLS work, role provisioning, offline cache complexity
and a bounded offline revocation window if cached grants are enabled. Choosing
online-only WP-41 writes removes that window but reduces degraded-network
usability. These trade-offs must be made explicit in WP-41A verification.

## Acceptance criteria

This ADR is accepted because it defines one authoritative trust chain, rejects
implicit ExCon privilege, selects an explicit offline/freshness policy, keeps
Runtime ownership and replay isolated, specifies backend enforcement and gives
WP-41 a storage-independent permission API. Acceptance authorizes WP-41A only;
it does not authorize WP-41 implementation or any existing-control migration.
