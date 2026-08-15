# WP-36A — Patient Process Lifecycle Registry Migration

**ADR:** [ADR-017 — Canonical PatientProcess Lifecycle Registry](./ADR-017_PATIENT_PROCESS_LIFECYCLE_REGISTRY.md)  
**Scope:** zero-behaviour-change orchestration migration  
**Local status:** implementation complete; release freeze awaits commit, push and green Node 20/22/24/26 CI  
**WP-36 status:** **BLOCKED** until that release freeze is complete

## Migration invariant

No PatientProcess, Clinical Effect, intervention, physiology, rhythm or protocol
capability was added. Cardiac Arrest and Respiratory Failure production
integration remain outside this work package. Existing Runtime ownership,
aggregation, event recording, replay and serialization services remain
canonical and unchanged.

## Stage 0 baseline

`PatientProcessLifecycleBaseline-test.ts` records immutable observable baselines
for the four production paths. It protects complete engine hashes plus process,
event and Botulism child ordering.

| Path | Replay hash before and after migration |
|---|---|
| HV | `8077887e6452a4d4511ff6db7091e3e5e692a8b246b471ca3b90f90848dc5316` |
| HV + Hypoxia | `2d062055f4689ffa32ded768d6854d534fc78839fd373a5c6966202ebde568c3` |
| Hemorrhage | `3ac5e1797f03e094926a5c946767fccc143488475c8e3a5abeb2d7fb2185a81b` |
| Botulism root | `cb4ffc0a97be8732a31cff3cf865db5e58e14c0875469bcc2783417732ba8ae7` |

The protected values were captured before registry authority was introduced and
were not changed during migration. Existing Analytics, Exercise Package and
Exercise Definition stability tests remain the canonical guards for their
independent hashes.

## Lifecycle execution plan

The registry resolves once when `ClinicalScenarioEngine` is initialized. The
resolved plan and descriptors are recursively immutable. Registration order,
module import order, `Map` insertion order and process names are not execution
order inputs.

| Phase/domain | Explicit preserved order |
|---|---|
| Bootstrap | Botulism 100 → HV 200 → Hemorrhage 300 → Hypoxia 400 |
| Advance | Botulism absolute-time 100 → HV scheduled transition 200 |
| Input | Botulism input adapter 50; existing non-registry canonical orchestration remains outside process storage |
| Prepare | Hemorrhage 100 |
| Tick | HV 100 → Hypoxia 200 (`processId` siblings) → Hemorrhage 300 |
| Post-aggregate events | Hypoxia 100 → HV 200 |
| Finalize | HV oxygen-masking 100 |
| Aggregate/serialize | HV 100 → Hypoxia 200 → Hemorrhage 300 |
| Separate root | Botulism root, with its existing nested child order |

The engine now retains production processes in one lifecycle store. Descriptor
resolution supplies process selection and sibling ordering; process-type
specific storage branches and parallel mutation authority were removed.

## Process migration evidence

- **Hypoxia:** explicit bootstrap/dynamic activation, process-ID sibling order,
  tick, aggregation/serialization slots and post-aggregation evidence are
  registry driven.
- **HV:** bootstrap, scheduled advance, tick, post-aggregation evidence and
  oxygen-masking finalization are registry driven. Existing Clinical Integration
  remains the owner of effect routing.
- **Hemorrhage:** bootstrap, sorted Clinical Effect preparation, tick and
  pre-aggregation domain events invoke the existing process functions through
  the plan.
- **Botulism:** separate root bootstrap and absolute-time advance are preserved;
  root inputs, aspiration child activation and evidence use the descriptor. The
  nested root is never flattened.

## Ordering and ownership evidence

Registry unit tests independently protect descriptor order, sibling order,
aggregation-slot conflicts, registration-order independence, immutability and
fail-closed diagnostics. Exact event array positions and process-tree order are
also part of the four immutable production baselines.

The registry has no dependency on `RuntimeOwnershipResolver`, aggregation,
snapshot publication or event writers. It only returns existing process outputs
and evidence to `ClinicalScenarioEngine`. `aggregateRuntimeState(...,
RuntimeOwnershipResolver)` remains the only production authorization boundary;
an unauthorized or rejected output continues to fail the engine run.

## Verification

| Check | Result |
|---|---|
| Immutable four-path replay baselines | PASS |
| Full Jest suite | PASS after migration verification |
| Runtime Hardening, 10,000 ticks | PASS with unchanged limits |
| Golden HV/Hypoxia/Botulism/Hemorrhage regressions | PASS |
| Analytics hash stability | PASS |
| Package/Definition hash stability | PASS |
| Architecture Freeze readiness / dependency cycles | PASS; no new cycle |
| TypeScript | PASS |
| ESLint | PASS using no-cache invocation; Expo cache was not writable in the sandbox |
| `git diff --check` | PASS |
| Physical Android existing-exercise smoke test | PASS on `D8TNU20630101957` |

No Golden workbook, expected hash, Runtime Hardening threshold or timeout was
changed.

## Known limitations and freeze decision

- The lifecycle registry deliberately does not discover Clinical Modules or add
  Respiratory Failure to production runtime.
- Resource, Intervention, Airway, Circulation and Medication ordering remains
  adjacent canonical orchestration outside the PatientProcess registry.
- Physical Android `D8TNU20630101957` loaded the current Metro bundle and the
  historical v1 **Mimino Botulism 12 Patients** exercise. Resume, pause and resume
  produced the expected canonical Timeline events. P08 Patient Inspector
  rendered patient identity, assignment/state projection and Timeline; Debrief
  rendered 12 patients and 32 events. No new JavaScript Runtime warning/error or
  Scenario Runtime failure was observed. Cardiac Arrest was not attempted.
- The first control attempt from an already stale dashboard projection was
  correctly rejected with `Exercise snapshot version has changed`; reopening
  from the current canonical snapshot allowed the commands. This existing
  optimistic-concurrency behaviour is unrelated to the lifecycle migration.
- GitHub Actions cannot be verified before the work is committed and pushed.

Therefore the local migration and device verification are ready for review, but
**WP-36 remains BLOCKED**. It may be marked **UNBLOCKED** only after a deliberate
commit/push and green CI on Node 20, 22, 24 and 26.
