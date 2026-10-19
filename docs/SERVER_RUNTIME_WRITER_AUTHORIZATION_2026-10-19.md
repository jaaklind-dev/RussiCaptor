# Server runtime writer authorization correction

Status: local security implementation; **not deployed**. Production deployment,
physical acceptance and publication are not authorized.

## Contract and compatibility

An effective `EXCON_EXERCISE_CONTROL` permission for the target exercise is
required to create or operate authoritative runtime writer state. A CM's
`CM_WORKFLOW_WRITE`, patient ownership, navigation mode or a `PLATFORM_ADMIN`
assignment cannot independently grant this authority. Existing non-anonymous
Auth identity, ACTIVE profile, effective assignment, scope, lifecycle, lease
identity/user/instance/expiry, generation, revision and integrity checks remain.
GLOBAL EXCON keeps its existing permission semantics; explicit active takeover
continues to require an exact exercise-scoped EXCON assignment as well.

This supersedes only the historical **CM OR EXCON writer-table trigger** in
WP-NEXT-02. CM retains scoped patient ownership, workflow mutation and durable
clinical-intent submission. No clinical model, command meaning, payload format,
checkpoint hash, writer-generation mechanism or RLS policy changes.

## Root cause and minimal change

Definer RPCs bypass ordinary RLS. Their lease/checkpoint writes invoke
`enforce_runtime_operator_scope`, whose old CM-or-EXCON predicate was broader
than the controller-only client guard. The additive migration
`20261019171013_runtime_writer_controller_authorization.sql` changes that
shared trigger function to require EXCON control.

`record_runtime_patient_command_result` is a separate writer-ledger operation:
it does not write either guarded table. The same migration adds an EXCON
permission check before its unchanged lease and result-update logic. This also
fences legacy CM-owned leases rather than relying solely on denying new leases.

## Complete authority trace

| Entry / path | Enforced boundary after correction |
| --- | --- |
| `acquire_runtime_writer`, including released/expired lease replacement and own-lease reacquisition | lease trigger: EXCON; existing lifecycle, expected checkpoint revision, lock and active-foreign-writer checks |
| `takeover_runtime_writer`, `read_runtime_writer_takeover_target` | existing explicit EXCON permission **and exact EXERCISE assignment**; prior lease UUID, checkpoint and lifecycle checks; no broader takeover |
| `renew_runtime_writer`, `release_runtime_writer` | exact lease/user/instance/expiry rules as applicable, plus EXCON lease trigger |
| `publish_runtime_checkpoint_metadata`, `publish_runtime_checkpoint_delta` | current writer and checkpoint CAS; EXCON checkpoint trigger; existing completion fence |
| `publish_runtime_checkpoint_canonical`, `_canonical_delta` | guarded metadata/delta write, then existing canonical artifact verification |
| `publish_runtime_checkpoint_canonical_payload`, `_canonical_payload_delta` | actual payload hash/identity/format verification, guarded metadata/delta write, verified artifact persistence |
| `record_runtime_patient_command_result` | new explicit EXCON check, then unchanged current-lease/user/instance/expiry and accepted-command update |
| authoritative clock in checkpoint | same guarded checkpoint path; no independent CM clock-write authorization |
| `publish_exercise_state_current_writer` | existing explicit EXCON check, lease UUID fence before idempotent receipt, projection CAS and lifecycle/package validation |
| `submit_runtime_completion_request` | existing EXCON, lifecycle and exercise-version checks |
| `finalize_runtime_completion`, `_canonical`, `_canonical_payload` | current writer, exact existing request ID, terminal checkpoint/cursor/CAS, EXCON checkpoint/lease triggers, then unchanged atomic terminal projection/receipt/release |
| `terminate_exercise_with_missing_runtime`, `terminate_stale_runtime_after_lease_expiry`, package-projection divergence recovery | existing `EXERCISE_RUNTIME_RECOVERY` permission (EXCON mapping), documented recovery conditions; any lease/checkpoint write also hits the shared guard |
| internal artifact install/persist/derive helpers and acceptance-fixture RPC | existing service-role-only executable interfaces; no new grants, client bypass or service key introduced |
| trusted READY cancellation | existing PLATFORM_ADMIN trusted service boundary and OFF feature gate; not runtime writer acquisition; unchanged |

