# WP-42 — Trauma Clinical Module Foundation

## Objective

WP-42 adds `TRAUMA_CORE_V1@1.0.0` as a foundation-only Clinical Module. It provides immutable trauma context and injury identity, deterministic composition, provenance and a neutral reference package. It does not implement open-book pelvic fracture, pelvic hemorrhage behaviour, hemopneumothorax, pleural dynamics, a trauma protocol, assessment or scoring.

## Architecture gate

| Area | Result | Evidence |
| --- | --- | --- |
| Clinical Module composition | SUFFICIENT | WP-31 registry, dependency resolver, conflict validator and composer are reused unchanged. |
| PatientProcess lifecycle registry | SUFFICIENT | Future injury processes have registered leaf-process extension points; no ScenarioEngine branch is needed. |
| Intervention model | SUFFICIENT | Attempts, instances, resources and effects are already separate. |
| Clinical Effect model | SUFFICIENT | Immutable effects are routed to process handlers; no Runtime write is needed. |
| Hemorrhage | EXTENSION_REQUIRED | Physiology is configurable, deterministic and effect-aware, but production bootstrap assumes primary HV and lifecycle is singleton. |
| Hypoxia | EXTENSION_REQUIRED | Contributor output is reusable, but production bootstrap currently assumes an HV parent. |
| Respiratory Failure | EXTENSION_REQUIRED | Configurable process/effect handler exists; full lifecycle-registry integration for injury activation remains future work. |
| Vital contributors | SUFFICIENT | Independent process outputs are deterministically resolved by the canonical vital/aggregation pipeline. |
| Timeline/evidence | SUFFICIENT | Attempt, effect and process events are factual and assessment-neutral. |
| Protocol / Assessment | SUFFICIENT | WP-37/38 accept future data-driven trauma configuration without Runtime logic. |

Canonical Runtime contract change: **NO**. Replay contract change: **NO**. Lifecycle architecture change: **NO**. Dependency-direction change: **NO**. ADR required: **NO**.

## Trauma capability inventory

| Capability | Status | Notes |
| --- | --- | --- |
| Immutable injury identity/context | IMPLEMENTED | `injuryId`, mechanism, pelvis/thorax, optional laterality and open/closed classification. Descriptive only. |
| Hemorrhage progression | IMPLEMENTED | Rate, cumulative loss, severity/perfusion/compensation, deterministic events. |
| Multiple hemorrhage instances in canonical lifecycle | PARTIAL | Runtime model has instance identity, but production lifecycle declares Hemorrhage `SINGLETON`. |
| Pelvic stabilization effect consumption | IMPLEMENTED | Existing Hemorrhage consumes `PELVIC_STABILIZATION` with configured `binderEfficiency`. |
| Pelvic injury / source model | NOT_IMPLEMENTED | WP-43. |
| Pleural injury / air-blood dynamics | NOT_IMPLEMENTED | WP-44. |
| Hypoxia contribution | IMPLEMENTED | Canonical SpO2 contributor; injury-source activation needs a generic extension. |
| Respiratory failure | IMPLEMENTED | Hypoxaemic, hypercapnic and mixed progression plus support effects; injury activation needs a generic extension. |
| Airway / oxygen / ventilation | IMPLEMENTED | Owned by `AIRWAY_V1`; not duplicated. |
| Vascular access, fluids, blood | IMPLEMENTED | Canonical circulation definitions/effects exist. |
| Cardiac arrest, CPR, defibrillation, ROSC | IMPLEMENTED | Owned by `CARDIAC_ARREST_V1`; trauma automatic arrest is not implemented. |
| Medication lifecycle | IMPLEMENTED | Owned by `MEDICATION_CORE_V1`; no trauma medication fork. |
| Trauma protocol/assessment | NOT_IMPLEMENTED | Reserved for WP-46. |

## Existing intervention inventory

