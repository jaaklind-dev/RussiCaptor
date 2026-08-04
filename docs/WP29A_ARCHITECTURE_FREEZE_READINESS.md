# WP-29A — Architecture Freeze Readiness

## Outcome

WP-29A resolves only AR-01, AR-02 and AR-03 from the v0.7 Architecture Review.
No feature, UI, clinical behavior, ordering, hash contract or performance limit
was changed. The review status advances to **READY FOR ARCHITECTURE FREEZE v0.7**.

## 1. Runtime dependency cycle

The aggregation implementation now lives in neutral
`RuntimeAggregationCore`. `AlignedRuntimePipeline` depends on that core, while
`RuntimeAggregationPipeline` remains a one-way compatibility facade preserving
the existing public API. The former two-way import is gone.

An automated source-graph test resolves all `@/` imports across TypeScript/TSX
modules and fails on any cycle. The verified graph contains zero cycles.

```text
RuntimeAggregationPipeline (compatibility facade)
        ↓
AlignedRuntimePipeline
        ↓
RuntimeAggregationCore
```

## 2. True Snapshot immutability

Runtime and Exercise Snapshot boundaries use a shared recursive immutable clone.
Published state is detached from input references and recursively frozen. Public
Runtime Snapshot types expose `DeepReadonly` state, and every getter returns a
deeply frozen value.

Mutation tests cover:

- top-level Runtime state;
- nested runtime fields;
- process collections;
- source-object mutation after publication;
- canonical Exercise Snapshot mutation;
- retrieval after attempted mutation.

Timeline, Debrief and Analytics immutability tests remain green and unchanged.

## 3. Single Package binding authority

The independent Definition binding map and public Definition binding API were
removed. `ExercisePackageLoader` now owns the only binding map and validates and
loads the Package before publishing a binding. Runtime, Analytics, Dashboard and
Debrief derive the Exercise Definition directly from the bound Package.

Binding the identical Package again is deterministic and idempotent. Binding a
different Package to an already bound exercise is rejected before the conflicting
Package is registered. Legacy Package compatibility behavior remains unchanged.

```text
ExercisePackage
        ↓
ExercisePackageLoader.bind()
        ↓
canonical Package binding
        ↓
Package.definition
        ↓
Runtime / Analytics / read-only projections
```

## Determinism and regression verification

- WP-28 Package hash is fixed at
  `c6ff142e1cfbdcb37757f159fbbd95128f9ee4a961972d22264c44317b6e803d`.
- WP-27 Definition hash is fixed at
  `b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b`.
- Existing Runtime Hardening, Golden Replay and Analytics hash suites pass without
  expectation or timeout changes.
- Timeline, metric and evidence ordering code is unchanged.
- The full suite contains 53 passing suites and 268 passing tests.

## Remaining review debt

AR-04 through AR-12 remain documented in the Architecture Review and are outside
WP-29A. No opportunistic refactoring was performed.
