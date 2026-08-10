# ADR-017 Architecture Review

**Review date:** 2026-08-10  
**Reviewed proposal:** ADR-017 — Canonical PatientProcess Lifecycle Registry  
**Baseline commit:** `9823a3f`  
**CI:** PASS — Runtime Hardening and Analytics hash stability on Node 20, 22, 24 and 26  
**Verdict:** **REVISE BEFORE ACCEPTANCE**

## Executive finding

The architectural intent is sound: a registry inside the existing Scenario
Runtime layer can turn PatientProcess into a real production extension point
without introducing a new canonical owner or dependency direction.

ADR-017 is not yet precise enough to guarantee a behaviour- and hash-identical
migration. The proposed registry currently generalizes less than the production
orchestrator actually does, while its proposed canonical ordering differs from
the current observable replay ordering. Implementation must not begin until the
ADR closes these gaps.

## Review questions

| Question | Finding |
|---|---|
| Does the registry only generalize existing lifecycle behaviour? | **Not yet proven.** `bootstrap` and `tick` do not cover effect preparation, generated events, parent/child lifecycle and existing special orchestration. |
| Is deterministic ordering unambiguous? | **Specified but incompatible with the current hash contract.** The proposed order differs from current process-tree and event ordering. |
| Is ownership preserved? | **Preservable with explicit constraints.** The registry must not infer, replace or broaden ownership from `processType`; existing `moduleId` and ownership rules remain authoritative. |
| Can existing processes migrate with identical replay/hash? | **HV and Hypoxia are feasible; Hemorrhage and Botulism require a richer adapter contract.** Byte identity is not possible if the proposed new array/event order is applied directly. |
| Can Respiratory Failure migrate with the same production replay/hash? | **No production baseline exists.** It is not currently integrated into `ClinicalScenarioEngine`; integration is new behaviour and must occur after the parity migration. |

## Current canonical behaviour that must be preserved

### Storage and lifecycle

`ClinicalScenarioEngine` currently stores:

- one primary HV process;
- Hypoxia processes in a map, exposed in `processId` order;
- one optional Hemorrhage process;
- one optional Botulism root whose children are held inside the root.

Bootstrap and tick semantics differ:

- HV bootstrap is mandatory and is also adapted from Botulism respiratory data;
- Hypoxia may be explicit, threshold-triggered or activated from Botulism;
- Hemorrhage applies a sorted active-effect set before ticking and returns
  process events;
- Botulism root ticks using absolute target simulation time, not tick duration,
  and owns an internally sorted child tree.

A generic registry must preserve these semantics; it must not normalize them
into a new behaviour merely to make the interface uniform.

### Observable ordering

Current observable process order is effectively:

```text
primary HV
→ Hypoxia by processId
→ optional Hemorrhage
```

Botulism root is hashed separately from that process list, and its children are
sorted by `processId` inside the root.

Current tick/event phases are also observable. Hemorrhage-generated events are
logged during its tick before aggregation; Hypoxia tick events are logged after
aggregation; the primary `ENGINE_TICK_APPLIED` event follows them.

ADR-017 currently proposes:

```text
processType
→ processId
→ instanceKey
```

This would place Hemorrhage before HV/Hypoxia and would alter arrays included in
`processTreeHash`. `stableJson` canonicalizes object keys but intentionally
preserves array order. Reordering process arrays or generated events therefore
changes `processTreeHash`, `eventLogHash` and the final replay hash even if the
clinical state is identical.

## Required ADR amendments

### 1. Separate execution order from canonical serialization order

ADR-017 must define three independent orders and must not assume one comparator
is valid for all of them:

1. **execution order** — preserves current bootstrap/tick/effect phase order;
2. **aggregation input order** — may be normalized only where the existing
   aggregation already normalizes it internally;
3. **serialization/replay order** — preserves the current process-tree and event
   array contract during migration.

The migration phase must use explicit legacy-compatible ordering metadata or an
equivalent deterministic adapter. A new preferred ordering may be adopted only
through a separately reviewed replay/hash migration, not hidden inside ADR-017.

### 2. Expand the driver result, not its authority

The proposed `bootstrap`/`tick` pair is insufficient. The driver contract needs
to return factual process events without logging or sequencing them itself:

```ts
type PatientProcessTickResult = Readonly<{
  process: ClinicalProcessRuntime;
  events: readonly PatientProcessEvent[];
}>;
```

Scenario Runtime must remain the owner of canonical event sequence assignment,
Timeline publication and replay logging. A driver must not write the event log,
RuntimeState, snapshots or hashes.

Effect routing remains owned by `ClinicalIntegrationFramework` and
`ClinicalProcessRegistry`. Where an existing process currently consumes an
active effect set before tick (Hemorrhage), ADR-017 must specify a narrow
compatibility adapter or a general process-input phase. It must not create a
second Clinical Effect pipeline.

### 3. Define bootstrap input and activation explicitly

The registry must distinguish:

