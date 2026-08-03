# WP-22 – ExCon Exercise Controls

## Outcome

WP-22 introduces a single canonical exercise lifecycle and an authoritative ExCon command path. The Exercise Dashboard can start, pause, resume and complete an exercise, and select deterministic speeds ×1, ×2 and ×4. Case Manager views only project the canonical state and time.

## Architecture

```text
ExCon controls
  → typed ExerciseControlCommand
  → validation + idempotency + version check
  → AuthoritativeExerciseRuntime
  → canonical Exercise Snapshot
  → clock targets / scenario events
  → persistence + realtime subscription
  → read-only Instructor and CM views
```

The canonical snapshot contains `READY | RUNNING | PAUSED | COMPLETED`, simulation seconds, speed, command version and last command ID. Wall-clock metadata is excluded from replay hashing. Legacy `ExerciseSession` remains a read-only compatibility projection for existing workflow services.

Only an installed ExCon runtime owner starts the clock. Restoring a remote snapshot on a CM device never starts another clock. Clock ticks advance simulation time but do not change the control-plane version token.

## Safety and command semantics

- Commands are validated for active exercise, issuer, transition, payload, speed and expected version.
- Repeating the same `commandId` returns the original result and creates no second audit record or runtime event.
- Missing runtime ownership, stale versions and malformed or unauthorized commands are rejected without mutation.
- Patient event injection is accepted only while the exercise is `RUNNING`; READY, PAUSED and COMPLETED have stable rejection codes.
- COMPLETE is final and requires UI confirmation. No reset, rewind, skip or arbitrary time controls were added.

## Determinism

Exercise control audit entries contain the command, issuer, simulation time, previous/resulting state and speed, outcome, event type or rejection code. The replay hash uses the canonical snapshot and ordered audit entries, excluding wall-clock metadata. Identical command sequences produce identical hashes.

## Verification

- TypeScript: PASS
- ESLint: PASS
- `git diff --check`: PASS
- Automated tests: 219 PASS (43 suites)
- Runtime Hardening: PASS under the existing limit
- Golden regression suites: PASS
- Exercise lifecycle, speed, clock freeze, idempotency, authorization, version conflict and replay hash: PASS
- Patient injection lifecycle gate: PASS
- Android physical device + emulator: canonical PAUSED state propagated from ExCon to the CM read-only card without a second device clock

The manual two-device run exposed and fixed two integration defects: clock ticks initially invalidated the command concurrency version, and remote restore initially started a clock on CM devices. Neither workaround changes Runtime Hardening thresholds or replay checks.
