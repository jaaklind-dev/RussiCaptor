# RussiCaptor Architecture

## Purpose

RussiCaptor is a deterministic clinical exercise runtime and mobile user interface.
It combines exercise configuration, patient-specific clinical processes, responder
interventions, constrained resources, shared runtime state, remote synchronization,
and Golden Pack verification.

This document describes the current architecture and defines the intended boundary
of **WP-10 – Clinical Integration Framework**. WP-10 is a foundation layer. It does
not add a medication engine, a new disease model, or clinical decision support.

## Architectural principles

1. **Golden Pack is canonical.** Tests, expected values, comparators, and workbooks
   are not changed to accommodate engine behaviour.
2. **Patient processes own clinical progression.** A disease or physiological
   process changes only its own process runtime and emits typed contributions.
3. **No direct RuntimeState writes.** Clinical changes pass through ownership
   authorization and the runtime aggregation pipeline.
4. **Interventions express intent.** Resource allocation and intervention conflict
   handling remain separate from disease progression.
5. **Determinism is part of correctness.** Equal fixtures and equal ordered inputs
   must produce equal process state, RuntimeState, event log, and replay hash.
6. **The UI observes runtime state.** UI components and selectors do not make
   clinical decisions or mutate simulation state.
7. **Remote sync transports state; it does not reinterpret it.** Clinical rules are
   executed by the runtime, not by persistence or synchronization adapters.

## Current system context

```text
Exercise workbook / persisted exercise / remote sync
                         |
                         v
                  repositories/providers
                         |
                         v
Mobile UI --------> application services --------> ClinicalScenarioEngine
                                                    |       |       |
                                                    |       |       +--> ResourcePool
                                                    |       +----------> InterventionEngine
                                                    +------------------> PatientProcesses
                                                                             |
                                                                             v
                                                                  OwnershipResolver
                                                                             |
                                                                             v
                                                            RuntimeAggregationPipeline
                                                                             |
                                                                             v
                                      UI/debug selectors <------------ RuntimeState + logs

Golden fixtures --> GoldenEngineAdapter/ScenarioEngineGoldenHarness --> GoldenRunner
```

## Application data architecture

The mobile Case Manager UI must not depend directly on its data source. The stable
dependency direction is:

```text
React Native UI
      |
      v
Repositories
      |
      v
Providers
      |
      v
Data source
```

The current application uses demo-backed providers. The provider boundary allows a
future OneDrive/Microsoft Graph, JSON, or API-backed provider to replace the data
source without requiring UI changes. Repositories must therefore never access demo
data directly.

The application domain is rooted in an exercise:

