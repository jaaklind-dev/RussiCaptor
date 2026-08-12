# WP-43A — Package Patient Materialization Integration

## Objective

WP-43A closes the generic gap between an activated Exercise Package patient dataset and the canonical patient store populated by **Prepare New Exercise**. It adds no physiology and does not change frozen Runtime, replay, Clinical Module, ownership, authorization, or single-active-exercise semantics.

## Baseline

- Baseline commit: `fd05a7c feat(trauma): add WP-43 pelvic hemorrhage and open-book injury`
- `main` and `origin/main` were synchronized before implementation.
- `.idea/caches/deviceStreaming.xml` and `Expo-Go-57.0.3.apk` remain unrelated and excluded.

## Root cause

`ExercisePackage.patientDatasetId` already survived Catalog activation, package binding, package hashing, and Exercise Definition provenance. No registry resolved that identity to patient records. During preparation, `ExerciseResetService` cleared the previous working dataset and installed demo patients, while START knew only about two legacy cardiac package fixtures. Consequently, `patients.pelvic-injury-reference.v1` was retained as metadata but never materialized.

The generic extension point is Exercise Preparation: resolve and validate the package-bound dataset before reset, then install the already-complete plan after the reset succeeds and before READY is published.

## Architecture gate

| Area | Result |
|---|---|
| Package patient dataset contract | Extension required |
| Exercise Package binding | Sufficient |
| Exercise Preparation extension point | Extension required |
| ExerciseResetService | Sufficient |
| Canonical patient store | Sufficient |
| Patient bootstrap | Extension required |
| Package provenance | Sufficient |
| Atomic preparation / rollback | Extension required |

No canonical Runtime, replay, Clinical Module, PatientProcess lifecycle, dependency-direction, or authorization contract change was required. No ADR was required.

## Existing and resulting preparation flow

```text
Catalog activation
  → active immutable Exercise Package
  → Prepare New Exercise
  → resolve exact patientDatasetId/version
  → validate every patient and runtime fixture
  → build immutable, canonically ordered materialization plan
  → capture completed exercise
  → bind composed package
  → reset to the new exercise
  → install the complete patient set in one canonical-store operation
  → publish READY
  → START consumes persisted canonical materialization
```

START never resolves package datasets. ScenarioEngine never imports or looks up packages, datasets, or the materializer.

## Package patient dataset and materialization contracts

`PackagePatientDatasetRegistry` resolves exact versioned identities. Unknown, unversioned, mismatched, duplicate registrations, and unsupported versions fail closed. A dataset contains 1..N immutable `PackagePatientRecord` values. Each record carries the canonical `Patient` and, when the package needs clinical bootstrap, its immutable Runtime fixture.

`createPatientMaterializationPlan` validates all records before state changes and returns immutable provenance:

- exercise ID;
- package ID/version/hash;
- dataset ID/version;
- separate materialization hash;
- canonically ordered patient records and process fixtures.

Historical Package and Exercise Definition hash contracts are not changed.

## Patient identity and deterministic ordering

Package patient IDs are authoritative. No wall clock, randomness, UI state, or input array order contributes to identity. Records are sorted by complete patient ID; input permutation produces identical materialized representation and hash. Duplicate IDs are rejected without implicit renaming.

## Validation

Typed patient dataset failures cover:

- unknown dataset;
- unsupported/mismatched version;
- empty dataset (package-defined exercises require at least one patient);
- duplicate patient ID;
- malformed required canonical patient fields;
- Runtime fixture/patient identity mismatch.

Clinical Module composition remains owned by the Package Loader. The materializer does not resolve modules, execute processes, evaluate protocols, or calculate physiology.

## Atomicity and rollback

All dataset resolution, completeness checks, deterministic ordering, fixture validation, and plan hashing occur before archive capture, package binding, reset, or publication. A failure in patient N therefore leaves the previous completed exercise, archive, patient set, selected package, and audit state unchanged. A reset failure unbinds the attempted package and never installs the plan. Installation uses the existing canonical provider's single batched `installPatients` operation and READY is published only afterwards.