| Domain | Classification | Canonical examples |
| --- | --- | --- |
| Oxygen/airway/ventilation | AVAILABLE_FUNCTIONAL | Oxygen, OPA/NPA, supraglottic airway, ETT, BVM, mechanical ventilation. |
| Access/resuscitation | AVAILABLE_FUNCTIONAL | Peripheral IV, IO, central access, infusion and blood-product effects. |
| External hemorrhage control | AVAILABLE_FUNCTIONAL | Tourniquet and `REDUCE_EXTERNAL_BLEEDING`. |
| Pelvic binder | PARTIAL | Canonical `PELVIC_BINDER_APPLICATION` and `PELVIC_STABILIZATION` exist; no pelvic injury/source model yet. |
| CPR/defibrillation | AVAILABLE_FUNCTIONAL | Factual attempt is separate from resulting rhythm/state transition. |
| Medication | AVAILABLE_FUNCTIONAL | Configuration-driven administration and effects. |
| Chest drain | MISSING | Must be owned by WP-44 with pleural semantics. |
| Pleural decompression | MISSING | Add in WP-44 only if the accepted clinical model requires it. |

An event-only identity is never advertised as therapeutic. Existing intervention attempt remains distinct from clinical effect: binder applied does not mean hemorrhage stopped; future chest drain insertion must not imply full respiratory or bleeding resolution.

## Trauma Core manifest and ownership

`TRAUMA_CORE_V1@1.0.0` has no dependencies. It owns one validation/contract registration, `TRAUMATIC_INJURY_DESCRIPTOR_V1`, and no PatientProcess, intervention, effect, medication, analytics provider, assessment rule or metric provider. Its module and all nested arrays are recursively immutable and its hash uses canonical WP-31 serialization.

Capabilities are exposed as precise read-only status metadata rather than unsupported exercise capabilities:

- `TRAUMA_CONTEXT`, `TRAUMATIC_INJURY`: `FOUNDATION`;
- hemorrhage/respiratory compatibility: `PARTIAL`;
- pelvic hemorrhage and hemopneumothorax: `NOT_IMPLEMENTED`.

Pelvic binder remains owned by the existing core circulation layer. WP-43 must reuse it and supply injury-specific configuration/response. Chest drain and any pleural decompression identity belong to WP-44 because no canonical pleural owner currently exists.

## Reuse audits

### Hemorrhage

The process supports configurable baseline rate, cumulative loss, deterministic time progression, effect-based reduction/stopping/support, severity/perfusion/compensation contributions and factual events. It can coexist with other process types. Pelvic and thoracic source identity is not represented, bootstrap requires an existing primary HV process, and canonical lifecycle permits only one instance. Therefore both `PELVIC_HEMORRHAGE_COMPATIBILITY` and `THORACIC_HEMORRHAGE_COMPATIBILITY` are **EXTENSION_REQUIRED**. WP-43/WP-44 may generalize bootstrap/source identity and sibling ordering through ADR-017 extension points without changing Runtime contracts.

### Hypoxia and Respiratory Failure

Hypoxia owns SpO2 contribution and Respiratory Failure owns configured SpO2/RR/EtCO2/GCS contributors. Their outputs aggregate without trauma branching. A future pleural process may translate factual impairment into their generic activation/effects, but production Hypoxia currently assumes HV parentage and Respiratory Failure is not fully represented in the production lifecycle descriptor list. Both are **EXTENSION_REQUIRED**, not architectural blockers.

### Cardiac Arrest, Airway and ALS

Composition tests prove Trauma Core can coexist with Airway, Respiratory Failure, Medication Core and ALS. ALS resolves Airway, Cardiac Arrest and Medication Core transitively with deterministic deduplication. Duplicate ownership is fatal. No traumatic-arrest trigger, duplicated airway registration or automatic protocol behaviour was added.

## Determinism, process composition and isolation

