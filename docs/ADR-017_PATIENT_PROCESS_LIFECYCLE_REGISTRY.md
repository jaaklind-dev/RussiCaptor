# ADR-017 — Canonical PatientProcess Lifecycle Registry

**Status:** Accepted — ready for zero-behaviour-change migration

**Original proposal:** 2026-08-10

**Revised and accepted:** 2026-08-10

**Decision owners:** RussiCaptor architecture maintainers

**Related decisions:** Architecture v0.7 Freeze; ADR-016 — Clinical Module Composition

**Review evidence:** [`ADR-017_ARCHITECTURE_REVIEW.md`](./ADR-017_ARCHITECTURE_REVIEW.md)

**Implementation status:** WP-36A migration implemented locally with immutable
parity baselines and a passing physical-device smoke test; architecture freeze
remains pending commit and green Node 20/22/24/26 CI. WP-36 remains blocked. See
[`WP36A_PATIENT_PROCESS_LIFECYCLE_REGISTRY_MIGRATION.md`](./WP36A_PATIENT_PROCESS_LIFECYCLE_REGISTRY_MIGRATION.md).

## Decision history

The original proposal described a registry with only `bootstrap` and `tick` and
one global order, `processType → processId → instanceKey`. Architecture review
found that this abstraction did not represent production Hemorrhage effect
preparation, process-generated events, Botulism root/child orchestration or
post-tick behaviour. The proposed order would also have changed process arrays,
event arrays and replay hashes.

This revision replaces that proposal. It is derived from the current production
`ClinicalScenarioEngine` lifecycle. Legacy observable ordering is normative
during migration. Registry migration contains zero new clinical functionality;
Cardiac Arrest and Respiratory Failure production integration are explicitly
outside it.

## Context

Architecture v0.7 permits new PatientProcesses, Clinical Effects and
contributors. Production lifecycle authority nevertheless remains encoded in
process-specific `ClinicalScenarioEngine` fields and branches. The existing
`ClinicalProcessRegistry` routes Clinical Effects only to already-created
processes; it does not bootstrap, advance, tick, retain or serialize them.

Adding another process-specific Runtime branch would make the documented
PatientProcess extension point incomplete. A lifecycle registry may remove
those branches only if it reproduces all existing behaviour and observable
ordering exactly.

## Production lifecycle inventory

The production process set is derived from repository behaviour, not module
catalogue contents.

### HYPOVENTILATION_HYPERCAPNIA (HV)

- **Entry/storage:** mandatory primary `process` field.
- **Bootstrap:** always created. For Botulism, its initial reserve and parent
  identity are derived from `BOT_RESPIRATORY_MUSCLE_FAILURE`; otherwise fixture
  HV data or the fixture root is used.
- **Advance:** scheduled transitions are ordered by due simulation second and
  transition identifier. A transition may mutate HV or activate Hypoxia.
- **Input handling:** ACTION, THRESHOLD_HOLD, instructor respiratory
  deterioration and selected Botulism progression inputs mutate/schedule HV.
- **Effects:** `ClinicalIntegrationFramework` routes Airway/Oxygen effects via
  `hvClinicalProcessHandler`.
- **Tick:** relative tick duration; executed before Hypoxia and Hemorrhage.
- **Events/finalize:** primary `ENGINE_TICK_APPLIED`, optional
  `PROCESS_CONTROLLED`, and post-tick oxygen-masking warning with reaggregation.
- **Aggregation:** always first in the exposed process list.
- **Ownership:** `ProcessOutput.moduleId = HYPOVENTILATION_HYPERCAPNIA_V1`;
  `RuntimeOwnershipResolver` authorizes contributions.
- **Replay-sensitive:** process identity/state/output, pending-transition event
  order, primary list position, events and process-tree serialization.

### HYPOXIA

- **Entry/storage:** zero or more entries in `hypoxiaProcesses`.
- **Bootstrap/activation:** explicit fixture child, severe Botulism respiratory
  child, HV timed transition, or Botulism aspiration. Parent identity is retained.
- **Effects:** Oxygen effects are routed through `ClinicalIntegrationFramework`
  and `hypoxiaClinicalProcessHandler`.