```text
Exercise
|-- Patients
|-- Questions
|-- Timeline
|-- Labs
|-- Imaging
|-- Notes
|-- Orders
`-- Users
```

`Patient` contains identity and current patient-level state. Questions, timeline
events, laboratory results, imaging studies, notes, and orders are independent
records linked by patient ID; they are not embedded inside the Patient object.
The Timeline is the application audit trail for events such as assignment,
revealing a question, releasing a laboratory result, adding imaging, and completing
a transfer. Imaging attachments may later reference files stored in OneDrive or
SharePoint.

## Existing layers

### Configuration and import

Workbook import validates modules, dependencies, identifiers, exercise binding,
runtime constraints, and hashes before activation. Import uses staging and an
atomic commit/rollback model. Imported configuration is input data; it is not
runtime state.

### Providers and repositories

Providers store the active exercise and clinical application data. Repositories
offer domain-oriented access to patients, questions, imaging, orders, notes,
interventions, medications, vital signs, and scenario events. Persistence and
remote synchronization operate through these boundaries.

### ClinicalScenarioEngine

`ClinicalScenarioEngine` currently coordinates:

- fixture bootstrap;
- simulation time;
- active HV, Hypoxia, and Botulism Root processes;
- timed transitions and engine ticks;
- process aggregation;
- intervention scheduling;
- resource allocation;
- deterministic event logging and replay hashing.

It is the runtime orchestrator, but should not become the permanent home of
disease-specific input routing or intervention-to-process mapping. WP-10 extracts
that responsibility behind explicit contracts.

### PatientProcess runtime

Each process has, at minimum:

- `processId` and `instanceKey`;
- `encounterId`, `processType`, and `templateId`;
- lifecycle `state`;
- `elapsedTime` and `nextTick`;
- private clinical state;
- typed `ProcessOutput` contributions;
- optional parent process identity.

HV owns ventilation and CO2 progression. Hypoxia owns oxygenation and SpO2
progression. Botulism Root orchestrates child processes without directly writing
the patient's aggregate RuntimeState.

### OwnershipResolver

`RuntimeOwnershipResolver` determines, for every governed runtime field:

- canonical owner;
- permitted contributors and contribution channel;
- aggregation or write rule;
- conflict action;
- acceptance/rejection reason.

It authorizes a write or contribution. It does not calculate the final patient
state.

### RuntimeAggregationPipeline

`aggregateRuntimeState` validates and deterministically sorts process outputs,
applies ownership decisions, combines vital targets and clinical limitations,
applies caps and smoothing, records attribution, and returns a new RuntimeState
plus aggregation events. It is the sole normal path from clinical contributions to
aggregate patient state.

### Resource and intervention runtime

`ResourcePool` owns resource availability and patient assignment.
`InterventionEngine` owns scheduled, active, rejected, and completed intervention
state. Same-tick actions use deterministic priority and action-phase ordering,
preflight conflict resolution, stable rejection reason codes, and stable ID
tie-breaking.

Resource and intervention events may become clinical inputs, but resource
reservation alone must not directly alter physiological state.

### Golden verification

The Golden harness adapts canonical fixtures and event inputs to the real scenario
engine. Golden comparators validate snapshots, events, process trees, RuntimeState,
and replay hashes without test-specific engine branches.

## WP-10 – Clinical Integration Framework

### Goal

WP-10 introduces one typed, deterministic boundary between external clinical
intent and PatientProcess execution. It removes ad hoc clinical routing from the
orchestrator while preserving the existing ownership, aggregation, intervention,
resource, and Golden infrastructure.

### Target flow

```text
UI / Golden input / scenario event / applied intervention
                         |
                         v
               ClinicalIntegrationInput
                         |
                         v
             ClinicalIntegrationFramework
                | validate and normalize
                | resolve target processes
                | create deterministic plan
                v
               PatientProcess handlers
                         |
                         v
                    ProcessOutput[]
                         |
                         v
                 OwnershipResolver
                         |
                         v
            RuntimeAggregationPipeline
                         |
                         v
           RuntimeState + clinical events
```

### Responsibilities

The framework is responsible for:

1. accepting a typed clinical input envelope;
2. validating encounter, timestamp, input identity, source, and payload shape;
3. normalizing semantically equivalent inputs into one canonical representation;
4. resolving eligible active process handlers by declared capability;
5. producing a deterministic execution plan before mutating any process;
6. invoking handlers in stable order;
7. collecting updated process runtimes, outputs, and domain events;
8. rejecting unsupported, stale, duplicate, or ambiguous inputs with stable codes;
9. returning results to `ClinicalScenarioEngine` for the existing ownership and
   aggregation path;
10. managing definition-driven intervention instances and their terminal states;
11. converting running interventions into typed mechanism-level effects;
12. contributing only simulation-derived content to replay state and hashing.

The framework is not responsible for:

- deciding which treatment a responder should choose;
- reserving or releasing physical resources;
- directly writing RuntimeState;
- bypassing ownership authorization;
- persisting or synchronizing records;
- rendering UI;
- containing disease-specific progression formulas.

### Core contracts

The implementation should introduce contracts equivalent to the following. Exact
TypeScript placement may follow the existing project structure.

```ts
type ClinicalIntegrationInput = {
  inputId: string;
  encounterId: string;
  timestamp: number;
  inputType: string;
  source: {
    kind: "SCENARIO" | "INTERVENTION" | "OBSERVATION" | "ENGINE";
    sourceId: string;
  };
  payload: Record<string, unknown>;
};

