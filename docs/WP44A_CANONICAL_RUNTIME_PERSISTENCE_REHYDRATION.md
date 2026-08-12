# WP-44A — Canonical Runtime Persistence & Rehydration

## Status

Implemented as a persistence boundary over Architecture Freeze v0.7. This work adds no clinical rule, process type, runtime layer, scoring rule, or remote synchronization authority.

## Architecture gate

| Area | Finding |
|---|---|
| Canonical Runtime Snapshot | Extension required: the read-only UI snapshot was insufficient for continuation. `ClinicalScenarioEngine` remains the canonical owner and now exposes a data-only capture boundary. |
| PatientProcess serialization | Sufficient: registered process runtimes are immutable serializable data. Serialization order comes exclusively from `PatientProcessLifecycleExecutionPlan`. |
| Clinical effects | Extension required: effect/idempotency state in intervention, medication and clinical-integration runtimes is now included. |
| Intervention continuity | Extension required: pending, active, completed, allocated instance and resource state now have explicit restore boundaries. |
| Simulation clock | Sufficient: canonical exercise clock remains in `CanonicalExerciseSnapshot`; the patient engine's exact simulation time is persisted and identity-checked. |
| Event continuation | Extension required: event log, resource log, applied input IDs and next sequence are persisted. History is restored, never replayed. |
| Storage | Extension required: the existing offline-first application state file now carries runtime artifacts. Supabase authority and synchronization semantics are unchanged. |
| ADR | No. The frozen layers and ownership rules are unchanged; this implements the already-required snapshot/replay contract. |

## Canonical ownership inventory

Authoritative and persisted:

- registered PatientProcess runtime objects, including state, elapsed time, output/contributors, effect IDs and process identity;
- canonical `RuntimeState`, including `VitalSignState`;
- engine simulation time, pending timed transitions, event sequence and processed input IDs;
- resource pool and intervention pending/active/completed state;
- clinical intervention instances, clinical-integration idempotency state and factual events;
- airway, circulation and medication runtime state;
- assessment rule configuration and canonical vital-sign events.

Derived and not independently authoritative:

- UI runtime projections and compatibility vital projections;
- resource/assessment developer cards;
- replay hashes (recomputed from restored canonical content);
- active effects generated for a tick from persisted intervention/medication state.

Ephemeral and intentionally not persisted:

- listeners, subscriptions, timers, registries, class instances and function references;
- memoized UI state and debug subscribers.

## Persisted artifact

`PersistedRuntimeState` schema version `1` contains exact exercise, patient, package, definition and clinical-module composition provenance; a canonical payload; and a SHA-256 payload hash. The payload is plain serializable data. It never captures a live object graph.

Capture order for process runtimes is resolved by the production lifecycle registry. Rehydration checks every process type against that same registry. There is no disease/process-specific restoration switch.

## Rehydration sequence

1. Restore and bind the exact exercise package and patient materialization.
2. Validate schema, payload hash, exercise/patient identity and package/definition/module provenance.
3. Validate process registration, unique identities, encounter consistency and event sequence.
4. Build a candidate engine state without executing historical clinical events.
5. Restore resource/intervention/effect/idempotency state.
6. Publish the canonical runtime snapshot only after validation succeeds.
7. Re-register the runtime owner and resume the existing exercise clock only when lifecycle state is `RUNNING`; `PAUSED` remains paused, `READY` remains materialized, and `COMPLETED` is not made live.

Validation failure is fail-closed. It does not fall back to a fresh fixture bootstrap and does not publish a partially restored engine.

## Checkpoint policy and loss window

The existing local save coordinator remains the single offline-first persistence writer. Canonical exercise clock ticks and supported mutations issue sync notifications; saves are serialized and coalesced by the existing save chain. The state file is written through a temporary file and moved into its canonical location.

Known loss window: at most the interval between a runtime mutation and the next local sync notification; normal running exercises notify every clock tick (one wall-clock second). Pause and exercise-control commands force a notification. No second timer or polling loop was introduced.

## Local and remote authority

Runtime continuation state is local authoritative device state in WP-44A. Supabase continues to synchronize the existing shared exercise/domain projection and is not turned into a second runtime engine. A remote state must pass the same revision/provenance guards before it can be accepted; last-write-wins merging of runtime payloads is forbidden. Multi-device canonical runtime leadership remains outside WP-44A.

## Failure diagnostics

Stable codes cover unsupported schemas, malformed artifacts, payload corruption, exercise/patient mismatch, package/definition/module mismatch, unknown process types and runtime invariant violations. Failures are explicit and never silently converted into a new exercise runtime.

## Compatibility and invariants

- Continuous and capture/destroy/rehydrate/continue execution must produce identical RuntimeState, process tree, event log and replay hash.
- Historical events are not duplicated.
- Applied event and intervention IDs remain idempotent.
- Restoration does not allocate timers or subscriptions; lifecycle ownership registers exactly once after successful restoration.
- Historical pelvic and pleural replay hashes remain canonical and unchanged.

## WP-45 readiness

### Technical two-patient reference

`Runtime Continuity Reference Package` is a catalog-visible technical reference used only for persistence and rehydration acceptance. It reuses the existing Pelvic Injury and Pleural Injury patient records, fixtures, resources, and clinical module configurations through the normal package materialization path. It is not a clinical scenario, protocol, assessment, or future Narva exercise.

WP-45 may add Exercise Package-driven process materialization on top of this boundary. It must supply exact package/definition/module provenance and use the lifecycle registry; it must not add a parallel persistence mechanism or process-specific restoration branch.
