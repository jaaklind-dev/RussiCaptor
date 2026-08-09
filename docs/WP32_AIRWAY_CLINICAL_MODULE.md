# WP-32 — Airway Clinical Module

## Status

Implemented as the first production Clinical Module under
[`ADR-016`](./ADR-016_CLINICAL_MODULE_COMPOSITION.md). `AIRWAY_V1@1.0.0`
packages existing airway declarations without adding or changing airway,
Runtime, Replay, Analytics or assessment algorithms.

## Module contract

`AIRWAY_V1` is immutable, deterministically hashed and has no v1 dependencies.
It registers identifiers through the WP-31 composition boundary only. Runtime
does not import, query or branch on the module.

```text
Airway reference Exercise Package
        ↓ AIRWAY_V1@1.0.0
ClinicalModuleRegistry
        ↓
ClinicalModuleComposer
        ↓
one canonical Exercise Definition + provenance
        ↓
existing ExercisePackageLoader
        ↓
unchanged Runtime
```

## Existing registrations

The module declares the existing airway intervention definitions:

- oxygen therapy;
- oropharyngeal and nasopharyngeal airways;
- i-gel and LMA supraglottic airways;
- bag-valve-mask ventilation;
- endotracheal intubation;
- mechanical ventilation.

It declares their existing Clinical Effect identifiers:

- `INSPIRED_OXYGEN_INCREASED`;
- `UPPER_AIRWAY_PATENCY`;
- `AIRWAY_PROTECTED`;
- `EFFECTIVE_VENTILATION`.

The existing `core.interventions` Analytics and Metric provider is contributed
by the module. The module does not claim a PatientProcess or Assessment Rule,
because no dedicated production airway implementation exists for either
extension point. It introduces no placeholder or duplicate implementation.

## Reference Package and composition

`russicaptor.airway-reference@1.0.0` declares an exact dependency on
`AIRWAY_V1@1.0.0`. Its base Definition omits `core.interventions`; deterministic
composition contributes that existing provider back. The published Definition
therefore has the same Runtime-facing process, provider, metric and capability
selections as the existing demo Definition, plus immutable module provenance.

All six pre-existing canonical Packages remain module-free. Their Package and
Definition hashes and loading path are unchanged.

## Provenance and presentation

The composed Definition records module ID, exact version, deterministic module
hash and composition order. Existing Catalog, Dashboard and Debrief information
cards render required and composed module provenance read-only. These views do
not resolve or activate modules.

## Architecture compliance

- no new airway or disease algorithm;
- no new PatientProcess;
- no Runtime, Replay, Timeline, Debrief or Analytics framework change;
- no dynamic loading or mutable module state;
- no direct Runtime registration;
- one Package and one composed canonical Definition remain authoritative;
- Architecture v0.7 and ADR-016 remain intact.

## Verification

Dedicated tests cover manifest immutability, registry lookup, exact registration
mapping to existing airway definitions, deterministic composition, Package
loading, provenance, unchanged Runtime-facing selections, legacy Package and
Definition hashes, and unchanged Analytics output. Existing Airway Management,
Golden Replay and Runtime Hardening tests continue to verify airway lifecycle and
replay determinism without any WP-32-specific Runtime path.

Release verification requires the full Jest suite, TypeScript, ESLint,
`git diff --check`, Runtime Hardening, Golden Replay, Analytics hash stability,
Android verification and the GitHub Node 20/22/24/26 matrix.
