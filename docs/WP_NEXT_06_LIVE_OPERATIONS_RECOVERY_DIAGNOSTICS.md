# WP-NEXT-06 — Live Operations Recovery and Diagnostics

## Failure inventory and severity

The inventory covers process/device loss, restart/background, stale/corrupt cache, short/long network loss, Realtime/backend failure, expired/revoked/wrong-scope authorization, stale writer/lease/takeover/publication conflicts, missing/invalid/mismatched checkpoints and deltas, stale projection/workflow ownership, multiple active exercises and lifecycle/terminal mismatch.

`INFO` requires monitoring only. `DEGRADED` means backend/realtime is impaired but no new local authority is created. `ACTION_REQUIRED` requires a supported operator action before privileged work continues. `EXERCISE_BLOCKING` means integrity could be lost and the affected Runtime/lifecycle operation must stop.

| Failure family | Automatic detection | Safe recovery |
| --- | --- | --- |
| Process/restart/device loss | durable cache, session, lease and checkpoint status | restart/re-enter; authorized takeover on another device |
| Network/Realtime/backend | CloudSync and workflow connectivity | wait/switch network, then authoritative refresh/delta/full hydration |
| Auth/session/scope | operator session and permission model | reauthenticate or supported admin role assignment; fail closed |
| Runtime authority | writer state, revision, lease, conflict category | reader, takeover or remote checkpoint recovery |
| Persistence | cache/checkpoint/revision/failure state | authoritative hydration; missing active checkpoint uses audited termination only |
| Exercise identity/lifecycle | discovery conflict and lifecycle projection | supported conflict selection/reconciliation; no manual row edits |

## Diagnostic snapshot

The privacy-safe snapshot contains build provenance, public project reference, session state, role/scope summary, exercise identity/lifecycle/time, projection/workflow/checkpoint revisions, writer instance and lease expiry, Realtime/last sync, local save/cache state, pending/conflict counts, last checkpoint publication/recovery outcome and classified warnings. Its type contains no patient collections, clinical payload, user ID, token, password, key or credential.

## EXCON recovery surface and action matrix

EXCON can open **Diagnostika ja taastamine**, inspect a compact operational snapshot, refresh authoritative exercise state, perform permission-gated Runtime takeover, recover from the authoritative checkpoint and share a safe JSON snapshot. Missing-checkpoint termination remains on the existing Runtime recovery card and calls the authenticated, audited backend RPC.

| Action | Prerequisite | Authority/audit |
| --- | --- | --- |
| Refresh authoritative state | authenticated backend connection | read-only; no authority change |
| Takeover Runtime | active exercise, valid checkpoint, eligible lease, EXCON recovery permission | writer CAS/lease and authenticated actor |
| Recover remote checkpoint | valid authoritative checkpoint and revision, EXCON permission | idempotent recovery intent and lease CAS |
| Terminate missing Runtime | RUNNING/PAUSED, no checkpoint, failure marker, EXCON recovery permission | `exercise_runtime_recovery_audit` records actor/prior state/result |
| Reauthenticate | expired/revoked session | privileged UI and RPCs remain denied until verified |

Invalid/missing checkpoints never create fabricated Runtime. A stale projection with valid checkpoint hydrates authoritative state; stale lease/no writer uses normal expiry/acquisition rules. A device or network loss never promotes local state into authority.

## Audit, operational dependency and rehearsal

Privileged recovery uses existing server-side actor attribution, authorization, lease/checkpoint CAS and recovery audit. Attempts denied before permission do not mutate clinical state; successful missing-Runtime termination records prior lifecycle, checkpoint/lease state and result. Routine recovery has no SQL-console, row-deletion, service-role or developer-laptop dependency. Administrative account/scope provisioning before the event remains trusted preparation.

The field runbook is `RUSSICAPTOR_LIVE_OPERATIONS_RECOVERY_RUNBOOK.md`; the later 2-CM/1-EXCON production-like rehearsal is specified in `RUSSICAPTOR_FULL_DRESS_REHEARSAL_CHECKLIST.md`. Physical smoke should verify rendering, safe-area, restart/background and safely controllable network loss. Authenticated multi-device recovery remains the later dress-rehearsal gate.

No database migration is required: this WP composes existing protected status and recovery APIs without changing schema, authority or clinical semantics.

## Physical smoke status

The WP-NEXT-06 validation build installed and cold-started successfully on Samsung SM-X306B (`R5GL236L6ZJ`), Android 16. Release identity rendered as 1.0.0 (versionCode 1), and a force-stop/relaunch produced no fatal Android or React Native error. Authenticated diagnostics rendering, privacy-safe export, disconnect/reconnect recovery, scoped recovery permission, and actor-attributed audit behavior passed in the combined one-device acceptance. No fatal Android or React Native errors were observed. The later two-CM/one-EXCON recovery sequence remains the deferred full dress-rehearsal gate.