- **Tick:** relative duration, after HV, siblings sorted by `processId`.
- **Events:** post-aggregation `PROCESS_TICK_APPLIED` in sibling order;
  activation has its existing factual event and source identity.
- **Aggregation:** after HV, before Hemorrhage, siblings by `processId`.
- **Ownership:** `ProcessOutput.moduleId = HYPOXIA_V1`; resolver remains
  authoritative.
- **Replay-sensitive:** parent metadata, sibling order, activation event timing,
  output order and process-tree array position.

### HEMORRHAGE

- **Entry/storage:** optional singleton `hemorrhageProcess` from fixture data.
- **Bootstrap:** only when `initial.hemorrhage` exists; invalid configuration
  fails closed in the process bootstrap.
- **Prepare:** before tick, receives the canonical active Clinical Effect set,
  already sorted by effect type and effect ID; its process function selects and
  sorts Hemorrhage-relevant effects.
- **Tick:** relative duration, after HV and all Hypoxia children.
- **Events:** tick returns domain events. Scenario Runtime records them before
  aggregation, in returned order, using the existing sequence allocator.
- **Aggregation:** optional final member of the exposed process list.
- **Ownership:** `ProcessOutput.moduleId = HEMORRHAGE_V1`; resolver authorizes
  each contributed runtime field.
- **Replay-sensitive:** prepared effect IDs/order, generated event order, output
  fields, optional list position and hash content.

### BOTULISM_ROOT and children

- **Entry/storage:** optional separate `botulismRoot`; children remain nested in
  the root and are sorted by `processId` during bootstrap.
- **Bootstrap:** fixture `processAssignments`/`botulismProcesses` creates the
  root tree before primary HV derivation and optional children.
- **Advance:** root uses absolute target simulation time, not relative tick
  duration.
- **Input handling:** ENCOUNTER_ACTIVATE, PROGRESSION_CHECK, ASPIRATION_EVENT,
  SNAPSHOT and ORAL_FLUID_GIVEN contain existing Botulism-specific semantics.
- **Child handling:** respiratory and cranial child identities are used to
  parent HV/Hypoxia processes; the nested root tree is not flattened.
- **Aggregation:** root and generic Botulism children are not added to the main
  aggregation output list; derived active HV/Hypoxia processes participate.
- **Events:** existing input and child-activation events retain current source,
  parent and sequence behaviour.
- **Ownership:** nested Botulism outputs do not gain Runtime write authority from
  registry membership.
- **Replay-sensitive:** root object is serialized separately from the main
  process list; child order, parent IDs, elapsed time and events are immutable
  migration contracts.

### Respiratory Failure baseline

Respiratory Failure has an isolated PatientProcess, handler, module and tests,
but does not participate in the current production `ClinicalScenarioEngine`
lifecycle. It provides **no historical production ScenarioEngine replay-
equivalence baseline** for ADR-017. Integrating it later is new behaviour and
cannot be used to prove migration parity.

### Adjacent canonical orchestration

Resource, Intervention, Airway, Circulation and Medication runtimes are not
PatientProcess lifecycle descriptors. Their established ordering before process
preparation/ticks is preserved and remains outside the registry:

```text
resource update and due interventions
→ intervention/resource events
→ Airway/Circulation instance projections
→ active Intervention + Medication Clinical Effects
→ PatientProcess prepare/effect/tick lifecycle
```

## Lifecycle matrix

| Phase | HV | Hypoxia | Hemorrhage | Botulism root |
|---|---|---|---|---|
| Bootstrap | Mandatory; may derive from Botulism respiratory child | Optional or dynamically activated with parent | Optional fixture configuration | Optional root first; nested children by `processId` |
| Advance | Due timed transitions; may activate Hypoxia | None independently | Medication advance is external, not Hemorrhage | Absolute target-time tick |
| Process input | HV actions, thresholds, instructor transition | Activated by HV/Botulism inputs | None currently | Five existing Botulism input branches |
| Prepare | Effects via Clinical Integration | Effects via Clinical Integration | Sorted active effect set before tick | None |
| Tick | Relative duration, first | Relative duration, second, siblings by ID | Relative duration, third | Advance phase, not ENGINE_TICK phase |
| Domain events | Transition/action evidence | Activation evidence | Returned by tick before aggregation | Root/input/child evidence |
| Children | Parent of Hypoxia | Retains parent reference | None | Nested tree; selected children parent HV/Hypoxia |
| Aggregate | Slot 100 | Slot 200, sibling ID order | Slot 300 | Root excluded; derived HV/Hypoxia included |
| Post-aggregate | Primary tick event, controlled event | Tick evidence in sibling order | None | None |
| Finalize | Oxygen-masking check; possible mutation, reaggregate, event | State read by masking check | None | None |
| Replay shape | Main process list, first | Main list, middle | Main list, last | Separate `root` property, nested children |

