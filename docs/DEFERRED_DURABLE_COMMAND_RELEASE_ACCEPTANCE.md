# Deferred durable-command release and physical acceptance

This runbook prepares one fail-closed future session for P01 internal transfer, Imaging, ETT, transport/readiness, and patient completion. It does not authorize deployment by itself. The single local entry point is:

```text
npm run runtime:deferred-acceptance -- --mode <prepare|physical-precheck|evidence-template|verify-evidence> ...
```

Every JSON output is written with mode `0600`. It contains identifiers and bounded acceptance facts only—never credentials or full checkpoints.

## Fixed target and migration inventory

Target project: `fimcsrivizpliiuoqopv`.

| Order | Migration | SHA-256 | Enables |
| --- | --- | --- | --- |
| 1 | `20260925120000_add_imaging_runtime_patient_command.sql` | `53998d103eff56f36b6826fe3ede9a40298dd2c81def8dd07de299aa585a7bfd` | `IMAGING_ORDER` |
| 2 | `20260926120000_add_endotracheal_intubation_runtime_patient_command.sql` | `b1b411031e5bd3903ad3e5bbc71cdaf14b776cef5236bb02320395d609acdf39` | `ENDOTRACHEAL_INTUBATION` |
| 3 | `20260926143000_add_patient_complete_runtime_patient_command.sql` | `48553387691c2a3884375b29a7345ab20e8c66baa0d55fbb74b77780f416c371` | `PATIENT_COMPLETE` |
| 4 | `20260927120000_add_patient_location_transfer_runtime_patient_command.sql` | `5bfc19e82927c8208cc2d9d21fb662acfb933ca260d9c3f00d3c6fb494a260a4` | `PATIENT_LOCATION_TRANSFER` |

All four are cumulative, additive whitelist/RPC changes. They alter only the `runtime_patient_commands` command-type constraint and supported `submit_runtime_patient_command` definition. They create no table, weaken no RLS policy, and contain no destructive data operation. Apply them chronologically; each later migration preserves the earlier command types and validation.

## Read-only ledger finding on 2026-09-26

The recorded project ledger contained 31 migrations and ended at semantic migration `large_canonical_checkpoint_publication_timeout` (`20260918145252` remotely). None of the four deferred semantic migration names was deployed. The live RPC whitelist ended at `LAB_ORDER`/`LAB_COLLECT` and therefore did not yet admit Imaging, ETT, patient completion, or patient location transfer. A fresh read-only ledger remains mandatory.

Historical local and remote version timestamps differ even when their semantic migration names match. Consequently, `supabase db push` is prohibited for this release: it can interpret already-deployed historical work as missing. There were no unrelated semantic migrations after the established baseline in the prepared local inventory; the baseline-tail files are the four listed above. Any newly observed unrelated migration stops preflight.

## Future preflight

1. Keep the Mac unlocked and start `caffeinate -di`.
2. Obtain a fresh read-only migration list for project `fimcsrivizpliiuoqopv` with the Supabase connector and save the bounded JSON ledger as mode `0600`.
3. Run:

   ```text
   npm run runtime:deferred-acceptance -- --mode physical-precheck --expected-head <ACCEPTED_HEAD> --device <SAMSUNG_SERIAL> --apk <SIGNED_APK> --apk-sha256 <EXPECTED_SHA256> --version-code <EXPECTED_VERSION_CODE> --ledger <FRESH_LEDGER.json> --backend-state <SUPPORTED_READ_ONLY_PREFLIGHT.json> --output artifacts/deferred-precheck.json
   ```

4. Produce the bounded backend-state input through supported read-only lifecycle APIs. It must identify the project and report active-assignment conflict, active bootstrap/global counts, writer count, unexpected lease state, and package availability. Missing input blocks; the harness never assumes safe defaults.
5. Stop before mutation unless HEAD is exact, the tree is clean, the APK file SHA and installed version match, project/keychain/device checks pass, writer count is at most one, bootstrap/global state is clean, no assignment conflict or unexpected lease exists, and the ledger reports exactly the expected state.
6. The exact Keychain metadata check uses account `russicaptor-supabase-service-role` and service `RussiCaptor-Supabase-ServiceRole-fimcsrivizpliiuoqopv`. It must not read or record the value during preflight.

## Supported deployment sequence

Do not use `db push`, ad-hoc SQL, or operational-table mutation. For each row in the inventory, in order:

1. Re-hash the exact repository file and compare it with this runbook.
2. Use the Supabase connector's supported `apply_migration` operation with project ID `fimcsrivizpliiuoqopv`, the exact semantic migration name, and the exact verified file contents.
3. Stop if application returns any error.
4. Refresh the migration list and require the semantic name exactly once.
5. Read-only introspect `runtime_patient_commands_command_type_check` and `pg_get_functiondef(submit_runtime_patient_command(...))`; require the newly enabled command and all prior commands, exact payload validation, authentication/authorization, CAS, idempotency, and completion fencing.
6. Only then continue to the next migration.

Schema introspection is sufficient post-deploy verification; do not manufacture clinical commands during deployment preflight. Real command acceptance is proved by the physical gates.

