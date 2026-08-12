# ADR-018 Architecture Review

**Date:** 2026-08-12

**Outcome:** **ACCEPTED — ready for WP-41A Authorization Foundation**

## Evidence reviewed

- `SupabaseService` session persistence and client boundary;
- `CloudSyncService` anonymous-session fallback, `getUser()`, shared-state
  revision and `exercise_states` synchronization;
- `supabase/schema.sql` and module-import RLS/RPC patterns;
- `CurrentUserService`, Case Manager assignment and persistence;
- `/dashboard` → `/excon` navigation and existing ExCon command call sites;
- `StatePersistenceService`, completed archives and Debrief/WP-40 extensions;
- `RuntimeOwnershipResolver`, exercise control and instructor command audit.

## Gate finding

```text
Authenticated identity:          PARTIAL — stable Supabase user.id exists
Authorized EXCON principal:      MISSING
UI-independent permission check: MISSING
Backend protected-write policy:  MISSING for Instructor Evaluation
Offline authorization policy:    MISSING before ADR-018
Runtime/replay change needed:     NO
```

The current ExCon workspace cannot safely unblock WP-41 because navigation and
local CM identity are not authorization. Existing RLS also cannot prove EXCON
permission. The gap is architectural but can be filled above Runtime without
changing clinical behaviour.

## Decision review

The selected hybrid model is internally consistent with Architecture v0.7:

```text
Infrastructure (Supabase Auth + role/RLS)
  → application Principal/AuthorizationService
    → protected WP-41 service
```

Dependencies remain downward. WP-41 is insulated from Supabase storage, Runtime
does not import authorization, and `RuntimeOwnershipResolver` stays independent.
Database-backed assignments solve revocation, audit and future scope; capability
checks avoid scattering role strings through services. Backend enforcement
closes the modified-client bypass that client-only authorization would leave.

The offline decision is safe and operationally explicit: existing Runtime
continues unchanged; newly protected writes require current online authority or
a bounded server-verifiable grant tied to a valid session. Missing/stale state
denies. Unlimited local roles are rejected.

## Review of required questions

All twenty questions in the ADR prompt have concrete answers in ADR-018. In
particular, role authority, Supabase identity binding, provisioning, service and
backend checks, offline expiry, revocation, scope, multiple roles, audit and the
exact WP-41 API are unambiguous. WP-41 release evidence is explicit and testable.

## Freeze impact

ADR-018 is a permitted post-freeze decision. It adds a security/application
boundary above deterministic evaluation; it does not add a Runtime layer or
alter Package, Definition, Protocol, Assessment, Analytics, Evaluation or replay
hash semantics. Existing ExCon controls are deliberately not migrated in
WP-41A, avoiding an unreviewed offline/runtime behaviour change.

## Recommendation

Accept ADR-018 and implement **WP-41A — Authorization Foundation** as a separate
package. Keep **WP-41 = BLOCKED_BY_AUTHORIZATION_FOUNDATION** until WP-41A has
green application and backend authorization tests, offline/freshness tests,
audit evidence and unchanged replay/hash baselines.