type ClinicalProcessHandler = {
  processType: string;
  accepts(input: ClinicalIntegrationInput, process: PatientProcessRuntime): boolean;
  apply(input: ClinicalIntegrationInput, process: PatientProcessRuntime): ClinicalProcessResult;
};

type ClinicalProcessResult = {
  process: PatientProcessRuntime;
  events: ClinicalIntegrationEvent[];
};

type ClinicalIntegrationResult = {
  status: "APPLIED" | "NO_OP" | "REJECTED";
  processes: PatientProcessRuntime[];
  outputs: ProcessOutput[];
  events: ClinicalIntegrationEvent[];
  rejection?: ClinicalIntegrationRejection;
};
```

Handlers must be registered by process capability or process type. The framework
must not identify Golden test IDs, fixture IDs, patient IDs, or disease-specific
template IDs as routing shortcuts.

### InterventionDefinition

An `InterventionDefinition` is immutable configuration describing what an
intervention requires and which clinical effects it may produce. It is not a
patient-specific runtime record.

```ts
type InterventionDefinition = {
  definitionId: string;
  version: string;
  name: string;
  requiredResources: ResourceRequirement[];
  effects: ClinicalEffectDefinition[];
  duration: InterventionDuration;
  parameters: InterventionParameterDefinition[];
  preconditions: InterventionPrecondition[];
};
```

- `requiredResources` declares resource types, quantities, and optional exclusive
  groups needed before the intervention can start.
- `effects` declares typed clinical effects, not direct RuntimeState changes.
- `duration` defines a fixed, bounded, or continuous intervention.
- `parameters` defines validated inputs such as oxygen flow in litres per minute.
- `preconditions` defines structural conditions for starting the intervention,
  such as an active encounter or a compatible resource. It must not become a
  treatment recommendation engine.

Definitions are versioned and included by identity and version in replay content.
Changing a definition does not retroactively change an existing replay.

### InterventionInstance

An `InterventionInstance` is a patient- and encounter-specific execution of one
definition. It owns intervention lifecycle but does not own physiology.

```ts
type InterventionInstanceStatus =
  | "RUNNING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

type InterventionInstance = {
  instanceId: string;
  definitionId: string;
  definitionVersion: string;
  encounterId: string;
  patientId: string;
  status: InterventionInstanceStatus;
  startedAt: number;
  endedAt?: number;
  parameters: Record<string, ClinicalParameterValue>;
  resourceIds: string[];
  sourceInterventionId: string;
  failureReason?: InterventionFailureReason;
};
```

Lifecycle transitions are explicit and append deterministic events:

```text
RUNNING -> COMPLETED
RUNNING -> CANCELLED
RUNNING -> FAILED
```

`COMPLETED`, `CANCELLED`, and `FAILED` are terminal. A failed precondition or
resource acquisition does not create a partially running instance. Cancellation
stops future effects and releases resources according to the resource layer; it
does not silently reverse clinical history.

### Clinical Effect Pipeline

An intervention never changes PatientProcess state, vital signs, or RuntimeState
directly. It emits one or more typed `ClinicalEffect` values. Eligible active
PatientProcesses interpret those effects and produce their normal outputs.

```text
InterventionDefinition + validated parameters
                         |
                         v
               InterventionInstance
                         |
                         v
                   ClinicalEffect
                         |
                         v
               PatientProcess handler
                         |
                         v
                    ProcessOutput
                         |
                         v
       OwnershipResolver -> RuntimeAggregationPipeline