## Idempotency and completed-exercise preservation

Exercise Preparation retains its command-result idempotency cache. Repeating the same command performs one reset, one install, one archive, and one publication. Existing completed-exercise archival captures Debrief, Timeline, Analytics, Assessment, Evaluation and package/protocol provenance before reset; materialization does not mutate the archive.

## Persistence and restart behaviour

The shared persisted exercise state now includes optional materialization provenance. Canonical patients continue through the existing patient persistence path. Old snapshots without this property remain valid. Reload verification proved that the selected package, READY state, patient, dataset provenance, and Runtime fixture survive restart before START. No Supabase schema or migration was required; local and remote snapshots publish the complete post-install state rather than an intermediate READY state.

## Runtime and replay isolation

The package-bound Runtime fixture is read only from persisted materialization at the existing reference-runtime adapter boundary. ScenarioEngine remains unaware of packages and materialization. Multiple records create isolated engine/runtime-owner instances in stable patient order. Historical replay consumes canonical prepared state and performs no live dataset lookup.

## Pelvic Reference E2E

Android emulator, normal product UI:

1. Catalog showed Pelvic Injury Reference as `SUPPORTED` with `TRAUMA_CORE_V1` and `PELVIC_INJURY_V1` provenance.
2. Activate → Prepare produced READY and exactly one `PT-PELVIC-001` patient.
3. App restart retained READY, package identity, patient, and fixture.
4. START bootstrapped HYPOVENTILATION/HYPOXIA plus the canonical HEMORRHAGE process.
5. Patient Inspector applied the available `PB-1` through the generic resource intervention boundary.
6. Resource runtime showed `PELVIC_BINDER`, reserved `PB-1`, resolved `PELVIC_STABILIZATION`, and 56 ml blood loss after the first minute.
7. A further minute produced 112 ml total: already-lost blood was not restored and future bleeding remained at the configured reduced 56 ml/min rate.
8. Timeline preserved `PT-PELVIC-001` for the resource intervention and subsequent canonical Runtime advance.
9. The disposable exercise completed through normal UI. Debrief reconstructed one patient and five canonical Timeline events with package provenance.
10. No new React Native or Scenario Runtime warning/error was observed.

Physical Android was connected but displayed Login, so package-flow verification was not bypassed and is reported as partial.

## Tests and historical regression

Focused coverage includes one-patient and synthetic two-patient materialization, a 100-patient bounded scale case, permutation invariance, provenance, recursive immutability, restart restoration, exact fixture identity, missing/empty/duplicate/malformed failure, pre-reset atomic failure, preparation idempotency, reset rollback, completed-history capture, and dependency guards.

The full repository suite, Runtime Hardening, Golden/replay baselines, and all Package/Definition/Clinical Module/Analytics/Protocol/Assessment/Metrics/Evaluation stability suites are the regression gate. WP-43's expected replay hash remains `2eb0288fbf8baeb78135cc476266ae3d7d31c0f09cce8fa39848a87b2fb55142`.

## Known limitations

- A physical-device product-flow run requires a normal authenticated session.
- Post-START ClinicalScenarioEngine state is not separately persisted by this work package; WP-43A intentionally changes only pre-START materialization and existing canonical snapshot persistence remains authoritative.
- Zero-patient datasets fail because all currently selectable exercise packages represent patient-bearing exercises. A future non-patient foundation package would require an explicit package contract, not a silent exception.

## WP-44 and WP-45 readiness

WP-44 can register a pleural-injury patient dataset and Runtime fixture without changing preparation or Runtime architecture. WP-45 can register a two-patient dataset; the same atomic plan, canonical ordering, batched install, persistence, and isolated per-patient Runtime-owner path already support 1..N records.
