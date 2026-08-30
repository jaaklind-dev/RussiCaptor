# WP-NEXT-08 — Multi-device dress rehearsal preparation

## Gate inventory and topology

Automated already: backend simultaneous claim, ownership/revision CAS, append idempotency, different-patient isolation, Realtime notification, reconnect hydration, authorization, checkpoint/lease and terminal persistence tests. Physical gates remain: simultaneous claim, transfer/stale owner, concurrent append, mutable conflict, different-patient concurrency, reconnect, writer/CM loss, supported takeover, former-writer rejection, completion/archive/audit (`REQUIRES_2_DEVICES`); independent EXCON-loss continuity (`REQUIRES_3_DEVICES`). One device can verify release provenance, login, fixture visibility and diagnostics but closes none of those concurrency gates.

Minimum useful topology is CM-A + CM-B, with controlled EXCON role switching only between test blocks. Three devices are preferred so EXCON remains independently observable and its loss can be tested without weakening the scenario.

## Identity, roles and fixture

Reusable non-personal CM-A, CM-B and EXCON identities must be created/reused only through trusted Supabase administration. Credentials stay in the approved secret store, never Git/docs/logs. Default assignments are none. Before a window, issue ACTIVE exercise-scoped CM/CM/EXCON assignments with issuer and expiry evidence; afterward revoke them. GLOBAL EXCON is prohibited for this rehearsal.

The fixture is `russicaptor.runtime-continuity-reference@1.0.0` with `PT-PELVIC-001` (ownership/conflict) and `PT-PLEURAL-001` (independent concurrency). Prepare it through normal UI, then verify READY→RUNNING, durable checkpoint and unowned patient heads. Complete it through normal lifecycle; never edit operational rows directly.

## Evidence and security

Record device serial/model, versionCode/SHA, role/scope, exercise/patient IDs, starting/final patient revision and owner, command/conflict result, convergence, checkpoint revision, lease writer/expiry, audit actor and cleanup. Screenshots are optional; privacy-safe diagnostics and structured worksheet entries are authoritative evidence.

Security preflight: anon denial, role-table self-mutation protection, authenticated scoped RPC grants, `auth.uid()` actor attribution and recovery authorization are automated/backend-accepted. Realtime-schema lockdown and Node 20 deprecation from the current Supabase changelog do not alter this browser/Node 24 release. Existing advisor warnings are acceptable only when they do not expose protected tables/RPCs; any anon grant, self-escalation path or unscoped test privilege is a BLOCKER.

## Readiness

The read-only script reports each gate as READY/WARN/BLOCKED and deliberately requires external PASS evidence for migrations, reusable accounts, clean roles, fixture, checkpoint, lease and patient state. Device count is a visible non-blocking warning during remote preparation. Cleanup mode requires revoked roles, terminal exercise, terminal checkpoint/archive, inactive lease and clear ownership. This avoids embedding admin credentials or bypassing RLS. Physical gates remain deferred until two devices are present.

## WP-NEXT-08B remote evidence (2026-08-30)

- Canonical release: `RussiCaptor-1.0.0-2.apk`, source `60ab748d9386759a6682434108ae1544443a3f2c`, package `com.jaaklind.RussiCaptor`, versionCode 2, distributable release checksum verified.
- Reusable Auth principals: CM-A, CM-B and EXCON exist, are confirmed and enabled. Credentials are stored outside the repository; no credential or principal UUID is recorded here.
- Scoped authorization: CM-A and CM-B have only CM assignments for `EX-1788095971438-1`; EXCON has only an EXCON assignment for that exercise. The temporary GLOBAL EXCON bootstrap assignment was revoked. Target permissions pass and unrelated-exercise permissions fail.
- Migration ledger: checkpoint egress/Realtime/delta/byte-budget, production operator authorization/hardening and conflict-safe multi-CM workflow migrations are deployed. The already-present legacy `202608190001` checkpoint-egress schema had no history row; trusted administration repaired only that ledger entry without re-running its superseded SQL or changing operational/schema state.
- Fixture: `EX-1788095971438-1`, `russicaptor.runtime-continuity-reference@1.0.0`, lifecycle RUNNING, patients `PT-PELVIC-001` and `PT-PLEURAL-001`.
- Durable Runtime: checkpoint revision 18, payload/provenance/byte metadata aligned with the notification row, inactive lease after supported writer shutdown, and no patient owner established.
- Physical two-device concurrency and independent EXCON-loss gates remain explicitly unrun.
