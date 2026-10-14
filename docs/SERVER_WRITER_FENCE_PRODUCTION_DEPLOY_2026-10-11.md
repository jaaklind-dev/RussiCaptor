# Production writer-fence deployment acceptance — 2026-10-11

Source: `feature/exercise-builder-v1`, starting HEAD `b197a5b48dd808ece2bb369d8bd8eb79bbc1b93f`. Target project: `fimcsrivizpliiuoqopv` (`jaaklind-dev's Project`, `eu-west-1`, `db.fimcsrivizpliiuoqopv.supabase.co`). Scratch acceptance and 50/50 historical migration alignment were complete before this work.

## Migration and schema

The committed `20261011090155_exercise_state_server_writer_fence.sql` SHA-256 was `dafe26bea87ce54bf5e7d0648c3cd5bba980cb7bdcb20a48448f652fa80a83e4`. Supabase CLI 2.119.0 dry-run with explicit production `--project-ref` and `--skip-vault` listed this file alone. The supported `db push` applied it once, with no seeds, role file, or Vault update. Production migration ledger changed from 50 to 51; the new version/name occurs once. A subsequent dry-run reported `upToDate: true` and zero pending migrations.

Production definitions of all six relevant functions (four new write RPCs, the bootstrap trigger function, and the service-role-only recovery fixture) have exactly the same `pg_get_functiondef` hashes, security-definer flags, search paths, and authenticated EXECUTE settings as the canonical scratch database. The new operation-receipt table has RLS enabled and no authenticated table privileges or policies. `exercise_states` retains RLS and the scoped SELECT policy; authenticated SELECT remains granted, while INSERT and UPDATE changed from granted to denied. Its two historical write policies were removed.

Before-to-after schema fingerprints changed for relations, columns, constraints, and indexes because the migration adds `exercise_state_publication_operations`, and for the intended `exercise_states` ACL/policy and six function definitions. The fingerprints for unrelated functions (`d79f0065a303cd885a518c3e79ca7395`), unrelated policies (`324404882f0c4d311ebe76b56c053583`), triggers (`149a8b11e37345fad8cb3a68a2fdc86c`), and Realtime membership (`60b1a892cfa8656a934e3c3029940d3c`) did not change. A final fingerprint after acceptance exactly matched the immediate post-migration fingerprint.

## Real production database acceptance

These tests used the database's ordinary `authenticated` role and controlled JWT user identity in transactions, except for narrowly scoped service-role fixture/admin setup. They prove server-side database behavior, **not** an HTTP/mobile two-device UI flow. No service-role credential was placed in the client or logged.

| Check | Production result |
| --- | --- |
| Direct authenticated INSERT / UPDATE / UPSERT | All rejected with SQLSTATE `42501` (permission denied). |
| Scoped authenticated SELECT | Allowed; TEST READY revision 1 and package `russicaptor.narva-trauma@1.0.5` read back. |
| READY creation and identical retry | First creation revision 1; retry returned the same revision/timestamp without another row. |
| Writer A valid publication | `PROD-WF-A-20261011-01`, lease `23262b1f-24f0-4a7d-a5a3-53d88b65171d`: revision 1→2. |
| Active operation retry / conflict | Identical retry returned revision 2; altered payload with the same operation ID returned `OPERATION_ID_CONFLICT`. |
| Stale expected revision | `REVISION_CONFLICT`; no mutation. |
| Writer B supported takeover | After A's lease expired, independent instance `PROD-WF-B-20261011-01`, lease `4212f7f1-64f6-4d23-9f7a-7e1c1263a5ad`, acquired the canonical lease. Exactly one active writer. B published revisions 3 and 4. |
| Old A after unseen takeover | A retained its old lease/generation and attempted a PAUSED publication; server returned `WRITER_GENERATION_STALE`. Revision stayed 3 at that boundary and B continued to revision 4. |
| Finalization / identical retry | Supported completion request and canonical-payload finalization produced terminal checkpoint revision 1 and exercise-state revision 5. Retry returned the same checkpoint and timestamp. Old B's post-terminal active publication returned `WRITER_REVOKED`. |
| Terminal archive | Source `completedExerciseArchives: []`. First append produced one archive at state revision 6; identical retry stayed at 6; different content returned `ARCHIVE_CONFLICT`. |
| Recovery fixture privilege | Ordinary authenticated EXECUTE denied (`42501`); controlled service-role fixture used one-shot READY bootstrap, a real writer publication, and lease release. |
| Missing-runtime recovery | `RECOVERY_TERMINATED`; retry `INVALID_EXERCISE_LIFECYCLE`; unscoped ordinary caller `RECOVERY_NOT_AUTHORIZED`. |
| Stale-checkpoint recovery | Writer-published checkpoint session version 1, newer projection version 2, released lease: `STALE_RUNTIME_TERMINATED`; retry `ALREADY_TERMINAL`; unscoped caller `AUTHORIZATION_DENIED`. |
| Package-divergence recovery | Writer-published valid TEST checkpoint with divergent package identity and empty persisted-runtime array: `TERMINALIZED_DIVERGENT_STATE`; retry `ALREADY_TERMINAL`; unscoped caller `RECOVERY_NOT_AUTHORIZED`. No production package data was changed. |

