# WP-24A — Canonical Exercise Clock Integrity

## Outcome

WP-24A establishes deterministic validation, legacy detection, migration metadata,
and an explicit reset boundary for the canonical Exercise Clock. It changes no
clinical behavior, timeline schema, analytics, or replay semantics. Historical
snapshots are detected and displayed exactly as stored; they are never normalized
or rewritten automatically.

## Ownership and version

The authoritative Exercise Runtime remains the only owner of lifecycle, simulation
time, and speed. Canonical newly initialized snapshots use `clockVersion: 2` and
record initialization at simulation time zero. Missing version, version 1, or
missing v2 initialization metadata is treated as legacy/migration information.

```text
Authoritative Exercise Runtime
             ↓
Canonical Exercise Clock v2
             ↓
     Exercise Snapshot
             ↓
       Debrief / UI
```

## Integrity validator

`ExerciseClockIntegrityValidator` is pure and read-only. It validates finite
non-negative time, lifecycle, speed, supported clock version, initialization
metadata, owner identity, monotonic progression, and completed-clock immutability.
It returns stable typed diagnostics and migration status without mutation.

## Controlled reset

The explicit reset service:

- requires Exercise Controller authorization and expected-version matching;
- requires a distinct non-empty new exercise ID;
- rejects RUNNING and PAUSED exercises;
- preserves a COMPLETED snapshot in the historical archive;
- creates a new READY v2 snapshot at T+0 and speed ×1;
- is idempotent by command ID and emits a typed accepted/rejected audit result.

It does not clear or rewrite historical replay. Broader clinical-data cleanup remains
outside this clock-integrity service.

## Replay compatibility

`clockVersion` and clock-initialization metadata are informational migration fields.
They are excluded from existing Exercise Control and Debrief source hashes. Tests
prove that adding v2 metadata to otherwise identical state does not alter these
hashes. No historical timeline event is injected.

## Known limitations

Legacy snapshots may contain excessively large `simulationTimeSec` values. They
remain immutable and are shown with a **Legacy Exercise Clock** badge. This work
package detects but does not infer a corrected time. Reset prepares a distinct new
exercise; it is not an in-place repair of historical data.

