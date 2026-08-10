# ADR-017 — Canonical PatientProcess Lifecycle Registry

**Status:** Proposed  
**Date:** 2026-08-10  
**Decision owners:** RussiCaptor architecture maintainers  
**Related decisions:** Architecture v0.7 Freeze; ADR-016 — Clinical Module Composition

## Context

Architecture v0.7 explicitly permits new PatientProcesses, Clinical Effects and
contributors. The production `ClinicalScenarioEngine`, however, currently owns
bootstrap, tick, storage, aggregation inclusion, snapshot publication and replay
hash participation through process-specific fields and branches. The
`ClinicalProcessRegistry` only routes Clinical Effects to processes that have
already been created; it is not a lifecycle extension point.

WP-36 is the first post-freeze capability that requires a new process to
participate in the complete production runtime. Adding direct
`cardiacArrestProcess` storage and `if (cardiacArrest)` branches would preserve
short-term behaviour but contradict the frozen rule that Runtime must remain
disease-agnostic. An isolated process implementation would not be canonical
because Exercise activation, ticks, aggregation, Timeline and replay would not
execute it.

## Decision drivers

- preserve a single canonical Scenario Runtime owner;
- make the documented PatientProcess extension point real end to end;
- prohibit disease-specific ScenarioEngine branching;
- preserve dependency direction and the existing clinical runtime layer order;
- preserve deterministic ordering, immutable snapshots and replay hashes;
- allow Cardiac Arrest and later processes without repeated Runtime edits.

## Proposed decision

Introduce one canonical, deterministic `PatientProcessLifecycleRegistry` inside
the existing Scenario Runtime layer. It is not a new runtime layer and does not
own clinical state. It registers process drivers by exact `processType`.

A driver should provide only the lifecycle operations required by the existing
orchestrator:

```ts
type PatientProcessDriver = Readonly<{
  processType: string;
  bootstrap(input: PatientProcessBootstrapInput): ClinicalProcessRuntime;
  tick(process: ClinicalProcessRuntime, tickSeconds: number): PatientProcessTickResult;
}>;
```

The final contract names may follow repository conventions. The semantic rules
are binding:

1. the PatientProcess remains the sole owner of its clinical state;
2. drivers are registered once and duplicate `processType` fails closed;
3. bootstrap and tick inputs use simulation time only;
4. active processes are stored as one deterministically ordered collection;
5. all process outputs flow through the existing Vital Sign Engine and
   aggregation pipeline;
6. Clinical Effects continue through `ClinicalIntegrationFramework` and
   `ClinicalProcessRegistry`;
7. snapshot, process-tree hash and replay hash include the same canonical sorted
   process collection;
8. the registry contains no module lookup and Runtime remains unaware of
   Clinical Module composition;
9. unknown process types and invalid configurations fail closed with typed
   diagnostics;
10. no process driver may write RuntimeState directly.

The lifecycle registry belongs to Scenario Runtime and may depend downward on
PatientProcess contracts. PatientProcesses must not depend upward on the
registry or ScenarioEngine.

## Deterministic ordering

All lifecycle operations use a stable order:

```text
processType
→ processId
→ instanceKey
```

Generated events use the existing canonical sequence assignment after this
ordering. No registry insertion order, `Map` insertion order, wall clock or
random value may influence state, events or hashes.

## Migration boundary

Migration must be behaviour-preserving and staged:

1. protect current HV, Hypoxia, Hemorrhage and Botulism outputs, events,
   snapshots and hashes with unchanged regression fixtures;
2. introduce the registry and adapters for existing processes;
3. make the canonical sorted process collection feed aggregation, snapshot
   publication and replay hashing;
4. remove process-specific lifecycle branches only after byte-identical replay
   evidence passes;
5. add new process types only after the migration baseline is green.

Historical Golden fixtures and expected hashes must not be updated to conceal a
behaviour change. If byte-identical migration is not possible, implementation
must stop and the difference must be reviewed as a separate architecture
decision.

## Alternatives considered

### Add cardiac-specific fields and branches to ScenarioEngine

Rejected. It makes the documented PatientProcess extension point incomplete,
adds disease knowledge to Runtime and repeats for every future process.

### Implement Cardiac Arrest as an isolated library only

Rejected. It cannot participate in canonical activation, aggregation, Timeline,
Debrief or replay and would falsely advertise production capability.

### Create a separate Cardiac Runtime

Rejected. It introduces a second canonical owner and violates Architecture v0.7.

### Put lifecycle creation into Clinical Modules

Rejected. Runtime would become module-aware and dependency direction would be
reversed. Clinical Modules must compose canonical definitions, not mutate
Runtime.

## Consequences

### Positive

- future PatientProcesses use a genuine frozen extension point;
- Scenario Runtime remains disease-agnostic;
- one sorted collection becomes the canonical source for aggregation and replay;
- WP-36 can be implemented without a parallel owner or cardiac-specific Runtime
  branch.

### Cost and risk

- existing process orchestration must migrate under strict hash and Golden
  regression protection;
- the closed `ClinicalProcessRuntime` union may need a compatible base contract
  or registry-safe generic representation;
- ScenarioEngine is high-risk code and the migration must not be combined with
  new cardiac physiology in the same unverified step.

## Acceptance criteria for ADR implementation

- no new architectural layer or dependency direction;
- one canonical sorted PatientProcess collection;
- duplicate/unknown drivers fail closed;
- existing Clinical Effect and contributor paths remain unchanged;
- existing Runtime Snapshot schema remains unchanged;
- all current Golden, Runtime Hardening and Analytics hash tests pass unchanged;
- repeated replay produces identical process trees, events, snapshots and
  hashes;
- no timeout or determinism check is weakened;
- Architecture v0.7 documentation is updated to name the lifecycle registry as
  the implementation of the existing PatientProcess extension point.

## Decision

This ADR is **PROPOSED**, not accepted. WP-36 implementation remains blocked
until the architecture maintainers accept this decision and authorize the
behaviour-preserving lifecycle-registry migration.
