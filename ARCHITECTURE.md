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
10. contributing only simulation-derived content to replay state and hashing.

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

The clinical bridge begins only after `InterventionEngine` has accepted and applied
an intervention. `InterventionRejected` never becomes a physiological input.
`InterventionApplied` and `InterventionRemoved` may be translated to typed clinical
inputs by a stateless adapter. This keeps resource conflict semantics independent
from clinical effect semantics.

```text
SchedulableIntervention
        |
        v
InterventionEngine + ResourcePool
        |
        +-- rejected --> audit event only
        |
        +-- applied/removed
                  |
                  v
       ClinicalInputAdapter
                  |
                  v
       ClinicalIntegrationFramework
```

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
src/services/runtime/clinical/ClinicalIntegrationFramework.ts
src/services/runtime/clinical/ClinicalInputAdapter.ts
src/services/runtime/clinical/ClinicalProcessRegistry.ts
src/services/runtime/clinical/handlers/HvClinicalProcessHandler.ts
src/services/runtime/clinical/handlers/HypoxiaClinicalProcessHandler.ts
src/services/runtime/clinical/__tests__/
```

The names are guidance. The important boundary is that contracts, orchestration,
adapters, and disease-specific handlers remain separate.

## WP-10 delivery sequence

1. Add contracts, rejection codes, canonical ordering, and handler registry.
2. Add the framework's plan/apply path with idempotency and atomic rejection.
3. Adapt existing HV and Hypoxia action handling without changing their clinical
   formulas.
4. Bridge accepted resource intervention events through a stateless adapter.
5. Integrate the framework into `ClinicalScenarioEngine` while retaining the
   existing ownership and aggregation pipeline.
6. Add deterministic replay, ordering, rejection, and regression tests.
7. Update architecture and coverage documentation from actual test results.

## WP-10 acceptance criteria

- Existing Golden tests remain unchanged and pass.
- Existing TypeScript, ESLint, and automated tests pass.
- HV and Hypoxia inputs are handled through registered process handlers.
- Unsupported and invalid inputs fail with stable reason codes and no partial
  mutation.
- Duplicate input delivery is idempotent.
- Process result does not depend on handler registration or map insertion order.
- Accepted intervention events can reach the appropriate process through the
  adapter; rejected interventions cannot.
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