Attached triggers remain `runtime_writer_lease_operator_scope` on
`runtime_writer_leases` and `runtime_checkpoint_operator_scope` on
`runtime_checkpoints`. Generation, terminal, package and completion triggers are
unchanged. Scoped SELECT policies remain unchanged; mobile direct row mutation
does not gain an RLS policy. Existing historical non-row ACL concerns from the
read-only audit remain a separate hardening review, not resolved by this patch.

## PENDING completion: no CM exception

The supported recovery contract is unambiguous in:

- `docs/incidents/2026-10-17-route-loop-completion-recovery.json`:
  supported **EXCON** recovery, preserve original completion command, no new
  completion operation.
- `docs/WP_NEXT_03_PHYSICAL_VALIDATION_HARNESS.md`: CM harness does not acquire
  writer or repair checkpoints; use supported EXCON recovery.
- `RuntimeCheckpointSyncService.runtimeWriterAcquisitionAllowed` and recovery
  startup: active EXCON plus EXCON mode; CM is a reader/intent submitter.
- `ensure_shared_workflow_patient_head`: recovery permission required; PENDING
  permits observing an existing head, not creating missing canonical heads.

Therefore incidental CM finalization under a legacy lease is not a required
supported recovery mechanism. It is denied. An authorized replacement EXCON can
acquire the available/expired/released lease, reconstruct the canonical state,
reuse the original PENDING command ID and finalize atomically. Ordinary
checkpoint publication remains fenced while PENDING. Lost-response terminal
retry may read an already-COMPLETED receipt without acquiring writer authority;
the preexisting idempotent receipt behavior is not a new writer exception.

Deployment preflight must require no active legacy CM writer or arrange a
separately authorized supported handover/expiry. Revoked/expired EXCON cannot
renew or publish; this change does not grant a new cleanup privilege.

## Automated verification

`scripts/test-writer-authorization.mjs` creates a fresh, in-memory PostgreSQL
instance using pinned dev dependency PGlite 0.5.10 and real pgcrypto. It accepts
no connection string and never connects to Supabase. Minimal `auth.users`, JWT
accessors, API roles/default grants and publication stand in for Supabase
platform setup. It then applies **supabase/schema.sql and every actual migration
in order**, including the correction. No application RPC or permission function
is mocked. Synthetic identities are unrelated to production users.

Actual PostgreSQL `SET ROLE authenticated` calls exercise RPCs and definer/trigger
authorization. Privileged setup constructs legacy CM leases intentionally; denied
RPCs must leave lease/checkpoint/projection/completion/artifact/command snapshots
unchanged. Catalog comparisons require exactly two function-definition changes
and identical RLS policies and trigger definitions/enabled states.

Run after normal dependency installation:

```sh
node scripts/test-writer-authorization.mjs
npm test -- --runTestsByPath scripts/__tests__/ServerWriterAuthorization-test.ts
```

The optional `WRITER_AUTH_PGLITE_MODULE` path selects an already installed test
dependency in controlled environments; it is never a database endpoint.
Missing dependencies, failed migrations and SQL rejection mismatches fail the
test, never skip it. PostgreSQL here is 18.6/WASM; production is 17.6/native.
These are real SQL authorization tests, not a claim of version-identical staging
or HTTP/JWT gateway acceptance. Native staging verification before production
deployment and separately authorized physical acceptance remain required.

Affected guardrails: A, G, H, I, M, R, S, T, U, Y and CM-HEAD controller/reader
separation. Full existing guardrails and canonical regression remain mandatory.
No clinical calculations, checkpoint format or writer-fence logic are altered.

## APK and deployment boundary

APK 183 and 184 already restrict client writer acquisition/recovery to EXCON
and use unchanged RPC signatures/results. Scoped CM workflows remain supported.
They are protocol-compatible with this correction; no new APK is required by
this server-only change. Existing APK hashes/signatures/manifests stay untouched.
This is source/SQL compatibility, not physical installation acceptance.

Production remains on 53 migrations until separate deployment authorization.
The additive migration is the proposed 54th. Future deployment/build provenance
must record it and refresh the production ledger; do not pretend it was in the
old 183/184 embedded 53-migration evidence or modify those validated artifacts.
The release descriptor is deliberately not rewritten to claim a deployment.

Admin Edge v7 source equivalence is independent: metadata and historical list
acceptance do not establish source equivalence when supported source download
is unavailable. No Admin Edge implementation or deployment is changed here.
