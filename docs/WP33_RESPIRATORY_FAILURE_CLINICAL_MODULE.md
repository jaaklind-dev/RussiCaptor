# WP-33 — Respiratory Failure Clinical Module

## Status

Implemented as the second production Clinical Module under
[`ADR-016`](./ADR-016_CLINICAL_MODULE_COMPOSITION.md). The implementation
packages the existing WP-17 Respiratory Failure process without changing its
physiology, contributor pathway, Runtime integration or replay behaviour.

## Identity and dependency

- module: `RESPIRATORY_FAILURE_V1`;
- version: `1.0.0`;
- exact dependency: `AIRWAY_V1@1.0.0`;
- composition compatibility version: `1`.

The dependency is mandatory and transitive from an Exercise Package requesting
only Respiratory Failure:

```text
RESPIRATORY_FAILURE_V1@1.0.0
        ↓ requires
AIRWAY_V1@1.0.0
        ↓ dependency-first composition
AIRWAY_V1 order 0 → RESPIRATORY_FAILURE_V1 order 1
```

A missing Airway module produces `MISSING_DEPENDENCY`. If another Airway version
is registered but `1.0.0` is unavailable, composition produces
`VERSION_MISMATCH`. Both are fatal and produce no partial Definition.

## Existing registrations

The module contributes the existing `RESPIRATORY_FAILURE` PatientProcess. It
exposes the existing configured `HYPOXAEMIC`, `HYPERCAPNIC` and `MIXED`
phenotypes; no phenotype or threshold logic is copied into the module.

The process continues to emit only canonical SpO₂, respiratory-rate, EtCO₂ and
GCS contributors. AVPU remains derived by the Vital Sign Engine.

Airway owns the shared support registrations:

- `INSPIRED_OXYGEN_INCREASED`;
- `UPPER_AIRWAY_PATENCY`;
- `AIRWAY_PROTECTED`;
- `EFFECTIVE_VENTILATION`;
- airway interventions;
- `core.interventions` Analytics and Metric provider bindings.

Respiratory Failure contributes only its additional existing
`INSPIRED_OXYGEN_REMOVED` effect. This split preserves one registration owner
and avoids conflicts. No new provider is created.

## Reference Package

`russicaptor.respiratory-failure-reference@1.0.0` directly requires only
`RESPIRATORY_FAILURE_V1@1.0.0`; Airway resolves from the manifest dependency.
Its base Definition omits registrations contributed by the two modules. After
composition, the published Definition has the same Runtime-facing process,
Analytics-provider and Metric-provider selections as the unchanged demo
Definition, plus deterministic provenance for both modules.

All six historical module-free Packages and the WP-32 Airway reference Package
remain unchanged. Historical Package and Definition hashes are not migrated.

## Runtime equivalence

Runtime remains unaware of modules and receives one composed canonical Exercise
Definition. The production module imports no Runtime implementation and creates
no alternative Respiratory Failure process. Existing WP-17 tests remain the
authority for:

- hypoxaemic, hypercapnic and mixed progression;
- SpO₂, RR, EtCO₂ and GCS contributors;
- derived AVPU;
- oxygen response;
- BVM and mechanical-ventilation response;
- configured recovery;
- deterministic long replay.

WP-33 adds module-level regression runs across all three phenotypes and verifies
that repeated supported progression is identical.

## Provenance and read-only presentation

Catalog, Dashboard and Debrief reuse the existing read-only provenance cards.
The reference Package displays Respiratory Failure as its direct requirement and
Airway followed by Respiratory Failure as the resolved composition.

## Limitations

- no new Respiratory Failure or Airway algorithm;
- no new intervention, medication, provider or Assessment Rule;
- no dynamic loading or version negotiation;
- no Runtime, Replay, Timeline, Debrief or Analytics framework change;
- no module-specific execution branch.

## Verification

Dedicated tests cover immutable manifest data, exact dependency semantics,
production registry lookup, registration ownership, transitive order independent
of registry insertion, missing and wrong dependency versions, duplicate-process
conflict rejection, deterministic Definition hashing, reference Package
publication, unchanged Runtime-facing selections and historical hashes,
three-phenotype clinical regression, Analytics stability and composition
performance.

Release verification requires the full Jest suite, TypeScript, ESLint,
`git diff --check`, Runtime Hardening, Golden Replay, Analytics hash stability,
WP-17/WP-32 regressions, Android verification and the GitHub Node 20/22/24/26
matrix.
