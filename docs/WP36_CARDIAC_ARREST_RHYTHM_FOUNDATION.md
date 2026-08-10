# WP-36 — Cardiac Arrest & Rhythm Foundation

## Status

**IMPLEMENTED — ADR-017 LIFECYCLE REGISTRY PATH**

Architecture history: **Initial Gate BLOCKED → ADR-017 ACCEPTED → WP-36A
COMPLETE → WP-36 RESUMED and IMPLEMENTED**.

WP-36 resumed after WP-36A established the lifecycle registry as the sole
production orchestration authority and protected the previous process families
with exact replay/hash baselines.

## Architecture Gate

```text
ARCHITECTURE GATE

PatientProcess extension: SUFFICIENT
Contributor model: SUFFICIENT
Clinical Effect model: SUFFICIENT
Intervention model: SUFFICIENT
Canonical Runtime contract change required: NO
Dependency-direction change required: NO
ADR required: NO (implemented under accepted ADR-017)
```

### Evidence

The following frozen extension points are sufficient in isolation:

- a typed `CardiacArrestPatientProcessRuntime` can own cardiac state, rhythm,
  CPR state, configured transitions and immutable `ProcessOutput`;
- `ProcessOutput.vitalContributions` can provide deterministic perfusion and
  consciousness-related targets through `PatientVitalContributor`,
  `VitalSignRuntimeResolver` and `VitalSignEngine`;
- `ClinicalEffectType`, `ClinicalEffect`, `ClinicalProcessHandler` and
  `ClinicalIntegrationFramework` can carry CPR and defibrillation effects to a
  PatientProcess without direct vital writes;
- `InterventionDefinition`, `InterventionRuntime` and the existing resource
  intervention path support continuous CPR and auditable fixed-duration shock
  attempts with deterministic idempotency.

The canonical production orchestration is now an open PatientProcess extension
point:

- `CARDIAC_ARREST` is bootstrapped and ticked by a production lifecycle
  descriptor with explicit stable ordering slots;
- snapshot, aggregation, process-tree and replay participation use the existing
  registry-owned lifecycle store;
- Clinical Effects are routed by `ClinicalProcessRegistry` through a dedicated
  process handler;
- ScenarioEngine contains no cardiac-arrest process-type branch.

No additional Runtime layer or dependency direction was introduced.

## Implemented clinical boundary

- Canonical state: `PERFUSING`, `ARREST`, `ROSC`.
- Canonical rhythms: `VF`, `PULSELESS_VT`, `PEA`, `ASYSTOLE`, `PERFUSING`.
- CPR produces configured partial-perfusion contributors only.
- A defibrillation attempt is always factual evidence; rhythm conversion occurs
  only for a shockable rhythm with a matching configured transition.
- ROSC is explicit and does not resolve the patient or normalize every vital.
- Time- and shock-triggered transitions are validated, ordered and replay-safe.
- Malformed, duplicate and ambiguous configuration fails closed with typed
  diagnostics.

The revised and accepted migration decision is documented in
[`ADR-017`](./ADR-017_PATIENT_PROCESS_LIFECYCLE_REGISTRY.md).

## Runtime data flow

```text
InterventionRuntime
  -> immutable ClinicalEffect
  -> CardiacArrest PatientProcess
  -> PatientVitalContributor
  -> VitalSignRuntimeResolver
  -> VitalSignEngine
  -> RuntimeAggregationPipeline
  -> Runtime Snapshot / Timeline / Replay
```

`CARDIAC_ARREST_V1@1.0.0` has no unnecessary module dependencies. `ALS_V1`
depends explicitly on it and publishes cardiac arrest, rhythm, CPR,
defibrillation and ROSC as available canonical capabilities.

The supported Cardiac Arrest Reference Package is registered as
`russicaptor.cardiac-arrest-reference@1.0.0`. Its new, intentionally added
Golden replay hash is
`e0edb913c2c0e8df32156f8e7efe5e727bc78dcfb018668f44437249011e5751`.
The intentional new canonical hashes are:

- Cardiac module: `c10a43f8872e8fefbf17199deee0912f0be815638af94aa3ca20ac922e91f640`;
- Cardiac reference Definition: `737cb8aea68a300a80a4434c8711de85ebde9eb95a230c266854910599d860f3`;
- Cardiac reference Package: `e5b1c0316a203ac9156f0e190676e794cd5c36d5cc1ee5f1095c2340ecbbffb2`;
- updated ALS module: `dc64806aec39f25307549a09e9e2dcb4fdbbb04b4ef942fba97448b0976365b2`;
- updated ALS Definition: `de253926a8b4f823140826f4915c367eb142c27a07482c40c0ce8504347078d7`;
- updated ALS Package: `793a638154cfcf42d92d8910f2fe9e8f71d91c3ed059f4ce6279cd25a7dc7f2f`.

All four protected WP-36A lifecycle baseline tests remain byte-identical, as do
the pre-existing default Package and Definition hashes and Analytics stability
tests.

## Deliberately not implemented

No ERC/AHA protocol, CPR quality scoring, medication-specific arrest effect,
automated treatment decision or complete post-ROSC physiology is included.

## Android verification

The current Expo SDK 57 development build compiled successfully and was
installed and bundled on physical Android device `AGS_L03`. The app launched
without new React Native warnings or errors. Reinstalling the development build
cleared the prior authenticated session, so the signed-in Exercise Catalog,
runtime controls, Timeline and Debrief could not be exercised manually in this
run. Their canonical package, runtime, event and replay paths are covered by
automated tests; signed-in UI verification remains required before release.
