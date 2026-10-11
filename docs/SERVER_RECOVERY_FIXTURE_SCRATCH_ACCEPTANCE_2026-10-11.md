# Recovery fixture bootstrap compatibility — scratch acceptance

Date: 2026-10-11. Source branch: `feature/exercise-builder-v1` at `35004ab372f81dbba22d41da74298f15e591db51`. Scratch project: `thixnregyriwevgptclw` (`russicaptor-migration-scratch-20261011`). Production `fimcsrivizpliiuoqopv` was read-only and retained 50 migration ledger entries; the writer-fence migration was not deployed there.

## Change

The historical service-role-only `create_runtime_recovery_acceptance_fixture()` inserted a RUNNING `exercise_states` row directly. The current one-shot bootstrap trigger rejected that with `BOOTSTRAP_AUTHORIZATION_REQUIRED`. The canonical, not-yet-production-deployed writer-fence migration now replaces only this test helper. It creates a one-time bootstrap authorization for the controlled operator, calls `create_initial_exercise_state` for READY, grants exercise-scoped EXCON, acquires a real writer, publishes RUNNING through `publish_exercise_state_current_writer`, releases the lease, and records an audit row. A deterministic actor/key identity makes identical fixture retries return the same exercise. The old no-argument helper is dropped; the replacement has a defaulted key and remains executable only by `service_role`. Production bootstrap enforcement and the three recovery RPCs were not changed.

Writer-fence migration: `supabase/migrations/20261011090155_exercise_state_server_writer_fence.sql`. Previous SHA-256: `a4d0a756c8c1172f676412f0e34a979b556e185f0b036dbb24eab96d40027328`. Committed SHA-256: `dafe26bea87ce54bf5e7d0648c3cd5bba980cb7bdcb20a48448f652fa80a83e4`.

## Automated checks

318/318 suites and 2658/2658 tests passed, including the added fixture/bootstrap static regressions. TypeScript, ESLint, runtime, multi-device and persistence guardrails, and `git diff --check` passed.

## Real scratch database checks

The scratch project identity was verified before reset. A clean remote scratch reset left zero public tables and an empty migration ledger. The committed `supabase/schema.sql` created `exercise_states`, three baseline RLS policies and Realtime membership. All 51 committed migration files were then applied without SQL edits or skipping, in canonical name order; the final writer-fence migration was applied from the committed source. Scratch `apply_migration` generates new *scratch ledger version timestamps*, but its 51 ordered ledger names exactly matched the 51 committed migration filenames. Live function readback showed the fixture calls the READY and writer RPCs, has `SECURITY DEFINER` with empty `search_path`, denies authenticated EXECUTE and grants service-role EXECUTE.

Six credential-free scratch test users and active operator profiles were created. The fixture's first call produced a RUNNING revision-2 exercise with exactly one consumed bootstrap authorization, one audit entry and a released writer lease. Repeating the same actor/key returned the same exercise. Reusing the consumed authorization for another READY exercise returned `BOOTSTRAP_AUTHORIZATION_REQUIRED`. An ordinary authenticated caller could not execute the fixture.

Three production recovery RPCs were exercised in scratch, each with an independent controlled source state and an ordinary caller rejection:

| RPC | Privileged result | Retry result | Ordinary caller |
| --- | --- | --- | --- |
| `terminate_exercise_with_missing_runtime` | `RECOVERY_TERMINATED` / COMPLETED | `INVALID_EXERCISE_LIFECYCLE` | `RECOVERY_NOT_AUTHORIZED` |
| `terminate_stale_runtime_after_lease_expiry` | `STALE_RUNTIME_TERMINATED` / COMPLETED | `ALREADY_TERMINAL` | `AUTHORIZATION_DENIED` |
| `terminalize_package_projection_divergence` | `TERMINALIZED_DIVERGENT_STATE` / COMPLETED | `ALREADY_TERMINAL` | `RECOVERY_NOT_AUTHORIZED` |

The stale-checkpoint test used a supported writer-published canonical revision-1 checkpoint with session version 1, then a writer-published revision-3 projection with session version 2, followed by writer release. The package-divergence test used a supported writer-published canonical checkpoint with a different package identity and an empty persisted-runtime-state array, followed by writer release. No direct-table fallback was used.

A separate core exercise reconfirmed READY creation/retry, valid writer publication, an idempotent publication retry, stale revision rejection (`REVISION_CONFLICT`), direct authenticated INSERT/UPDATE/UPSERT denial (`42501`), A→B takeover after supported lease expiry, stale A rejection (`WRITER_GENERATION_STALE`), valid B publication and exactly one active writer. Supported completion produced COMPLETED revision 4 with `completedExerciseArchives: []`. First archive advanced to revision 5 with exactly one archive; identical operation retry returned revision 5; differing archive content returned `ARCHIVE_CONFLICT`.

## Cleanup and boundary

Before cleanup there were four COMPLETED TEST exercises, no RUNNING/PAUSED exercises, no active writer lease, zero unused bootstrap grants, five temporary scoped roles and six credential-free test users. The disposable scratch database was reset again to remove all test data, then the same committed `schema.sql` and 51 migrations were replayed. Two transient connector `Invalid or expired requestState` responses occurred *before* a migration was accepted; ledger readback confirmed those migrations absent, and retry of the unchanged committed SQL succeeded. Final ledger: 51 unique entries with exact canonical filename order. Final scratch counts: zero exercise states, writer leases, scoped/global roles, patient owners, bootstrap/recovery authorizations, RUNNING/PAUSED exercises and disposable test users. Authenticated SELECT remains granted; INSERT/UPDATE remain revoked; fixture EXECUTE remains service-role-only.

Scratch gate: PASS. Production deployment: NOT RUN. Push/merge/tag/release: NOT RUN.