## Observable canonical ordering

Internal order becomes canonical whenever it can change state, events,
Timeline/evidence, arrays supplied to hashing or snapshot publication. The
migration therefore preserves four distinct orders. They must not be collapsed
into one alphabetic comparator.

### Execution order

```text
RESET
Botulism root bootstrap (if applicable)
→ primary HV bootstrap
→ optional Hemorrhage bootstrap
→ initial Hypoxia activation(s)

ADVANCE
Medication advance (outside registry)
→ Botulism root absolute-time advance
→ due HV transitions by dueSec, then transition ID

ENGINE_TICK
resource/intervention phases (outside registry)
→ Hemorrhage effect preparation
→ Clinical Integration effects for HV/Hypoxia
→ HV tick
→ Hypoxia ticks by processId
→ Hemorrhage tick
→ Hemorrhage domain events
→ canonical aggregation
→ Hypoxia tick evidence by processId
→ primary engine-tick evidence
→ controlled evidence
→ HV masking finalize/reaggregation/evidence
```

### Aggregation input order

```text
slot 100: primary HV singleton
slot 200: Hypoxia siblings by processId
slot 300: optional Hemorrhage singleton
```

The existing aggregation pipeline retains its own internal field-specific
sorting. Registry migration must not alter either the supplied array or those
internal comparators.

### Serialization/replay order

`getPatientProcesses()`, Runtime Snapshot process summaries and process-tree
hash input preserve the same main-list slots above. Botulism root remains the
separate `root` property and its nested children retain `processId` order.
Event arrays retain current phase and sequence order. `stableJson` does not make
array reordering safe.

### Explicit order representation

Each lifecycle descriptor declares immutable migration metadata:

```ts
type LegacyCanonicalOrder = Readonly<{
  bootstrapOrder?: number;
  advanceOrder?: number;
  prepareOrder?: number;
  tickOrder?: number;
  postAggregateOrder?: number;
  finalizeOrder?: number;
  aggregationSlot?: number;
  serializationSlot: number | "SEPARATE_ROOT";
  siblingOrder: "SINGLETON" | "PROCESS_ID";
}>;
```

Numbers are explicit compatibility values, not derived from process names or
registration sequence. Descriptor initialization fails if singleton slots or
phase/order pairs conflict. Repeated siblings are allowed only with an explicit
deterministic sibling comparator. Registration timing and module load order are
never order inputs.

## Revised minimum lifecycle contract

The contract has only phases justified by current production behaviour.

```ts
type PatientProcessLifecycleDescriptor<P extends ClinicalProcessRuntime> = Readonly<{
  processType: string;
  kind: "LEAF" | "ROOT";
  order: LegacyCanonicalOrder;

  bootstrap?: (
    input: Readonly<PatientProcessBootstrapContext>
  ) => Readonly<PatientProcessLifecycleResult<P>>;

  advance?: (
    process: Readonly<P>,
    input: Readonly<PatientProcessAdvanceContext>
  ) => Readonly<PatientProcessLifecycleResult<P>>;

  handleInput?: (
    process: Readonly<P>,
    input: Readonly<CanonicalScenarioInputContext>
  ) => Readonly<PatientProcessInputResult<P>>;

  prepare?: (
    process: Readonly<P>,
    input: Readonly<PatientProcessPreparationContext>
  ) => Readonly<PatientProcessLifecycleResult<P>>;

  tick?: (
    process: Readonly<P>,
    input: Readonly<PatientProcessTickContext>
  ) => Readonly<PatientProcessLifecycleResult<P>>;

  postAggregate?: (
    process: Readonly<P>,
    input: Readonly<PostAggregationContext>
  ) => Readonly<PatientProcessEvidence[]>;

  finalize?: (
    process: Readonly<P>,
    input: Readonly<PatientProcessFinalizationContext>
  ) => Readonly<PatientProcessLifecycleResult<P>>;
}>;

type PatientProcessLifecycleResult<P> = Readonly<{
  process: P;
  activationRequests: readonly PatientProcessActivationRequest[];
  events: readonly PatientProcessEvidence[];
  aggregationRequested: boolean;
}>;

type PatientProcessEvidence = Readonly<{
  eventType: string;
  target?: string;
  details: Readonly<Record<string, unknown>>;
  recordPhase: "BEFORE_AGGREGATION" | "AFTER_AGGREGATION" | "FINALIZE";
}>;
```