- fixture/bootstrap configuration;
- runtime child-process activation;
- parent reference (`processId`, `processType`, `instanceKey`);
- absolute simulation time versus elapsed tick duration.

Unknown process types, duplicate process identities, invalid parent references
and ambiguous drivers must fail closed before state publication.

### 4. Preserve ownership independently of lifecycle registration

Lifecycle registration grants no field ownership. The following must remain
binding:

- `ProcessOutput.moduleId` identifies the writer evaluated by
  `RuntimeOwnershipResolver`;
- every new `runtimeContribution` field requires one explicit ownership rule;
- contributor acceptance remains in the existing resolver and aggregation
  pipeline;
- registry presence cannot authorize a direct Runtime write;
- duplicate `processType` driver registration fails closed but is not an
  ownership decision.

Adapters must preserve existing `processId`, `moduleId`, contribution fields,
priorities, `observedAtSec` and status exactly.

### 5. Define the process runtime public contract

`ClinicalProcessRuntime` is currently a closed union. ADR-017 must choose and
document one approach:

- extend that union for every new canonical process; or
- introduce a minimal immutable base runtime contract plus typed driver-owned
  state.

The second option is more extensible but is a public contract change and must be
part of the accepted ADR. Unsafe casts or `Record<string, unknown>` process state
must not replace typed process ownership.

### 6. Keep root orchestration explicit

Botulism root is not equivalent to a flat leaf process. The ADR must state
whether roots use a dedicated `PatientProcessRootDriver` capability or whether
the lifecycle contract natively supports immutable child trees. Flattening the
root or changing parent/child hash shape is forbidden during parity migration.

## Process-by-process migration assessment

| Process | Feasibility | Byte-identical conditions |
|---|---|---|
| HV | High | Preserve mandatory bootstrap, timed transitions, event timing, IDs, outputs and primary position. |
| Hypoxia | High | Preserve dynamic activation, parent metadata, map ordering and post-aggregation tick events. |
| Hemorrhage | Medium | Preserve pre-tick active-effect preparation, returned-event order, optional position and exact output fields. |
| Botulism root | Medium/High | Preserve absolute-time tick semantics, nested children, root separation in process-tree hash and special activation paths. |
| Respiratory Failure | Separate integration | No existing production ScenarioEngine replay hash exists; retain isolated tests, then add it only after migration parity is frozen. |

## Required migration checkpoints

ADR implementation should be split from WP-36 clinical work:

1. **Characterization checkpoint**  
   Record current state, event log, patient processes, process tree and all hash
   outputs for representative HV-only, HV+Hypoxia, Hemorrhage and Botulism
   fixtures. Do not change expected values.

2. **Registry shell checkpoint**  
   Add duplicate/unknown-driver validation with no production lifecycle routed
   through it. All hashes remain identical.

3. **Leaf migration checkpoints**  
   Migrate HV, then Hypoxia, then Hemorrhage separately. After each step require
   exact equality for Runtime state, process outputs, event arrays, process tree,
   snapshot publications and all hashes.

4. **Root migration checkpoint**  
   Migrate Botulism root and children without flattening or reordering.

5. **Canonical collection checkpoint**  
   Only after all adapters are byte-identical may the registry-backed collection
   become the production source for aggregation, publication and replay.

6. **New capability checkpoint**  
   Integrate Respiratory Failure and later Cardiac Arrest as new behaviour in
   separate commits and tests. Never combine parity migration with new clinical
   physiology.

## Mandatory parity assertions

For every migrated existing fixture, old and registry-backed execution must be
compared in the same test process and must produce exact equality for:

- `RuntimeState`;
- all `ProcessOutput` values and array order;
- PatientProcess state and parent/child tree;
- factual events, sequence numbers and event order;
- Runtime Snapshot publication content;
- vital-sign events;
- assessment/debrief inputs where produced;
- `stateHash`;
- `eventLogHash`;
- `processTreeHash`;
- `resourcePoolHash`;
- final `replayHash`.

The migration must not change Golden fixtures, historical expected hashes,
timeouts, event counts, Runtime Hardening budgets or Analytics hash checks.

## Ownership conclusion

Ownership can remain intact because the proposed registry belongs to lifecycle
orchestration, not state authority. This is true only if the accepted ADR makes
the separation explicit and retains `RuntimeOwnershipResolver` as the sole
authorization boundary for process runtime contributions.

## Final recommendation

ADR-017 should remain **PROPOSED** and WP-36 should remain blocked.

Revise ADR-017 to include:

- separate execution, aggregation and serialization ordering contracts;
- event-producing but non-logging driver results;
- explicit bootstrap/activation/parent-time semantics;
- ownership non-authority rules;
- a typed public process runtime decision;
- root-process support;
- the staged byte-identical migration checkpoints above.

After those revisions, perform a second architecture review. Only then should
ADR-017 be accepted and implemented. Cardiac Arrest implementation must remain a
subsequent work package, not part of the registry migration.
