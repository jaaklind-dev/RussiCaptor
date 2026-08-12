# WP-43 — Pelvic Hemorrhage / Open-Book Injury

## Status

Implementation candidate. This module is a deterministic reference model, not a clinical guideline or treatment recommendation.

## Architecture gate

| Question | Result |
| --- | --- |
| Existing generic Hemorrhage bootstrap supports named concurrent sources | Extension required and implemented generically |
| Existing Hemorrhage process supports pelvic stabilization | Sufficient |
| Existing binder intervention and `PELVIC_STABILIZATION` effect | Sufficient; reused unchanged |
| Existing contributor and Vital Sign Engine path | Sufficient |
| Existing lifecycle registry and aggregation | Sufficient |
| New ScenarioEngine branch or runtime layer | Not required |
| ADR required | No; existing extension points are used |

## Module contract

`PELVIC_INJURY_V1@1.0.0` depends on `TRAUMA_CORE_V1@1.0.0`. It contributes an immutable open-book injury descriptor and reference configuration. It does not claim ownership of a new PatientProcess, intervention, clinical effect, runtime field, assessment engine, or analytics provider.

The descriptor records:

- injury type `OPEN_BOOK_PELVIC_INJURY`;
- mechanism `FALL_FROM_HEIGHT`;
- anatomic region `PELVIS`;
- closed wound classification;
- exact module/version provenance.

## Runtime flow

```text
Pelvic reference configuration
        ↓
HEMORRHAGE PatientProcess (named source)
        ↓
PatientVitalContributor
        ↓
Vital Sign Engine
        ↓
Runtime aggregation and immutable snapshot
```

The binder continues through the existing path:

```text
PELVIC_BINDER_APPLICATION
        ↓
PELVIC_STABILIZATION ClinicalEffect
        ↓
HEMORRHAGE source filter
        ↓
Configured bleeding-rate reduction
```

No intervention writes physiology directly. The reference model accumulates blood loss monotonically. Applying a binder reduces future bleeding rate and never restores blood already lost.

## Generic Hemorrhage extension

The lifecycle registry accepts an optional `hemorrhageSources` collection. Sources are deterministically ordered by `processId`; each has its own `processId`, `instanceKey`, `sourceId`, state, elapsed time, output, and next tick. Existing single-source fixtures keep their prior bootstrap path and output contract.

An optional configured vital response translates cumulative loss into explicit delta contributors for HR, systolic pressure, diastolic pressure, and CRT. Legacy configurations without this block continue to emit no vital contributors, preserving existing replay behavior.

`PELVIC_STABILIZATION` is accepted by pelvic sources. A targeted effect with `parameters.sourceId` is accepted only by the matching source. This prevents a binder from silently controlling an unrelated external bleeding source.

## Reference configuration

All progression values live in `PelvicInjuryReference.ts`; there are no pelvic thresholds in ScenarioEngine. The values exist to provide a stable deterministic validation scenario and must not be interpreted as universal clinical constants.

The same file publishes the immutable single-patient reference dataset descriptor `PT-PELVIC-001`. The package points to `patients.pelvic-injury-reference.v1`. Current Exercise Preparation binds package provenance but does not yet materialize package-specific patient datasets into the application repository; therefore the engine-level reference patient is complete while the full prepare-to-patient product flow remains a documented integration boundary.

## Fluids and blood products

Classification: **PARTIAL**. Existing canonical circulation interventions create `INFUSION_RUNNING` and `BLOOD_PRODUCT_STARTED`, and Hemorrhage can consume configured offsets. This is deliberately not a detailed volume, transfusion, blood-bank, compatibility, or massive-transfusion model. WP-43 does not expand it.

## Visibility and evidence

The CM path reuses the existing intervention catalogue and receives no process configuration or treatment hint. ExCon can use existing generic runtime/process debug projections. Canonical events distinguish `InterventionApplied`, `PelvicBinderApplied`, and `HemorrhageReduced`; the latter is attributed to the named Hemorrhage process. These factual events are suitable for Timeline, Debrief, and later assessment evidence without introducing trauma-specific judgement.

## Determinism and isolation

Automated coverage verifies module and package hashes, dependency composition, root and registry permutation invariance, progressive loss, binder response, repeated-effect idempotency, multiple-source isolation, full ScenarioEngine replay equality, event equality, Runtime equality, PatientProcess equality, and replay hash equality.

The independent WP-43 replay hash is:

```text
2eb0288fbf8baeb78135cc476266ae3d7d31c0f09cce8fa39848a87b2fb55142
```

The historical single-source bootstrap retains its former process identity, instance key, serialization, empty vital-contribution behavior, and legacy event attribution. Named sources activate the new identity and contributor fields only when explicitly configured.

## Android verification

- Emulator: the current development bundle opened normally; Exercise Catalog displayed 14 packages and filtered to one `Pelvic Injury Reference Package`, status `SUPPORTED`, profile `TRAUMA`, version `1.0.0`.
- Physical Android: the current development build and Metro bundle opened normally and reached the login screen.
- Full prepare/start/patient/binder flow: partial. The active exercise was already completed, but package-specific dataset materialization is not currently implemented by the supported Exercise Preparation service. The persisted exercise/package state was therefore not changed merely to simulate an unsupported patient-loading path.
- No new React Native or Scenario Runtime warning/error was observed during the checked path.

## Known boundaries

- This is the first pelvic injury model, not a general injury ontology.
- No new fluid, transfusion, medication, assessment, or protocol rules are introduced.
- No UI-specific physiology or calculation is introduced.
- Existing timeline and debrief projections consume canonical events without special pelvic mutation paths.
- Binder removal is not expanded by WP-43.
- Product-level materialization of `patients.pelvic-injury-reference.v1` remains necessary before the reference package can create its patient through the normal UI lifecycle.

## Readiness

The clinical foundation is reusable by WP-44 and a future WP-45 composition. WP-45 product E2E remains blocked until exercise-package patient dataset materialization is connected through the existing Exercise Definition/Package extension point; no Runtime workaround should be introduced for that work.