These are architectural shapes, not implementation code. Contexts contain only
the existing canonical inputs needed by the corresponding phase: immutable
fixture/configuration, simulation time or tick duration, parent references,
sorted active effects, canonical scenario input and read-only aggregated state.
They do not expose a mutable RuntimeState, event log, registry, module registry,
clock or hash writer.

The optional hooks do not promise future extensibility. Each exists because a
current process requires it:

- `bootstrap`: all production processes;
- `advance`: Botulism absolute-time advance and HV due transitions;
- `handleInput`: current HV and Botulism process-specific inputs;
- `prepare`: Hemorrhage active-effect preparation;
- `tick`: HV, Hypoxia and Hemorrhage relative ticks;
- `postAggregate`: existing Hypoxia/primary tick evidence;
- `finalize`: oxygen-masking mutation and reaggregation.

## Registry responsibility boundary

The registry owns only:

- unique descriptor registration and validation;
- immutable order metadata;
- deterministic descriptor/sibling resolution;
- creation of one stable execution plan during reset/initialization;
- lookup of the descriptor for an already-owned process.

The registry owns none of:

- PatientProcess clinical state;
- RuntimeState or Runtime Snapshot;
- Clinical Effects or intervention/medication/resource state;
- exercise clock or pending canonical event state;
- event meaning, sequence assignment, Timeline or Debrief;
- aggregation, ownership authorization or replay/hash state;
- Clinical Module discovery or composition.

`ClinicalScenarioEngine` remains the canonical Scenario Runtime orchestrator. It
invokes the immutable plan, stores returned processes, forwards their outputs to
existing aggregation, and records returned evidence through its existing event
pathway.

## State and ownership model

Each PatientProcess remains sole owner of its typed domain state. Lifecycle
registration grants no write authority.

```text
Lifecycle Registry
      │ select/invoke only
      ▼
PatientProcess lifecycle
      │ returns ProcessOutput/contributors
      ▼
RuntimeOwnershipResolver
      │ sole authorization decision
      ▼
Vital Sign Engine / canonical aggregation
      ▼
Runtime Snapshot
```

`ProcessOutput.moduleId`, process identity, contribution fields, priorities,
status and `observedAtSec` must remain byte-identical during migration. Every new
runtime-contribution field still requires an explicit ownership rule. Registry
presence can never authorize direct Runtime writes.

## Clinical Effect preparation

Clinical Effect ownership does not move to the registry.

- HV/Hypoxia effects continue through `ClinicalIntegrationFramework` and
  `ClinicalProcessRegistry`.
- Hemorrhage's descriptor adapter receives the already-canonical sorted active
  effect list in `prepare` and calls the existing PatientProcess preparation
  function.
- The registry never selects clinical effects, interprets their meaning or
  creates a second effect pipeline.

## Event semantics

PatientProcess functions/adapters return factual domain evidence. They do not
append to the canonical event log or assign sequence numbers. The descriptor
declares the existing recording phase; `ClinicalScenarioEngine` records evidence
using the existing sequence allocator at the same point as before.

Registry code must not invent event types, reorder returned events or convert
post-aggregation evidence into pre-aggregation evidence.

## Root/child semantics

Root descriptors retain a typed immutable child tree. `SEPARATE_ROOT` preserves
Botulism's current process-tree hash shape. Root children are created and stored
in existing `processId` order; no flattening occurs.

Cross-process activation uses explicit immutable requests containing process
type, initial configuration and full parent identity. Scenario Runtime validates
the target descriptor and identity uniqueness before invocation. Activation
requests execute in the current evidence-derived phase/order; they do not grant
the root authority over the child's domain state or Runtime fields.