The core TEST exercise was `TEST-WF-PROD-20261011-01`. Three service-only recovery fixtures were `RUNTIME-RECOVERY-ACCEPTANCE-d4ada1166c2d79a363f1cbc59ba0251d`, `RUNTIME-RECOVERY-ACCEPTANCE-9d666dc221df5b51e75bbdb7da8ba3b9`, and `RUNTIME-RECOVERY-ACCEPTANCE-286990d3a64e3dcf38395a98f818abf1`. All four are COMPLETED, with revisions 6, 3, 4, and 3 respectively; all leases are released. They remain durable terminal/audit evidence because this project has no supported exercise-deletion contract; no direct row deletion was used.

Final controlled-state counts: active writer leases 0; active CM 0; active EXCON 0; active GLOBAL 0; TEST-scope patient owners 0; RUNNING/PAUSED acceptance exercises 0; unused bootstrap authorizations 0; unused recovery authorizations 0. Two consumed bootstrap rows retain database status ACTIVE, but are non-reusable and historically bound to their TEST exercises; the supported revoke RPC rejects already-consumed authorizations, and a later supported grant can retire them after expiry. Auth users stayed at 114; no test user or password was created or changed. A global count of 66 pre-existing patient-owner rows is outside the TEST scope and was not mutated. No non-TEST `exercise_states` row had `updated_at` in the deployment/acceptance window.

## Local and physical checks

The post-deploy source passed 318/318 suites and 2658/2658 tests, TypeScript, ESLint, runtime guardrails (19 suites/242 tests), multi-device guardrails (16 suites/183 tests), persistence guardrails (18 suites/198 tests), and `git diff --check`. Only Samsung `R5GL236L6ZJ` was connected; it was powered and awake. The second Samsung was unavailable, so an actual two-physical-client takeover was **not run**. Server-side A→B identities were independent writer instances under one controlled authenticated account; no claim is made that a mobile client failed to observe Realtime.

Production migration/RPC/permission/runtime acceptance and scoped cleanup: **PASS**. The broader physical two-client C11 checkpoint remains **NOT RUN**, so the combined all-C-checkpoint atomicity gate is not claimed as PASS. No merge, tag, or release was performed.

## Subsequent physical checkpoint

The preceding NOT RUN statement describes the 2026-10-11 deployment checkpoint and is preserved as history. C11 was subsequently completed on 2026-10-14 with two physical Samsung clients and a non-distributable APK 172. See [the later C11 acceptance report](SERVER_WRITER_FENCE_C11_DUAL_PHYSICAL_ACCEPTANCE_2026-10-14.md) for the physical/server evidence, limitations, and cleanup. At that later checkpoint C1–C12 and the server writer-fence atomicity gate were accepted as PASS; this does not retroactively change what had been tested on 2026-10-11.