```

The minimum effect envelope is:

```ts
type ClinicalEffect = {
  effectId: string;
  effectType: string;
  encounterId: string;
  patientId: string;
  timestamp: number;
  sourceInterventionInstanceId: string;
  parameters: Record<string, ClinicalParameterValue>;
  duration?: number;
};
```

Effects describe mechanism-level input such as inspired oxygen, effective
ventilation, monitoring, or vascular access. They do not prescribe a resulting
SpO2, CO2 burden, clinical status, or displayed vital value. An effect that no
active process supports is rejected or recorded as a deterministic no-op; it is
never converted into an arbitrary generic vital-sign delta.

### Oxygen Therapy foundation

Oxygen Therapy is the first concrete intervention definition used to prove the
pipeline. Its minimum parameter is `flowRateLMin`; its required delivery resource
is declared by the definition or selected compatible interface. The definition
converts validated treatment parameters into an inspired-oxygen effect.

```text
Oxygen Therapy: oxygen at 15 L/min
                  |
                  v
ClinicalEffect: INSPIRED_OXYGEN_INCREASED
  flowRateLMin: 15
  deliveryInterface: oxygenMask
                  |
                  v
HypoxiaPatientProcess
                  |
                  v
oxygenation progression / ProcessOutput
                  |
                  v
aggregated SpO2
```

The exact FiO2 estimate belongs to a reusable oxygen-delivery effect calculation,
not to the UI or ResourcePool. The resulting SpO2 response belongs to the Hypoxia
process and depends on its current clinical state. Reserving an oxygen mask without
a running Oxygen Therapy instance has no direct SpO2 effect.

Foundation-level Oxygen Therapy supports:

- flow-rate validation;
- required oxygen supply and compatible delivery-interface resources;
- start, completion, cancellation, and failure lifecycle;
- continuous effect emission while running;
- deterministic replay and event generation;
- Hypoxia process consumption through the normal clinical handler contract.

It does not yet model device leakage, patient-specific oxygen dissociation,
high-flow systems, toxicity, or treatment recommendation logic.

### Stable rejection reasons

WP-10 should use machine-readable reasons, with human-readable detail added
separately. The minimum foundation set is:

```text
INVALID_INPUT
ENCOUNTER_MISMATCH
STALE_INPUT
DUPLICATE_INPUT
NO_ACTIVE_PROCESS
UNSUPPORTED_INPUT
AMBIGUOUS_TARGET
PROCESS_REJECTED
```

A rejection event records at least input ID, encounter ID, timestamp, input type,
source identity, reason code, and any resolved process IDs. Rejected inputs must
not partially mutate process or aggregate state.

### Ordering and atomicity

For multiple inputs at the same simulation time, the canonical order is:

```text
timestamp -> input phase -> source kind -> source ID -> input ID
```

Input phases must be explicit and documented rather than inferred from string
ordering. Handler execution is ordered by:

```text
parent depth -> processType -> processId -> instanceKey
```

The framework first creates a complete plan, then applies it. Validation or target
resolution failure rejects that input before any process mutation. RuntimeState is
aggregated only after the planned process applications have completed.

### Idempotency and replay

`inputId` is the idempotency key within an encounter. Reapplying an already
completed input produces `NO_OP` and no new clinical mutation. Replay identity
includes canonical inputs, resulting process runtimes, process outputs, clinical
events, RuntimeState, and resource/intervention runtime where applicable.

Hashes must use canonical serialization and must not depend on:

- object or map insertion order;
- memory identity;
- locale-dependent ordering;
- wall-clock time;
- random values outside the fixture seed.

### Integration with interventions

The clinical bridge begins only after `InterventionEngine` has accepted an action,
its definition preconditions have passed, and required resources have been
reserved. `InterventionRejected` never becomes a physiological input. An accepted
action creates, completes, cancels, or fails an `InterventionInstance`; running
instances emit typed effects. This keeps resource conflict semantics, intervention
lifecycle, and clinical effect semantics independent.

```text
SchedulableIntervention
        |
        v
InterventionEngine + ResourcePool
        |
        +-- rejected --> audit event only
        |
        +-- accepted
                  |
                  v
       InterventionInstance
                  |
                  v
          ClinicalEffectAdapter
                  |
                  v
       ClinicalIntegrationFramework