## Aggregation boundary

The registry never aggregates. Scenario Runtime builds the existing process
array from explicit aggregation slots and passes unchanged `ProcessOutput`s to:

```text
VitalSignRuntimeResolver
→ VitalSignEngine
→ RuntimeAggregationPipeline
→ Runtime Snapshot
```

`RuntimeOwnershipResolver` and all aggregation comparators remain unchanged.

## Public process runtime contract

Migration introduces a minimal immutable structural base used only by lifecycle
orchestration while retaining typed process-specific state:

```ts
type CanonicalPatientProcessRuntime = Readonly<{
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: string;
  templateId: string;
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  outputs: ProcessOutput;
  nextTick: number;
  parentProcessId?: string;
  parentProcessType?: string;
}>;
```

Concrete runtimes extend this base with typed `clinicalState`, configuration or
children. The base does not replace those types with `Record<string, unknown>`.
Descriptor registration retains its concrete generic type; no unsafe state
mutation is permitted through the base.

## Dependency direction

| Source | May depend on | Must not depend on |
|---|---|---|
| `ClinicalScenarioEngine` | lifecycle registry, existing Runtime services | Clinical Modules/UI |
| lifecycle registry | lifecycle descriptor/base contracts | ScenarioEngine, modules, aggregation implementation, UI |
| lifecycle descriptor adapter | its PatientProcess functions and immutable lifecycle contracts | ScenarioEngine, registry state, RuntimeState writers |
| PatientProcess | model/configuration and ProcessOutput contracts | registry, ScenarioEngine, UI |
| ownership/aggregation | ProcessOutput and existing ownership rules | registry descriptors |

The registry remains inside the existing Scenario Runtime layer. No upward
dependency or cycle is introduced. Clinical Modules continue to compose
Exercise Definitions; Runtime does not inspect modules.

## Determinism and performance

- descriptors are registered and validated during engine initialization/reset;
- one immutable execution plan is built per reset, not per frame/tick;
- invocation uses explicit numeric phase order and validated sibling order;
- no registration timing, module load order, object/Map enumeration order,
  wall clock or randomness affects the plan;
- child activation is explicitly ordered and identity-validated;
- effect lists and returned events preserve their existing canonical ordering;
- the registry adds no polling, timer, graph reconstruction or deep clone loop;
- plan construction is `O(D log D)` for `D` descriptors; phase execution is
  `O(P)` plus the existing sibling sort for `P` active processes.

## Failure policy

Initialization/reset fails closed with typed diagnostics for:

- duplicate descriptor/process type;
- unknown configured or activated process type;
- missing required phase handler;
- conflicting singleton phase/order or serialization slot;
- repeated siblings without an explicit sibling order;
- duplicate process identity;
- invalid/missing parent identity or a root/child cycle;
- lifecycle result with changed identity, wrong encounter or invalid output;
- invocation that attempts direct Runtime mutation or lacks ownership
  attribution;
- any order that cannot be resolved without relying on insertion order.

During staged migration, an unmigrated process uses one explicit legacy path.
Registry and legacy code may never both mutate the same canonical process.
Optional shadow comparison must operate on cloned inputs, publish nothing and
have no access to event, snapshot or hash writers.

## Replay and hash contract

For every existing production replay fixture:

```text
before registry migration = after registry migration
```

Exact equality is required for RuntimeState/Snapshot, process states and
outputs, main process array, Botulism root/children, events and sequence order,
Timeline-derived evidence, vital events, assessment inputs, and:

- `stateHash`;
- `eventLogHash`;
- `processTreeHash`;
- `resourcePoolHash`;
- final `replayHash`.

Historical hashes are immutable migration baselines. Updating Golden fixtures
or expected hashes to accommodate registry ordering is forbidden.

Exercise Package and Exercise Definition hashes are unaffected because registry
migration changes neither content nor composition. Analytics hashes are
unaffected because canonical Runtime/Timeline inputs and provider ordering must
remain identical. Any change is a migration failure, not a new baseline.

## Zero-behaviour-change migration

### Stage 0 — Characterization baseline

