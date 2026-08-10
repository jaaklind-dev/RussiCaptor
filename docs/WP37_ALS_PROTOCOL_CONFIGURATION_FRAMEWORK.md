# WP-37 – ALS Protocol Configuration Framework

## Architecture Gate

| Gate | Result | Evidence |
|---|---|---|
| ExerciseDefinition extension | SUFFICIENT | Optional immutable `protocolProvenance` follows the existing composition metadata pattern. |
| ExercisePackage extension | SUFFICIENT | Optional exact `protocolConfiguration` reference is resolved by the existing Package loader. |
| Clinical Module composition | SUFFICIENT | Resolved module provenance and the existing ALS capability vocabulary provide load-time capability evidence. |
| Analytics Framework | SUFFICIENT | Protocol-bound Debrief metadata is read-only; historical reports omit it and retain their hashes. |
| Canonical Runtime contract change required | NO | Runtime does not import, resolve, evaluate, or execute protocol configuration. |
| Dependency-direction change required | NO | Package/composition and presentation depend on protocol metadata; Runtime remains independent. |
| ADR required | NO | Architecture v0.7 already freezes Package, Definition, composition, Debrief and Analytics as extension points. |

## Architecture

```text
Exercise Package
  ├─ exact ProtocolReference
  └─ required Clinical Modules
             │
             ▼
     Package Loader / composition
       ├─ exact protocol resolution
       ├─ canonical capability validation
       └─ immutable protocol provenance
             │
             ├──────────────► Exercise Definition / Catalog / ExCon
             └──────────────► Debrief / future assessment

Canonical Runtime  (no dependency on protocol configuration)
```

Clinical Modules define what the simulator can represent. Protocol Configuration describes how those existing capabilities are organized and may later be assessed. It is data, never a second Runtime.

## Model and identity

`ClinicalProtocolConfiguration` uses immutable `protocolId` and exact semantic `version`. Floating identifiers such as `latest`, `current`, or `stable` are not resolved. Metadata includes name, description, authority, optional publication reference, tags and `DRAFT | ACTIVE | DEPRECATED` status.

Registered configurations are recursively frozen. A change requires another explicit version.

## Deterministic protocol hash

`protocolHash` covers semantic configuration content. Capability requirements, tags, rhythm groups, rules, expectations, evidence requirements and medication references use explicit canonical ordering before stable serialization and SHA-256 hashing. The hash excludes its own value.

The optional Package binding is included only in a deliberately protocol-bound Package hash. Packages without the field use the prior hash input exactly, so historical Package and Definition hashes remain unchanged.

## Registry and diagnostics

`ProtocolConfigurationRegistry` supports exact registration, exact lookup, deterministic enumeration and immutable retrieval. Duplicate identity and unknown exact version fail closed.

Validation diagnostics cover:

- invalid identity or hash;
- duplicate rule or expectation IDs;
- unknown capability, rhythm or action reference;
- rhythm/category contradictions;
- invalid temporal constraints;
- malformed medication references;
- missing composed capability;
- unknown Package protocol binding.

There is no fallback or automatic version upgrade.

## Capability requirements

WP-37 reuses the existing `ALS_CAPABILITY_STATUS` identifiers and their canonical source module provenance. Composition resolves capabilities from the exact Clinical Modules in the composed Exercise Definition. Validation happens once while loading/composing the Package and never starts or ticks Runtime.

Provenance records required and resolved capabilities so the result can answer which exact Package supplied which exact protocol and how its requirements were satisfied.

## Rhythm and action references

Rhythm references reuse WP-36 values: `VF`, `PULSELESS_VT`, `PEA`, `ASYSTOLE`, and `PERFUSING`. Grouping may reference `SHOCKABLE`, `NON_SHOCKABLE`, and `PERFUSING`, but validation rejects any contradiction with WP-36 canonical classification.

Actions are declarative references: CPR start/stop, defibrillation, medication administration and airway intervention. Protocol data contains no callback or executable treatment logic.

## Rules, expectations and time

