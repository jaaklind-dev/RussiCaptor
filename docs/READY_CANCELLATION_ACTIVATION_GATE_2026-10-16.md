# READY cancellation activation gate (2026-10-16)

## Scope and source identity

Work branch: `feature/ready-exercise-cancellation`, based on implementation commit `37f11a66d3b347dba34d61e52ccc6801c2009cc8` and production main `aeaef720429a81133ef6f0477e39a2f237a89733`.

This work changes the single **undeployed** migration `20261016065854_ready_exercise_cancellation.sql`; the preceding 52 migration files are unchanged. No production migration, Edge deployment, APK build/install, physical test, production exercise, permission grant, push, merge, tag, or release was performed. Production was queried read-only. The existing dirty checkout at `/Users/jaak/Projects/RussiCaptor` was not used or changed.

| Artifact | SHA-256 |
| --- | --- |
| Original cancellation migration at `37f11a66` | `a9aca8e0d2c51612b62e64a18e21b39e4e7ee56ee79f1da4b1057cbeefe121c9` |
| Amended cancellation migration | `03c77fb38ab10a49dbf59aa8e295c222b09868f910764536204dc81d20aa57ec` |
| Unchanged `supabase/schema.sql` | `faa7c909033cd32a57c1ec6344baeb22c14aa8b19a0fe59eb58b5e81cf958694` |

Impact classification: terminal lifecycle plus live Admin UI. The persistence, multi-device, Runtime, security, and full-release automated guardrails remain mandatory. Physical Admin control acceptance is deferred to a separately authorized release work package; existing C11 evidence is preserved and was not repeated.

## Activation contract

`public.ready_exercise_cancellation_activation` contains one constrained row, key `READY_CANCELLATION`, seeded `enabled=false`. Its state persists in PostgreSQL, independently of app or Edge restarts. RLS is enabled with no client policies. `PUBLIC`, `anon`, and `authenticated` have no table privileges; `service_role` has SELECT only.

The trusted cancellation RPC validates its bounded request and active Admin identity, then reads the gate `FOR SHARE` before the exercise advisory lock or operation-receipt lookup. False or missing state raises `READY_CANCELLATION_DISABLED`. A disabled call cannot change canonical state/revision, create a cancellation receipt, or create a cancellation audit event. Even an exact retry of a previously successful operation is rejected while OFF; its historical receipt remains unchanged.

The shared gate lock lasts to transaction end. Activation/deactivation obtains `FOR UPDATE` on the same row, so changing the gate and cancelling have a definite commit order. Existing per-exercise advisory/lease/checkpoint/state lock order, READY-only checks, revision fence, idempotency, authorization, terminal lease guard, patient guard, and terminal role-grant guard are preserved.