Record current observable order and exact outputs/hashes for representative
HV-only, HV+Hypoxia, Hemorrhage and Botulism production fixtures. Existing
Golden expectations are not changed.

### Stage 1 — Registry shell

Add contracts, descriptor validation and immutable plan construction. Legacy
execution remains solely authoritative; registry shadow mode, if used, is
read-only.

### Stage 2 — First production migration: Hypoxia

Hypoxia is selected first because it has a genuine production baseline, a
bounded relative tick, existing handler, explicit sibling ordering and no
prepare/finalize hook. Preserve dynamic activation, parent identity and
post-aggregation tick evidence exactly.

### Stage 3 — Remaining leaves

Migrate HV and then Hemorrhage in separate checkpoints. HV includes advance,
input and finalize semantics; Hemorrhage proves preparation and generated-event
phases. After each process, compare legacy and registry execution exactly.

### Stage 4 — Botulism root

Migrate absolute-time root advance, nested children and cross-process activation
without flattening or changing hash shape.

### Stage 5 — Remove legacy branches and freeze parity

Only after every production process passes parity may legacy lifecycle branches
be deleted and the registry-backed plan become sole authority. Run the complete
Golden, Runtime Hardening, replay, Analytics and cross-Node hash suites with
unchanged limits and fixtures.

Respiratory Failure integration is a later new-behaviour checkpoint. It is not
part of parity proof.

## Architecture review questions answered

1. **Current lifecycle:** documented in the inventory, matrix and phase orders above.
2. **Process-specific parts:** bootstrap/activation, HV advance/input/finalize,
   Hemorrhage prepare/events, Hypoxia siblings/evidence and Botulism root/input.
3. **Observable parts:** every state/output, process/root array, phase event,
   sequence, aggregation input, snapshot and hash input identified above.
4. **Minimum abstraction:** the seven evidence-justified optional lifecycle
   phases plus explicit order/serialization metadata.
5. **Legacy ordering:** explicit numeric phase/slot metadata and validated
   sibling ordering, never registration/name order.
6. **Clinical-state owner:** each typed PatientProcess.
7. **Write authorization:** `RuntimeOwnershipResolver` only.
8. **Event semantics:** PatientProcess/adapters; Scenario Runtime records them;
   registry owns neither meaning nor sequence.
9. **Root/child preservation:** typed nested root, separate replay channel and
   explicit parented activation requests.
10. **Effect preparation:** existing Clinical Integration remains; Hemorrhage
    uses a narrow prepare adapter over the canonical active effect list.
11. **Aggregation authority:** unchanged Vital Sign and aggregation pipeline.
12. **Parity proof:** staged side-by-side exact assertions and immutable hashes.
13. **First migration:** Hypoxia, because it is the smallest genuine production
    baseline without prepare/finalize semantics.
14. **Legacy deletion:** only after all production descriptors pass exact parity
    and full hardening/hash suites.
15. **WP-36 unblock:** only after Stage 5 is committed, CI is green on the full
    Node matrix, and registry is the sole byte-identical production authority.

## Cardiac Arrest boundary

`CARDIAC_ARREST_V1`, cardiac physiology, rhythms, CPR, defibrillation and ROSC
are not part of registry migration. WP-36 remains blocked even though this ADR
is accepted. It may resume only when Stage 5 parity is proven and frozen.

## Consequences

### Positive

- PatientProcess becomes a real end-to-end production extension point;
- Runtime remains disease- and module-unaware;
- ownership, aggregation, event and replay authorities remain unchanged;
- migration can be reviewed and reverted one process at a time.

### Cost and risk

- the migration is deliberately multi-stage;
- explicit legacy order metadata is retained even where another order appears
  cleaner;
- Botulism and HV require richer adapters than a simple tick callback;
- no new clinical capability can use the registry until parity is complete.

## Acceptance decision

The revised architecture represents every current production lifecycle
responsibility, explicitly preserves observable ordering and defines a
fail-closed, incremental, zero-new-functionality migration. It introduces no new
canonical owner, Runtime layer or dependency direction.

ADR-017 is therefore **ACCEPTED for lifecycle-registry migration**.

This acceptance does not accept an implementation, change a replay baseline or
unblock WP-36. Any implementation that cannot keep existing canonical outputs
and hashes exactly identical violates this decision and must stop.