Tests cover Trauma Core alone and with Airway, Respiratory Failure, Medication Core and ALS, including permutations. The resolved dependency graph, canonical order, Definition and provenance are input-order independent. Missing dependency, wrong version, cycle and registration collision fail closed.

A synthetic existing HV + Hypoxia fixture proves stable bootstrap/tick/aggregation/event/replay output. Two independent patient engines prove patient-scoped process state, different SpO2 results and no cross-patient event leakage. No global trauma state exists. Existing WP-31 100-module performance test remains unchanged.

## Reference package

`russicaptor.trauma-core-reference@1.0.0` is registered in the production catalog. It composes only Trauma Core and explicitly says that it contains no pelvic or pleural injury physiology. It uses no trauma-specific UI and is not the Narva exercise.

## Runtime, Timeline, protocol and downstream isolation

No ScenarioEngine/Runtime trauma branch, ownership rule, replay ordering, protocol rule, assessment rule, analytics provider, score or instructor-evaluation change exists. Timeline remains factual: attempt, completed intervention, effect and process-state evidence are distinct. Correctness, timing and sequence judgement remain in WP-37/38; human interpretation remains in WP-41.

## Future extension contracts

### WP-43 — Pelvic injury

Add a lifecycle-registered pelvic injury/source process or configuration that drives the existing Hemorrhage physiology. Generalize Hemorrhage bootstrap/source multiplicity only through lifecycle extension points. Reuse canonical `PELVIC_BINDER_APPLICATION` → `PELVIC_STABILIZATION`; configure factual bleeding-rate response. Do not register a duplicate binder.

### WP-44 — Pleural injury

Add a lifecycle-registered pleural process producing respiratory impairment and an intrathoracic hemorrhage source. Connect through generic Hypoxia/Respiratory Failure contributor/effect paths. Own new chest-drain identity/effect. Drainage may reduce pleural impairment but must not automatically stop thoracic bleeding unless explicitly configured as a factual effect.

### WP-45 — two-patient reference exercise

Requires WP-43 and WP-44, multi-source Hemorrhage support, generic injury-driven Hypoxia/Respiratory Failure activation and their reference fixtures. It then composes both patients without new Runtime architecture.

### WP-46 — protocol boundary

Recognition, intervention occurrence, timing, sequence and evidence matching belong in data-driven WP-37/38 configuration. Trauma Core contains no ATLS/ABCDE logic.

## Known limitations

- Hemorrhage production lifecycle is singleton and HV-coupled.
- Hypoxia production bootstrap is HV-coupled.
- Respiratory Failure injury activation needs a lifecycle-compatible generic path.
- No pelvic/thoracic injury physiology, chest-drain effect, trauma protocol, analytics or final exercise exists.
- The reference package validates composition, not clinical treatment.

## Verification record

Automated verification covers module immutability/hash semantics, production registration, reference provenance, composition matrix, permutation determinism, fail-closed conflicts, multi-process determinism and multi-patient isolation. Full TypeScript, ESLint, test, Runtime Hardening, Golden replay and historical hash results are recorded in the completion report. Android results are recorded only after a fresh build and catalog inspection.

The Android emulator loaded a cache-cleared Metro bundle and displayed 13 catalog packages. Search returned exactly one `Trauma Core Reference Package`, marked `TRAUMA · v1.0.0`, `SUPPORTED` and tagged `foundation`. Its detail view showed required and composed `TRAUMA_CORE_V1@1.0.0`, composition order 0, package hash `9001d04a39d4f9a4b74a65644464385dd01baa6f2865e497c7dad0fc623457f9` and Definition hash `f7d139b3044d6b220bbee19225cc1e961840eb415ef1090874bad9b97f939fe4`. No exercise or Runtime state was mutated.

The physical Android connected to the same fresh Metro bundle and opened the application without new React Native errors or warnings. It remained at Login under its separate signed-out principal, so catalog inspection was not repeated and the physical result is `PARTIAL`; no authorization bypass was used.