```

### UI projection

The patient detail view may show an `Active interventions` section sourced from
running instances, for example:

```text
Active interventions
--------------------
Oxygen 15 L/min
Monitor attached
IV access
BVM ventilation
```

This is a read-only projection. The UI formats definition names, validated
parameters, and lifecycle state; it does not derive clinical effects. Completed,
cancelled, and failed instances belong in intervention history rather than the
active list. Developer resource cards remain resource diagnostics and must not be
used as the source of clinical truth.

### Event model

Clinical integration events should include:

- `eventType`;
- `timestamp`;
- `sequence` assigned by the scenario engine;
- `inputId` and source identity;
- `encounterId`;
- `sourceProcessId` and `instanceKey` when a process handled the input;
- stable rejection reason when applicable;
- deterministic payload.

Process handlers create domain events; the scenario engine assigns global sequence
numbers and merges them into the canonical event log.

## Dependency rules

Allowed dependency direction:

```text
UI -> application services -> scenario engine
scenario engine -> clinical integration -> process handlers
clinical integration -> domain models only
scenario engine -> ownership + aggregation
scenario engine -> intervention + resources
adapters -> public contracts of the layer they adapt
```

Forbidden dependencies:

- process handlers importing UI, repositories, synchronization, or persistence;
- selectors mutating runtime services;
- clinical integration writing repositories;
- ResourcePool importing clinical processes;
- Golden code being imported into production runtime logic;
- ownership or aggregation importing disease-specific handlers.

## Proposed source layout

```text
src/models/ClinicalIntegration.ts
src/models/InterventionDefinition.ts
src/models/InterventionInstance.ts
src/services/runtime/clinical/ClinicalIntegrationFramework.ts
src/services/runtime/clinical/ClinicalEffectPipeline.ts
src/services/runtime/clinical/InterventionDefinitionRegistry.ts
src/services/runtime/clinical/InterventionRuntime.ts
src/services/runtime/clinical/OxygenTherapyDefinition.ts
src/services/runtime/clinical/ClinicalProcessRegistry.ts
src/services/runtime/clinical/handlers/HvClinicalProcessHandler.ts
src/services/runtime/clinical/handlers/HypoxiaClinicalProcessHandler.ts
src/services/runtime/clinical/__tests__/
```

The names are guidance. The important boundary is that contracts, orchestration,
adapters, and disease-specific handlers remain separate.

## WP-10 delivery sequence

1. Add clinical input/effect contracts, rejection codes, canonical ordering, and
   handler registry.
2. Add `InterventionDefinition`, `InterventionInstance`, lifecycle validation, and
   a definition registry.
3. Add the framework's plan/apply path with idempotency and atomic rejection.
4. Add the effect pipeline and the minimal Oxygen Therapy definition.
5. Adapt existing HV and Hypoxia action handling without changing their clinical
   formulas.
6. Bridge accepted resource intervention actions through intervention instances
   and typed effects.
7. Integrate the framework into `ClinicalScenarioEngine` while retaining the
   existing ownership and aggregation pipeline.
8. Add an Active interventions read-only projection to the patient detail view.
9. Add deterministic replay, ordering, rejection, lifecycle, and regression tests.
10. Update architecture and coverage documentation from actual test results.

## WP-10 acceptance criteria

- Existing Golden tests remain unchanged and pass.
- Existing TypeScript, ESLint, and automated tests pass.
- HV and Hypoxia inputs are handled through registered process handlers.
- Unsupported and invalid inputs fail with stable reason codes and no partial
  mutation.
- Duplicate input delivery is idempotent.
- Process result does not depend on handler registration or map insertion order.
- Definitions validate required resources, parameters, duration, effects, and
  preconditions before an instance starts.
- Intervention instances follow only valid `RUNNING`, `COMPLETED`, `CANCELLED`, or
  `FAILED` lifecycle transitions.
- Accepted interventions reach PatientProcesses only as typed clinical effects;
  rejected interventions cannot produce effects.
- Oxygen at 15 L/min produces an inspired-oxygen effect consumed by Hypoxia; mask
  reservation by itself does not directly change SpO2.
- Patient detail Active interventions is derived from running instances and
  contains no clinical business logic.
- Every RuntimeState change still passes through `OwnershipResolver` and
  `RuntimeAggregationPipeline`.
- Two identical replays produce identical processes, RuntimeState, event log, and
  replay hash.
- No Golden-, fixture-, patient-, or template-specific routing exception is added.

## Explicit non-goals for WP-10

- Medication pharmacokinetics or pharmacodynamics;
- medication dose validation;
- a complete clinical compatibility matrix;
- responder treatment recommendations;
- automatic selection of the clinically preferred intervention;
- new botulism, haemorrhage, or other disease progression models;
- database schema or remote synchronization redesign;
- user-interface redesign.

These capabilities may build on the framework in later work packages, but they are
not prerequisites for completing its foundation.

## WP-11 – Airway Management Framework

WP-11 builds on WP-10 without introducing a second clinical path. Airway
interventions are versioned definitions and patient-specific instances; resource
reservation, intervention lifecycle, clinical effects, PatientProcess progression,
ownership, and aggregation remain separate stages.

```text
ResourcePool + conflict planner
            -> InterventionInstance
            -> AirwayState + deterministic airway events
            -> ClinicalEffect
            -> PatientProcess
            -> OwnershipResolver
            -> RuntimeAggregationPipeline