If only a prefix deployed, classify the session as partial deployment and stop. Preserve the before/after ledgers and tool response, reconcile source/backend compatibility, and continue only through a reviewed forward-fix or the remaining exact verified migration. Never invent destructive rollback SQL or repair ledger history to conceal the state.

## Combined physical gate order

One fresh `russicaptor.narva-trauma@1.0.4` exercise should be reused where practical. Any foundational `FAIL` or `BLOCKED` skips all later gates.

### A — Runtime

Create through the supported bootstrap lifecycle, retain scoped assignment IDs, establish exactly one writer, require a canonical checkpoint, cold restart, and require restored Runtime without “Simulatsiooni olek pole saadaval”.

### B — P01 internal transfer

Before any later location-changing action, require P01 at `NARVA_HOSPITAL_OUTDOOR`, P02 at its unchanged start, and `P01-MOVE-ED` visible only for P01. Submit exactly one `PATIENT_LOCATION_TRANSFER`; require one writer materialization, final location `NARVA_ED`, and one deterministic timeline event. Capture command/evidence IDs and checkpoint revisions. Require zero transport instances before and after, unchanged vehicle reservation/destination/outbound/handover clocks, identical ED location after cold restart, a disabled or absent completed action, and zero replay duplicates.

### C — Imaging

Reuse the existing Narva Imaging harness. Require exactly one `P02-CXR` for `PT-CHEST-001`, zero Imaging for `PT-PELVIC-001`, one `IMAGING_ORDER`, no report before T+420, one immutable RESULTED report with `Massiivsele hemopneumotooraksile sobiv leid.`, no asset, and identical cold restoration.

### D — Intervention availability/readiness

Require pelvic binder only for the pelvic patient and pleural drain only for the chest patient. Valid controls enable only while shared durable readiness is true. Observe a natural reconciliation transition when available; do not manufacture unsafe stale state merely to force it.

### E — ETT

On an allowed patient, submit one ETT intent. Require one durable command, one writer materialization, canonical airway state, unchanged ventilation prerequisite behavior, identical cold restoration, and no replay duplication.

### F — Transport

Choose either package destination without implying patient-specific mapping. Require one `TRANSPORT_START`, accepted-time anchoring, deterministic mid-phase cold restoration, exactly-once arrival/handover evidence, correct vehicle return/turnaround availability, and no automatic patient completion.

### G — Patient completion

After the patient-specific gates, submit one `PATIENT_COMPLETE`. Require one materialization, Completed status, one assignment removal, pending-event cancellation once, one evidence event, cold restoration, idempotent replay, and an exercise that remains RUNNING.

With one Samsung, record `DEFERRED_SECOND_CLIENT` for Imaging reader convergence, P01-transfer/ETT/transport/patient-completion reader submission, and simultaneous-client takeover. This is not a main-gate failure.

## Authorization and cleanup

Before grants, read active assignments through supported lifecycle APIs. Reuse an exact valid exercise-scoped assignment, handle `ACTIVE_ASSIGNMENT_CONFLICT` explicitly, and otherwise use only audited bootstrap/EXCON/CM RPCs. P01 transfer uses only the minimum scoped CM authority already required for its patient action. Never grant GLOBAL. Track which assignments the session created.

Cleanup order is fixed: stop new commands; collect final evidence; revoke session-created CM, EXCON, and bootstrap assignments; verify active assignments; stop app/runtime; verify lease release/expiry; restore Samsung brightness/mode/stay-awake; stop `caffeinate` last. Preserve unrelated assignments and the acceptance exercise evidence.

Keep Samsung awake, unlocked, and optionally dimmed. Never send `KEYCODE_SLEEP` or `KEYCODE_POWER`. Never lock, sleep, log out, reboot, or shut down the Mac.

## Immediate stop conditions

Stop on an unexpected ledger, unrelated pending migration, hash mismatch, partial deployment, failed introspection, more than one writer, missing checkpoint, unsafe readiness, expected-command whitelist rejection, product invariant failure, or ambiguous authorization. P01-specific failures are a non-outdoor fresh start, missing or cross-patient action, rejected `PATIENT_LOCATION_TRANSFER`, duplicate materialization/evidence, wrong final location, any transport mutation, or lost state after cold restart. Preserve evidence and clean up safely; do not broaden scope.

## Evidence

Generate the template with:

```text
npm run runtime:deferred-acceptance -- --mode evidence-template --ledger <FRESH_LEDGER.json> --output artifacts/deferred-session-evidence.json
```

Record repository and APK identity, migration ledgers/hashes, exercise/runtime/lease/assignment IDs, checkpoint revisions, bounded command/materialization evidence, simulation timestamps, P01-transfer/Imaging/ETT/transport/completion results, duplicate counts, restart results, second-client deferrals, and cleanup. The bounded `patientLocationTransfer` section contains only package/patient/action/command/evidence IDs, locations, counts, checkpoint revisions, and transport-isolation facts. Validate after the session with `--mode verify-evidence`. Do not include secrets, credential values, or full checkpoint payloads.
