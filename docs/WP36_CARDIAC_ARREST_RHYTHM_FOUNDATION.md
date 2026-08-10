# WP-36 — Cardiac Arrest & Rhythm Foundation

## Status

**BLOCKED PENDING ADR-017 ZERO-BEHAVIOUR MIGRATION — IMPLEMENTATION NOT STARTED**

WP-36 was stopped before implementation code was changed. Revised ADR-017 is
accepted for a separate zero-new-functionality lifecycle-registry migration,
but WP-36 remains blocked until that migration demonstrates byte-identical
canonical behaviour, ordering and replay hashes and becomes sole production
authority.

## Architecture Gate

```text
ARCHITECTURE GATE

PatientProcess extension: SUFFICIENT
Contributor model: SUFFICIENT
Clinical Effect model: SUFFICIENT
Intervention model: SUFFICIENT
Canonical Runtime contract change required: YES
Dependency-direction change required: NO
ADR required: YES
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

The canonical production orchestration is not currently an open PatientProcess
extension point:

- `ClinicalScenarioEngine` stores dedicated process fields and bootstraps/ticks
  each supported disease process explicitly;
- its aggregation list, process-tree hash, snapshot publication and replay hash
  are assembled from those explicit fields;
- `ClinicalProcessRuntime` is a closed union of the currently integrated
  process runtime types;
- `ClinicalProcessRegistry` routes Clinical Effects, but does not own generic
  PatientProcess bootstrap, tick, state persistence or replay participation.

Adding cardiac-arrest-specific fields and branches to `ClinicalScenarioEngine`
would violate the WP-36 prohibition on disease-specific Runtime branching.
Introducing a generic lifecycle registry would change the frozen canonical
Scenario Runtime and replay orchestration contract. Architecture v0.7 therefore
requires an ADR before that change.

## Stop-condition decision

No cardiac state, rhythm model, CPR effect, defibrillation definition, ROSC
transition, Clinical Module, ALS dependency, reference package, historical hash
or runtime test was changed. Implementing only an isolated process would create
the appearance of canonical support without making the capability executable by
the production Runtime, so it was deliberately not done.

The revised and accepted migration decision is documented in
[`ADR-017`](./ADR-017_PATIENT_PROCESS_LIFECYCLE_REGISTRY.md).

## WP-36 continuation after ADR acceptance

After all ADR-017 migration stages pass exact parity and its lifecycle boundary
is the sole canonical production authority, WP-36 may continue through that
boundary:

1. add the typed Cardiac Arrest PatientProcess and validated deterministic
   configuration;
2. add CPR and defibrillation Intervention definitions and Clinical Effects;
3. add the Cardiac Arrest ClinicalProcess handler;
4. register `CARDIAC_ARREST_V1@1.0.0` and compose it into `ALS_V1`;
5. add the reference package, factual Timeline evidence, replay fixture and
   regressions;
6. mark ALS capabilities available only after the production canonical path is
   proven end to end.

No ERC, AHA, medication-dose, scoring or automated-treatment logic belongs in
that continuation.