```

`AirwayState` projects the active airway (`NONE`, `MANUAL`, `OPA`, `NPA`,
`SUPRAGLOTTIC`, or `ENDOTRACHEAL`), ventilation (`NONE`, `BVM`, or `MECHANICAL`),
oxygen delivery, confirmation, patient, and simulation timestamp. It is included in
replay hashing but never replaces process-owned physiology.

OPA, NPA, supraglottic airway, endotracheal intubation, BVM, mechanical ventilation,
and Oxygen Therapy use the same definition registry. Resource-level
`airwayAdjunct` and `activeVentilation` exclusive groups are resolved by the WP-9B
planner before any instance or AirwayState mutation. Resource reservation without
an explicit or safely inferred clinical definition does not create a clinical
effect.

WP-11 intentionally does not model advanced ventilation or gas-exchange
physiology. Mechanical ventilation produces lifecycle and AirwayState events;
future physiology must be added as general clinical effects rather than direct
RuntimeState writes.

## WP-12 – Clinical Assessment & Protocol Engine

WP-12 is a read-only projection over existing simulation evidence. It does not
dispatch inputs, reserve resources, alter intervention state, or write RuntimeState.

```text
RuntimeState + event/intervention logs + resources + AirwayState + effects + timeline
                                      |
                                      v
                         ClinicalAssessmentEngine
                              |              |
                              v              v
                      AssessmentEvents    DebriefReport
```

Protocols are ordered collections of data-only `AssessmentRule` values. The rule
DSL supports event presence and deadlines, absence, order, maximum counts,
intervention rejection, resource conflict, and AirwayState checks. Rule IDs provide
deterministic ordering; no ALS, ATLS, MASCAL, or hospital-specific protocol logic is
compiled into the evaluator.

Results are `PASS`, `WARNING`, `FAIL`, `INFO`, or `NOT_APPLICABLE`. PASS, WARNING,
and FAIL produce deterministic `AssessmentPassed`, `AssessmentWarning`, and
`AssessmentFailed` events. Debrief is derived from the same immutable source
snapshot and contains summary, completed interventions, timeline, findings,
warnings, failures, strengths, and improvement opportunities.

Assessment content participates in replay hashing. Because the engine receives
cloned/read-only snapshots and has no references to mutating runtime services, an
assessment cannot change simulation results.

## WP-13 – Circulation & Vascular Access Framework

WP-13 completes the ABC foundation using the existing resource, intervention, and
clinical-effect layers. `CirculationState` is a deterministic projection containing
zero or more active vascular accesses, active hemorrhage-control mechanisms,
running infusions, patient identity, and simulation timestamp.

```text
ResourcePool -> InterventionInstance -> CirculationState/events
                                    `-> ClinicalEffect -> eligible PatientProcess
```

