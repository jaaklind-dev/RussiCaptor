# WP-44 — Pleural Injury / Massive Hemopneumothorax

## Status

Implemented as a clinical foundation on Architecture v0.7 extension points. This package is a deterministic reference capability, not a treatment protocol or guideline.

## Architecture Gate

| Area | Result | Decision |
|---|---|---|
| Pleural injury PatientProcess | NOT_IMPLEMENTED | Added one lifecycle-registry leaf process. |
| Hemorrhage | SUFFICIENT | Reused unchanged with a named `THORACIC_1` source. |
| Hypoxia | EXTENSION_REQUIRED | Allowed bootstrap under a respiratory/pleural parent and accepted a generic impairment multiplier. |
| Respiratory Failure | EXTENSION_REQUIRED | Registered the existing process in the production lifecycle and accepted a generic impairment multiplier. |
| Contributor and aggregation pipeline | SUFFICIENT | Reused unchanged; the pleural process emits no vital contributor. |
| Chest drain intervention/effect | NOT_IMPLEMENTED | Added `CHEST_DRAIN_INSERTION` and immutable `PLEURAL_DRAINAGE`. |
| Lifecycle registry | SUFFICIENT | Reused ADR-017; no ScenarioEngine clinical branch was added. |
| Package materialization | SUFFICIENT | Reused the WP-43A dataset and fixture path. |
| Timeline, Debrief and replay evidence | SUFFICIENT | Reused canonical runtime event recording. |

No new runtime layer, reverse dependency, canonical Runtime mutation path, replay mechanism, or ADR was required.

## Clinical composition

```text
MASSIVE_HEMOPNEUMOTHORAX
        ├── Pleural Injury PatientProcess
        │       ├── pleural air burden
        │       ├── pleural blood burden
        │       └── generic respiratory impairment
        ├── Respiratory Failure PatientProcess
        │       └── RR / EtCO₂ / fatigue / work of breathing contributors
        ├── Hypoxia PatientProcess
        │       └── canonical SpO₂ contributor
        └── Hemorrhage PatientProcess (sourceType=THORACIC)
                └── blood-loss and perfusion contributors
```

The pleural process never writes a vital. It exposes a deterministic, dimensionless respiratory impairment contribution which the existing Respiratory Failure and Hypoxia processes consume during their own ticks. This preserves the canonical `PatientProcess → Contributor → Vital Sign Engine → Aggregation` flow.

## Canonical ownership

- Pleural air burden, pleural blood burden, drainage state and respiratory impairment are owned by `PLEURAL_INJURY_V1`.
- Systemic cumulative blood loss and bleeding rate remain owned by `HEMORRHAGE_V1`.
- SpO₂ remains owned by `HYPOXIA_V1` in the reference composition.
- Respiratory rate and EtCO₂ are contributed by `RESPIRATORY_FAILURE_V1`.
- Chest drainage does not change the thoracic hemorrhage source, reverse cumulative systemic blood loss, or restore circulating volume.

## Chest drain semantics

`CHEST_DRAIN_INSERTION` reserves a `chestDrain` resource and produces `PLEURAL_DRAINAGE`. The pleural process consumes the immutable effect idempotently. Drainage:

- reduces existing pleural air and pleural blood burdens;
- reduces future pleural-air accumulation;
- therefore lowers future respiratory impairment;
- does not stop the separate `THORACIC_1` hemorrhage process;
- does not retroactively correct cumulative blood loss.

## Reference package

- Clinical Module: `PLEURAL_INJURY_V1@1.0.0`
- Package: `russicaptor.pleural-injury-reference@1.0.0`
- Dataset: `patients.pleural-injury-reference.v1`
- Patient: `PT-PLEURAL-001`
- Injury: `MASSIVE_HEMOPNEUMOTHORAX`
- Resource: `CD-1` (`chestDrain`)

Package activation and patient materialization use the existing WP-43A normal product path. Persistence and rehydration of a live pleural runtime are intentionally deferred to WP-44A.

## Test coverage

Automated coverage includes immutable module/package composition, deterministic dependency order, independent pleural air and blood progression, idempotent drainage, lifecycle registration, Hypoxia and Respiratory Failure coupling, named thoracic hemorrhage, chest-drain isolation from hemorrhage, patient isolation, deterministic replay and the absence of pleural conditionals in `ScenarioEngine`.

The canonical WP-44 replay hash is `44f3b5238b60f27418da1c764a70a34ef0f386a51a459ac59cf2f7d7e282bb19`. The pelvic reference remains fixed at `2eb0288fbf8baeb78135cc476266ae3d7d31c0f09cce8fa39848a87b2fb55142`.

## Practical verification

Android emulator full E2E passed through the supported product flow: catalog selection, package activation, exercise preparation, start, patient Inspector, 60-second deterioration, chest-drain application, Timeline, completion and Debrief. Inspector showed `PLEURAL_INJURY`, `RESPIRATORY_FAILURE`, `HYPOXIA` and `HEMORRHAGE`; after drainage the pleural process was `Controlled` while hemorrhage remained `Active`. No new React Native or Scenario Runtime warning/error was observed.

The connected physical Android was available for a read-only catalog check, but it retained an older JavaScript bundle which did not yet contain the new package. It was not mutated or used as an acceptance gate; physical verification is therefore partial. Emulator full E2E is the primary WP-44 acceptance gate.

Timeline and Debrief reconstruct the canonical exercise start, clinical-runtime advance and resource-intervention sequence. New chest-drain commands use the factual `Chest drain inserted` / `Canonical pleural drainage intervention applied` presentation.

## Scope boundaries

Not included: persistence/rehydration, medications, blood products as a pleural shortcut, new assessment protocol, WP-45 work, or disease-specific runtime branching. Before WP-44A, a running pleural PatientProcess exists only in the authoritative in-memory Scenario runtime and is not rehydrated after process/app restart. WP-44A is ready to define that canonical persistence boundary. WP-45 is clinically ready but must wait for WP-44A so its second patient's runtime can survive restart safely.
