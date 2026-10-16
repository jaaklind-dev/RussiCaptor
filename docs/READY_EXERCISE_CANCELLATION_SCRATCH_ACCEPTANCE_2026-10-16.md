# READY exercise cancellation: scratch acceptance (2026-10-16)

Historical evidence for the original cancellation implementation at `37f11a66`. The undeployed migration was subsequently amended with a default-OFF activation gate and fully rebuilt/retested. Current migration identity, OFF behavior, activation authority, deployment order, and acceptance results are recorded in [READY_CANCELLATION_ACTIVATION_GATE_2026-10-16.md](READY_CANCELLATION_ACTIVATION_GATE_2026-10-16.md). Its staged deployment/activation procedure supersedes the ungated deployment guidance below; the original observations remain preserved.

## Boundary and provenance

- Source baseline: `origin/main` at `aeaef720429a81133ef6f0477e39a2f237a89733`.
- Work branch: `feature/ready-exercise-cancellation`; no production deployment, push, APK build, or physical test was performed in this work package.
- Scratch-only target: `thixnregyriwevgptclw` (`russicaptor-migration-scratch-20261011`, `eu-west-1`, host `db.thixnregyriwevgptclw.supabase.co`). Production `fimcsrivizpliiuoqopv` was not mutated.
- Forward-only migration: `20261016065854_ready_exercise_cancellation.sql`. The preceding 52 migration files were not edited.
- Production migration history was read-only checked: 52 entries, highest `20261012102900`; the new migration is not present there.

## Contract

`trusted_admin_cancel_ready_exercise(exercise_id, expected_revision, operation_id, reason, actor_user_id)` is executable by `service_role` only. The Admin Edge operation authenticates the actual caller with `requirePlatformAdmin`; the SQL function independently requires an active PLATFORM_ADMIN, active operator profile, and non-anonymous, non-banned Auth identity. Allowed reasons are `UNUSED_READY`, `FAILED_START`, and `TEST_CLEANUP`.

It acquires the same per-exercise advisory lock and lease/checkpoint/state lock order as initial writer acquisition. It requires the exact READY revision, no active lease, checkpoint, completion request, patient head/ownership, patient command, workflow command, or workflow notification. Successful cancellation atomically advances the canonical revision once, changes the lifecycle to terminal `CANCELLED`, retains the canonical row/package history, writes one durable operation receipt, and writes one successful administrative audit record. The same actor/operation/request retry returns the original result; changed content under the same operation ID conflicts. Failed Admin Edge requests receive a bounded error and a separate failure audit where an authenticated Admin context exists.

The same migration closes post-cancellation lease creation/renewal, patient-head mutation, and new CM/EXCON grants at the server boundary. Existing role revocation remains a separate audited operation. Normal canonical publication and completed-archive RPCs retain their active/completed-only preconditions. The client excludes CANCELLED from current/scoped Runtime selection and terminalizes its controls, cloud publication, patient/scan actions, and recovery interpretation while retaining Admin historical visibility.

## Fresh reconstruction

The repository uses a two-stage fresh-database baseline: exact `supabase/schema.sql` bytes (SHA-256 `faa7c909033cd32a57c1ec6344baeb22c14aa8b19a0fe59eb58b5e81cf958694`) first, then the canonical migrations. A bare CLI reset without that baseline stopped at an early historical migration because `exercise_states` had not yet been created; no migration SQL was patched. For the clean reconstruction, a temporary local baseline migration containing byte-identical `schema.sql` was placed before the canonical files. The supported scratch reset applied that baseline and all 53 canonical migration files in order, ending at `20261016065854`. The temporary baseline file was removed locally and its scratch history marker reverted using the supported, history-only `migration repair --status reverted` operation. The resulting scratch ledger contains only the 53 canonical versions. This two-stage procedure was repeated after the integration fixtures to discard all disposable scratch data.

Final scratch readback: 53 local migration versions and 53 scratch ledger versions matched in exact order, with no duplicate or temporary baseline version. Application exercise states, writer leases, scoped assignments, platform admins, bootstrap authorizations, Auth users, publication receipts, and administrative audit rows were all zero after the final reset. The `authenticated` role still had no cancellation RPC EXECUTE; `service_role` did.

## Real PostgreSQL acceptance

Four disposable scratch exercises (`EX-READY-CANCEL-SCRATCH-A` through `-D`) were created through the supported bootstrap/READY path, with disposable Auth identities and scoped roles. These were not production exercises.

| Case | Observed result |
| --- | --- |
| A: first READY cancellation | READY revision 1 became CANCELLED revision 2; one `CANCEL` receipt and one SUCCESS audit. |
| A: identical retry | Same durable revision/timestamp; `idempotent=true`; no second receipt or revision. |
| A: same operation ID, changed reason | `OPERATION_ID_CONFLICT`; no new mutation. |
| A: terminal fences | New scoped role grant rejected `TERMINAL_EXERCISE_READ_ONLY`; patient-head insert and writer acquisition rejected `EXERCISE_TERMINAL`. |
| B: valid active writer first | Cancellation rejected `ACTIVE_WRITER_PRESENT`; after supported lease release, cancellation succeeded; scoped role revocation succeeded separately. |
| C: cancellation wins concurrent transactions | Cancellation held the advisory lock; concurrent acquisition waited and then rejected `EXERCISE_TERMINAL`. One revision increment, one receipt/audit, zero active writers. |
| C: archive-as-completed | Completed-archive RPC rejected `TERMINAL_STATE_REQUIRED`. |
| D: unauthorized actor / stale revision | Scoped EXCON alone rejected `PLATFORM_ADMIN_REQUIRED`; wrong expected revision rejected `REVISION_CONFLICT`. |
| D: acquisition wins concurrent transactions | Writer acquired first; waiting cancellation rejected `ACTIVE_WRITER_PRESENT`. READY revision remained 1 with no cancellation receipt/audit. After supported release, cancellation succeeded. |

Final fixture readback before scratch cleanup showed all four exercises CANCELLED at revision 2, each with exactly one cancellation receipt and one successful cancellation audit, and zero active writers. On scratch, `authenticated` lacked direct INSERT/UPDATE on `exercise_states` and EXECUTE on the cancellation RPC; intended SELECT remained available. `service_role` alone had cancellation EXECUTE.

Security-linter findings on scratch were existing generic warnings for intentionally callable authenticated `SECURITY DEFINER` RPCs, RLS tables with no policies, and baseline performance advisories; the new cancellation RPC was not callable by `authenticated`. These existing advisories were not changed as part of this narrow work package.

## Automated verification and limits

The final full Jest suite passed 323/323 suites and 2726/2726 tests after the implementation. Focused cancellation tests, TypeScript, ESLint, all runtime/multi-device/persistence guardrails, and Builder published-asset verification passed. The external Narva workbooks needed by two tests were supplied as byte-identical read-only project fixtures in the isolated temporary workspace; the source mirror and existing dirty checkout were not edited.

The scratch test invokes the trusted database contract directly and verifies real transaction ordering. The new Admin Edge operation and Admin UI are covered by static/service tests, but no production Edge deployment or physical UI acceptance occurred here. Production deployment must apply the migration before deploying the updated Admin Edge Function and distributing the updated client; afterward, perform a separate controlled production TEST acceptance and cleanup. APK 174 EXCON acceptance and production-release readiness remain blocked.