Rules represent a condition and an expected/allowed action with an optional declarative `AFTER`, `BEFORE`, `WITHIN`, or `REPEATING` relation. Timing values belong to a registered configuration, not the framework. No timers or per-tick evaluation were added.

Assessment expectations contain stable identity, condition, expected action, optional temporal constraint, severity and canonical evidence requirements. They produce no PASS/FAIL, score, participant correctness judgement, recommendation or automatic intervention in WP-37.

## Medication references

The model can reference an existing medication identity, configured dose/route text and protocol context. It does not duplicate Medication Engine definitions or add physiology.

## Package binding and provenance

`ExercisePackage.protocolConfiguration` is the sole binding authority. Historical Packages omit it and mean protocol `NONE`. Package loader resolves exactly one configuration after Clinical Module composition, validates capabilities, and places a compact immutable provenance projection in the composed Exercise Definition.

No independent Definition or Runtime selection path exists.

## Reference protocol and package

`ALS_GENERIC_V1@1.0.0` is a deliberately small internal reference, not ERC 2025 or AHA ACLS. It proves exact registration, hash stability, canonical rhythm/action references, rules, expectations and capability validation.

The new `russicaptor.als-protocol-reference@1.0.0` Package binds it through `ALS_V1@1.0.0`. A new Package was chosen instead of modifying historical Cardiac Arrest or ALS reference Package hashes.

## Runtime isolation proof

Production Runtime has no Protocol Configuration import and no protocol-specific branch. Protocol rules are not executed. No protocol-owned cardiac/rhythm state, treatment callback, effect, timer, scoring, or clinical decision was introduced.

```text
Protocol-specific Runtime branches     NONE
Protocol-owned cardiac/rhythm state    NONE
Automatic treatment execution          NONE
Protocol scoring/judgement              NONE
Floating version resolution             NONE
```

## Debrief, Analytics and UI

Catalog detail, Exercise Information, Package Information and Debrief display read-only exact provenance, hash, authority/status and required capabilities. Debrief does not evaluate participant performance.

Historical Debrief objects omit `protocolProvenance`; therefore their serialization and downstream Analytics hashes remain unchanged. A new protocol-bound report contains provenance and may intentionally produce a distinct Analytics hash. No protocol metrics were added.

## Determinism and compatibility

Protocol content and registry enumeration use explicit stable ordering. Compatibility validation fails closed for unknown protocols and missing canonical capabilities. Existing `SUPPORTED | LEGACY | INCOMPATIBLE` Package vocabulary remains authoritative; no parallel compatibility vocabulary was created.

## Test evidence

Automated WP-37 coverage includes immutable model/hash, exact registry resolution, duplicates, unknown versions, canonical rhythm/action validation, capability success/failure without Runtime execution, Package binding/provenance, protocol-free historical behavior, Debrief provenance, and read-only Catalog/ExCon/Debrief presentation.

Protected regression verification covers Runtime Hardening, Golden Replay, WP-36 Cardiac replay, HV/Hypoxia/Hemorrhage/Botulism baselines, Analytics hash stability, historical Package/Definition hashes and architecture readiness.

## Manual verification

The existing canonical exercise remains `RUNNING`. The Catalog may be inspected read-only, but activating/starting a separate disposable protocol exercise is blocked by the known single-active-exercise policy:

`BLOCKED_BY_SINGLE_ACTIVE_EXERCISE_POLICY`

WP-37 does not pause, complete, reset, replace or otherwise modify the existing exercise and does not change that policy.

The current development bundle was verified on both the Android emulator and the connected physical Android device. Each Catalog displayed `12 / 12 packages`; `ALS Generic Protocol Reference Package` was present as `SUPPORTED`, while the historical active Package and `RUNNING` exercise remained unchanged. No new React Native or Scenario Runtime warning/error was observed.

## Known limitations and roadmap

- No ERC, AHA or institutional guideline is included.
- No protocol editor or selection wizard exists.
- No protocol assessment, scoring, participant hint or recommendation exists.
- No parallel disposable exercise exists while the canonical exercise is active.

A future assessment WP can resolve the exact provenance and compare its immutable expectations with authoritative Timeline, Intervention and PatientProcess evidence without changing simulation Runtime.
