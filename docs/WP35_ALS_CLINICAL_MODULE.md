# WP-35 — ALS Clinical Module

## Implementation report

`ALS_V1@1.0.0` is a production composition module under ADR-016 and Architecture v0.7. It introduces no ALS runtime, protocol, medication dose, rhythm, defibrillation or physiology algorithm. Runtime receives only the composed canonical Exercise Definition and remains module-unaware.

## Identity and exact dependencies

```text
ALS_V1@1.0.0
├── AIRWAY_V1@1.0.0
└── MEDICATION_CORE_V1@1.0.0
```

The canonical resolver produces stable order `AIRWAY_V1`, `MEDICATION_CORE_V1`, `ALS_V1`, independently of registry insertion order. Missing dependencies and exact-version mismatches fail closed.

## Ownership and registered capability

ALS owns no registrations in version 1.0.0. Airway interventions, Clinical Effects and `core.interventions` remain owned by `AIRWAY_V1`; the medication PatientProcess and assessment hooks remain owned by `MEDICATION_CORE_V1`. Generic vascular access remains a Core Runtime capability. This prevents duplicate ownership while composing existing capability.

Available capability includes oxygen therapy, BVM ventilation, supraglottic airway, endotracheal intubation, mechanical ventilation, generic configuration-driven medication administration and vascular access. Capability metadata is immutable and descriptive only; it is not a Runtime source of truth.

## Cardiac arrest and rhythm audit

| Capability | Finding | Reason |
|---|---|---|
| Cardiac arrest | `NOT_IMPLEMENTED` | No canonical PatientProcess or runtime state machine exists. |
| Shockable/non-shockable rhythm | `NOT_IMPLEMENTED` | No canonical rhythm model exists. |
| CPR | `PARTIAL` | A workflow/Excel activity type exists, but no canonical physiology, Clinical Effect or PatientProcess exists. |
| Defibrillation | `PARTIAL` | A workflow/Excel activity type exists, but no canonical intervention effect or rhythm transition exists. |
| ROSC | `NOT_IMPLEMENTED` | No canonical ROSC transition exists. |

The ALS Reference package is therefore explicitly marked as reduced-capability. Unsupported actions are not registered or presented as working clinical runtime functionality.

## Protocol independence

`ALS_V1` is a capability composition, not ERC, AHA or local-hospital protocol content. Drug definitions, doses, timing and future protocol rules belong to separate configuration/protocol packages.

## Reference package and provenance

The `ALS Reference` Exercise Package requires only `ALS_V1@1.0.0`; Airway and Medication Core resolve transitively. Published provenance records all three exact module versions and module hashes. Runtime-facing process, analytics and metric selections remain equivalent to the existing canonical definition.

## Equivalence, replay and performance

Automated tests verify unchanged Airway definitions and Medication Engine lifecycle, stable event ordering, identical composition/provenance/content hashes across repeated runs, registration-order independence, historical Package/Definition hashes, unchanged Analytics output and 100 repeated compositions within the existing 1500 ms module-test budget.

## Future extension points

Future modules may add canonical cardiac-arrest PatientProcesses, rhythm state, CPR effects, defibrillation interventions and ROSC transitions. They must be introduced through ADR-016 extension points and exact dependencies; they must not be simulated inside ALS metadata or by Runtime branches on module presence.
