# WP-34 — Medication Core Clinical Module

## Status

Implemented as a production Clinical Module under
[`ADR-016`](./ADR-016_CLINICAL_MODULE_COMPOSITION.md) and frozen Architecture
v0.7. `MEDICATION_CORE_V1@1.0.0` packages the existing configuration-driven
Medication Engine lifecycle without changing Runtime or medication semantics.

## Identity and dependency policy

- module: `MEDICATION_CORE_V1`;
- version: `1.0.0`;
- dependencies: none;
- composition compatibility version: `1`.

Medication Core deliberately has no Airway, Respiratory Failure, ALS or Trauma
dependency. Future domain modules may depend on Medication Core using an exact
version.

## Existing registrations

The module contributes the existing `MEDICATION` framework selection and the
four production medication assessment-hook identifiers:

- `MED-ADMIN`;
- `MED-CANCEL`;
- `MED-DUP`;
- `MED-REJECT`.

The existing lifecycle remains owned by `MedicationEngine`:

- definition installation and validation;
- ordering and administration;
- active, completed and cancelled instances;
- duplicate, route and vascular-access rejection;
- immutable snapshot projection;
- abstract Clinical Effect creation;
- deterministic medication events.

## Definition and effect ownership

The production repository currently contains no general Medication Runtime
definitions. `MedicationEngine.installDefinitions()` receives immutable exercise
configuration. The two existing demo `MedicationOption` values are patient-bound
UI dataset records, not canonical `MedicationDefinition` objects, and therefore
cannot be placed in a reusable Clinical Module under ADR-016.

Consequently Medication Core declares no drug definition or Clinical Effect ID.
This is intentional: adding placeholder drugs, doses, routes or effects would be
new clinical content forbidden by WP-34. A configured Medication Definition owns
its selected existing abstract effect at exercise composition time.

`core.interventions` contains an existing medication-count metric, but it is a
shared provider already contributed by AIRWAY_V1 in module-enabled compositions.
Medication Core does not duplicate that provider or depend on Airway. Historical
module-free Definitions retain the provider directly as before.

## Canonical data flow

```text
configured MedicationDefinition
        ↓
existing MedicationEngine lifecycle
        ↓
existing abstract Clinical Effect
        ↓
existing Clinical Effect / PatientProcess path
        ↓
canonical contributors and Runtime
```

The module introduces no direct RuntimeState, VitalSignState or PatientProcess
write and no module-specific execution branch.

## Reference Package and provenance

`russicaptor.medication-core-reference@1.0.0` directly requires
`MEDICATION_CORE_V1@1.0.0`. Its base Definition omits `MEDICATION`; composition
contributes the existing framework selection back. The published Definition has
the same Runtime-facing selections as the unchanged demo Definition and records:

```text
MEDICATION_CORE_V1@1.0.0 · order 0
```

Catalog, Dashboard and Debrief use the existing read-only provenance cards.

## Conflict policy

The WP-31 fail-closed policy remains unchanged. Duplicate medication definition,
Clinical Effect, provider, module or process IDs are fatal. Exact version lookup
does not upgrade automatically, and dependency cycles produce no partial
Definition.

## Runtime equivalence

The module imports no Runtime implementation and creates no second Medication
Engine. Dedicated tests compose the module and run the existing configured
administration, effect, event and cancellation lifecycle twice, verifying an
identical snapshot and replay hash. The existing WP-15 ScenarioEngine test
continues to verify deterministic RuntimeState integration, medication state,
assessment, event log and ScenarioEngine replay hashes.

## Future use

Future ALS and Trauma modules may depend on `MEDICATION_CORE_V1@1.0.0` and
contribute separately governed drug definitions. Medication Core remains a
framework module and does not become a monolithic medication protocol.

## Limitations

- no new medication definition, dose, unit, route or pharmacology;
- no new effect, intervention, Analytics provider or metric;
- no Runtime, Replay, Debrief or Analytics framework change;
- no dynamic loading or implicit version negotiation;
- no patient-bound data in the module.

## Verification

Dedicated tests cover manifest immutability, dependency policy, production
registry lookup, exact framework and assessment registration, deterministic
composition and provenance, wrong versions, duplicate ownership and registration
conflicts, configured lifecycle/replay equivalence, historical hashes, Analytics
stability and composition performance.

Release verification requires the full Jest suite, TypeScript, ESLint,
`git diff --check`, Runtime Hardening, Golden Replay, Medication Framework,
WP-32/WP-33 regressions, Android verification and the GitHub Node 20/22/24/26
matrix.