`public.set_ready_exercise_cancellation_activation(boolean,text)` is a purpose-specific **SECURITY INVOKER** database deployment operation with empty `search_path`. EXECUTE is revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`. It is not an application Admin or EXCON capability, and no Edge/UI toggle was added. The migration owner/database deployment administrator is the intended caller.

The procedure requires a bounded non-secret change reference. A changed value and its `READY_CANCELLATION_ENABLED` / `READY_CANCELLATION_DISABLED` audit record commit atomically. A repeat requesting the same value returns `changed=false` and creates no duplicate transition audit. The audit records the database role and change reference, with `actor_user_id=NULL`; a database role is not represented as a human identity. The change reference must point to the external approval/operator record.

Only successful cancellation is recorded as `EXERCISE_READY_CANCELLED`, in the SQL transaction with state and receipt. Edge rejection paths do not write cancellation audit events, including malformed requests rejected before the database gate check. Other administrative operations retain their existing failure audits.

## Admin behavior

The existing Admin-only exercise list reads the singleton through its service client and returns `readyCancellationEnabled`. Missing, malformed, or failed readback is false. An old Edge response lacking this field is also false in the new client.

The READY cancellation control is hidden unless the authenticated Admin's current session generation has a successful, explicitly true status readback. Refresh start/failure, authorization changes, and cancellation failure invalidate any cached enablement. Cached exercise listings may remain visible after a failed refresh without retaining an actionable cancellation control. Explicit confirmation, stable operation ID, READY-only behavior, and Admin authorization remain in place. A stale UI that has not yet refreshed is still rejected by the authoritative database gate. The bounded disabled response is shown as `Õppuse tühistamine ei ole praegu sisse lülitatud.`

## Real PostgreSQL validation

The only mutable remote target was scratch `thixnregyriwevgptclw`, name `russicaptor-migration-scratch-20261011`, region `eu-west-1`, host `db.thixnregyriwevgptclw.supabase.co`. Identity was checked before reset. CLI version: `2.119.0`.

The clean two-stage bootstrap was repeated twice: byte-identical `schema.sql` first, then all 53 canonical migrations in order, ending at the amended migration and SHA above. A temporary earlier baseline helper carried the exact schema bytes for supported scratch reset; only its scratch history marker was removed using supported `migration repair --status reverted`. The helper and generated CLI metadata were removed locally. Final local/scratch version sets and order are identical: 53/53, no duplicates or temporary baseline entry.

The committed `supabase/tests/ready_cancellation_activation_test.sql` uses an empty-database guard and rolls back all synthetic Auth/profile/Admin/bootstrap/exercise fixtures. The final run passed and returned `enabled=false`, exercises/users/audit rows all zero. It verifies:

- Default OFF and missing-singleton fault injection fail closed without canonical mutation, cancellation receipt, or cancellation audit.
- READY creation and READY -> RUNNING -> PAUSED publication work with the gate OFF; forged CANCELLED publication is rejected.
- Authenticated and service-role activation/function/table mutation attempts fail; ordinary direct INSERT/UPDATE remains denied.
- ON permits the authorized unused READY cancellation, advances revision exactly once, and preserves identical retry, conflicting operation ID, stale revision, and non-Admin rejection.
- CANCELLED cannot acquire a writer or receive a new scoped role. PAUSED cannot be cancelled.
- OFF again blocks even the prior operation retry, preserving the existing CANCELLED row and its one receipt/audit.
- Repeated ON/OFF calls are idempotent; invalid activation input leaves state unchanged; transition audits are consistent.

Four additional scratch-only SQL fixtures were used for separate concurrent connections, then discarded by the final clean reset. `pg_stat_activity` observed each holder transaction sleeping after its relevant locks were acquired; the contender measured real lock waiting, not sequential simulated calls.

| Commit order | Observed contender result | Measured wait | Durable result |
| --- | --- | --- | --- |
| Writer acquisition before cancellation | `ACTIVE_WRITER_PRESENT` | 37,460.313 ms | READY revision 1, no cancellation receipt/audit |
| Cancellation before writer acquisition | `EXERCISE_TERMINAL` | 34,077.956 ms | CANCELLED revision 2, one cancellation receipt/audit, no writer row |
| Cancellation before OFF | Deactivation succeeds after cancellation commits | 33,973.559 ms | Gate OFF; existing CANCELLED revision 2 and receipt retained |
| OFF before cancellation | `READY_CANCELLATION_DISABLED` | 35,255.579 ms | READY revision 1, zero cancellation receipts/audits |

Final reset/readback: gate OFF with `MIGRATION_DEFAULT_OFF`; exercises, leases, scoped/GLOBAL roles, platform admins, patient heads, bootstrap/recovery authorizations, Auth users, operation receipts, and administrative audit rows all **0**. Authenticated SELECT remains available; direct INSERT/UPDATE remains denied.

Security advisors report the new gate table as informational `rls_enabled_no_policy`: that is intentional default-deny, confirmed with actual ACL tests. Existing warnings for intentionally callable authenticated SECURITY DEFINER runtime RPCs remain; neither the cancellation RPC nor activation procedure is callable by ordinary authenticated clients. The activation procedure is SECURITY INVOKER. See the [Supabase linter explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Automated validation

Final validation after the Edge audit correction:

- Full Jest: 324 suites / 2737 tests PASS.
- TypeScript, ESLint, and `git diff --check`: PASS.
- All guardrails: 84 suites / 854 tests PASS; explicit Runtime: 20/269; persistence: 18/213; RuntimeHardening: 1/2.
- Builder published assets: PASS (1 package, 2 assets); release descriptor validation: PASS.

These automated results cover status parsing, disabled/missing status, cached-list refresh failure, session transitions, confirmation, one mutation call/no retry, bounded disabled messaging, and server contract/grant/lock checks. They do not claim a newly built APK or physical Admin acceptance.

## Old clients and deployment boundary

Production `fimcsrivizpliiuoqopv` was checked read-only: 52 migrations, cancellation migration absent, activation table absent, CANCELLED rows 0. No production state was changed.

With the migration installed and gate OFF, ordinary supported paths cannot introduce CANCELLED, and existing READY/RUNNING/PAUSED workflows retain their previous contract. APK 173/174 have no cancellation control and remain safe for this **pre-activation, zero-CANCELLED** window. Once CANCELLED records exist, those APKs remain incompatible in active selection, CloudSync, lifecycle display, and some controls. Turning OFF later blocks new cancellations; it does not repair old-client compatibility with historical CANCELLED records.

There is no authoritative installed-client inventory in this repository/database. Release identity is embedded locally and exportable in diagnostics; leases have writer/user/exercise identity, not APK version. Generic Auth user agents and absence of old-client traffic do not prove rollout coverage, and session counts are not device counts.

Before activation, an authorized deployment owner must maintain an external controlled inventory of all relevant Admin/EXCON/CM issued devices, including offline/spare devices, and verify on each: package identity, production signer, a cancellation-compatible versionCode greater than 174, and exact approved source/artifact identity. Old installs must be retired or prevented from returning to these contexts. If coverage cannot be established, keep OFF; any future server-enforced minimum-client compatibility mechanism is a separate work package. No coverage percentage is inferred here.

## Supported future deployment and activation procedure

This is a runbook, not authorization to execute it.

1. Obtain separate production deployment authorization. Recheck project identity, production's 52-entry ledger/no CANCELLED rows, migration SHA, live exercise safety, and one-deployer ownership.
2. Deploy the exact amended migration, read back 53/53 history and default OFF, then deploy the matching Admin Edge Function. The gate must remain OFF. The new client may be staged without an actionable cancellation control.
3. Prepare a separately validated compatible distributable, including migration `20261016065854` in release requirements. Complete scoped Admin UI acceptance and the installed-client inventory above. Existing C11 evidence need not be repeated unless a changed invariant fails.
4. Obtain explicit activation approval linked to a non-secret change reference. In the verified production project's trusted database deployment-administrator SQL session, execute the dedicated procedure in a transaction:

```sql
begin;
select * from public.set_ready_exercise_cancellation_activation(
  true, 'CHG-approved-compatible-client-rollout');