Peripheral IV, IO, central access, crystalloid, blood-product and pressure
infusions, tourniquet, and pelvic binder are versioned definitions. Multiple IV
instances may coexist because access identity is instance- and resource-based.
Exclusive access-site or pelvic-stabilization conflicts remain ResourcePool data and
are resolved by the WP-9B planner.

Tourniquet emits `REDUCE_EXTERNAL_BLEEDING`, but no temporary physiology is applied
when a Hemorrhage PatientProcess is absent. A later Hemorrhage process can consume
the same general effect without changing this framework. WP-13 adds no medication
or transfusion decision logic.

## WP-14 – Hemorrhage PatientProcess

WP-14 is the first process whose physiology is driven entirely by the active
Clinical Effect set. Its fixture-provided configuration contains baseline bleeding,
effect efficiencies, infusion offsets, severity/perfusion/compensation thresholds,
and trend thresholds; the process contains no embedded clinical cut-offs.

Each tick sorts active effects canonically, resolves STOP before reductions, uses
the strongest bleeding reduction, combines configured infusion support, advances
cumulative loss, and derives severity, perfusion, compensation, and trends. It emits
HemorrhageStarted/Reduced/Stopped, PerfusionChanged, and CompensationChanged.

Hemorrhage contributes only process-owned runtime fields through OwnershipResolver
and RuntimeAggregationPipeline. InterventionEngine never changes blood loss,
perfusion, vital trends, or RuntimeState. Fixed decimal precision ensures stable
cross-runtime replay hashes.

## WP-15 – Medication Framework

WP-15 provides a data-only medication definition registry and deterministic
administration state machine. Definitions declare supported routes, category,
abstract effects, duration, and metadata. The engine validates identity, route,
dose shape, and matching IV/IO access from CirculationState; it does not decide
whether treatment is clinically indicated.

Administration produces MedicationOrdered/Started/Completed/Cancelled/Rejected and
abstract Clinical Effects. PatientProcesses may consume supported effects through
the existing clinical layer; unsupported effects do not become direct vital or
RuntimeState changes. Medication state, history, and effects participate in replay
hashing. ResourcePool is read-only to MedicationEngine and no resources are
reserved by medication administration.

## WP-16 – Vital Sign Engine

`VitalSignEngine` is the deterministic monitor synthesis boundary. PatientProcess
implementations own disease progression and emit typed contributors; medication and
other clinical layers may emit the same contributor contract. The engine contains no
disease, medication, intervention, resource, assessment, or UI logic.

```text
Clinical Effects
       |
       v
Eligible PatientProcesses -> typed contributors
                              |
                              v
                       VitalSignEngine
                              |
                   canonical VitalSignState
                              |
                    Runtime aggregation
                              |
                    Runtime snapshot
                              |
            Assessment / Replay / read-only UI
```

Resolution is data-driven and stable: configured baseline, permanent modifiers,
PatientProcess contributors, temporary modifiers,
configured limits/change-per-tick, then rounding. Sorting uses layer, vital,
source ID, and contributor ID; caller order cannot affect the result.

`VitalSignState` contains HR, systolic/diastolic BP, RR, SpO2, EtCO2,
temperature, GCS, AVPU, target/current/trend/direction/stability, monitor quality,
active contributor attribution, MAP, shock index, and pulse pressure. `VALID`,
`UNRELIABLE`, `LOST`, and `OFFLINE` are monitor quality states. Changes emit
`VitalSignChanged`, `TrendChanged`, and `MonitorStateChanged` into a separate,
replay-hashed deterministic event stream. The legacy `targetVitals`,
`displayedVitals`, `mapCalculated`, and `gcsTarget` values are frozen compatibility
projections generated only from `VitalSignState`; they are not writable state.

WP-AA1 fixes the production order as `PatientProcess -> VitalSignRuntimeResolver ->
VitalSignEngine -> RuntimeAggregationPipeline -> RuntimeState`. Legacy ProcessOutput
vital fields are accepted only through `LegacyVitalContributorAdapter`; the adapter
creates contributors and never calculates a final monitor state. Clinical Effects
and medication effects cannot enter the production resolver directly.