commit;
select feature_key, enabled, changed_at, change_reference
from public.ready_exercise_cancellation_activation;
```

5. Read back the matching `READY_CANCELLATION_ENABLED` SUCCESS audit, then refresh the authenticated Admin list. Perform the separately authorized minimal production TEST cancellation/terminal-fence/scoped-role-cleanup acceptance. Never use table UPDATE, service-role impersonation, or ordinary operator permissions to activate.
6. To stop new cancellations, use the same verified DB administrator procedure with `false` and a new approved change reference. Confirm OFF and `READY_CANCELLATION_DISABLED` audit. In-flight cancellation that already holds the shared gate lock may commit before OFF; after OFF commits, subsequent cancellations fail. Preserve all existing CANCELLED records and their audit history. Do not downgrade clients to APK 173/174 afterward.

Migration failure, Edge failure, or interrupted client rollout keeps activation OFF. Inspect actual schema/history before retrying; use forward recovery and the supported migration tooling. Do not delete/rewrite exercise history or manually repair the production ledger as a workaround. Supabase's [migration workflow](https://supabase.com/docs/guides/deployment/database-migrations) remains the deployment mechanism.

## Gates

- `READY_CANCELLATION_ACTIVATION_GATE = PASS`
- `ACTIVATION_DEFAULT_OFF = PASS`
- `REAL_DB_ATOMICITY = PASS`
- `OLD_CLIENT_PRE_ACTIVATION_SAFETY = PASS` for the verified zero-CANCELLED/default-OFF deployment window only.
- `PRODUCTION_DEPLOYMENT_READINESS = PASS` for a separately authorized staged deployment that remains OFF. Activation and release still require compatible-client rollout evidence and scoped acceptance.
- `PRODUCTION_DEPLOYMENT_AUTHORIZED = NO`
- `APK_174_EXCON_ACCEPTANCE = BLOCKED`
- `PRODUCTION_RELEASE_READINESS = BLOCKED`
