# WP-39A – Exercise Creation & Reset UI Integration

## Status

Implemented. Automated verification is complete; device verification is recorded below.

## Architecture gate

| Question | Result |
| --- | --- |
| Canonical reset authority | `services/runtime/exercise/ExerciseResetService` |
| Existing authority suitable without redesign | Partial: reset was canonical, but package binding, historical reports and persistence required application orchestration |
| Active Package binding existed | No supported end-to-end preparation path existed |
| `COMPLETED → READY` was supported | Yes at service level; now restricted explicitly to `COMPLETED` |
| Completed-history preservation existed | Snapshot only; Debrief, Analytics and Protocol Assessment were not retained together |
| Runtime contract changed | No |
| Dependency direction changed | No |
| ADR required | No; this uses frozen extension points and existing authorities |

## Lifecycle and ownership

```text
COMPLETED exercise
        ↓
ExercisePreparationService
        ├── validates controller intent, version and active package
        ├── captures immutable completed evidence
        ├── binds exact package/protocol/module composition
        └── delegates canonical reset
                    ↓
ExerciseResetService
                    ↓
new canonical READY snapshot
                    ↓
normal Exercise Controls Start command
                    ↓
RUNNING
```

`ExercisePreparationService` is an application-level orchestration service. It does not write Runtime internals. Canonical lifecycle mutation remains owned by `ExerciseResetService`, while Package Loader remains the package-binding authority.

## UX

The ExCon dashboard shows **Prepare New Exercise** only when the current exercise is `COMPLETED`.

- An active compatible package shows its exact name and version.
- No active package shows an explicit link to the Exercise Catalog.
- Preparation creates `READY`; it does not start the exercise.
- Existing Exercise Controls remain the only normal path from `READY` to `RUNNING`.
- A pending guard prevents repeated taps.
- Typed validation failures are displayed without publishing a partial exercise.

## Canonical binding and persistence

The new exercise stores and restores the exact `packageId@packageVersion`. Package Loader resolves the configured protocol provenance and clinical module composition in deterministic order. Shared/local persistence now also retains:

- exact Exercise Package reference;
- completed exercise archives;
- reset audit entries.

On restore, the current exercise identity and exact Package binding are installed before the canonical session snapshot is restored. A `READY` exercise therefore remains the same `READY` exercise after restart and does not fall back to the default package.

## Historical preservation

Before reset, the completed exercise is captured as an immutable archive containing:

- final canonical snapshot;
- Debrief report;
- Analytics report;
- Protocol Assessment report, when available.

The new exercise receives clean per-exercise working data. Historical archives remain separate from the active exercise and are serialized with shared state. The archive service is the preservation boundary; no completed report is recalculated from the new exercise.

## Atomicity and idempotency

- Duplicate `commandId` values return the original result.
- `RUNNING`, `PAUSED` and `READY` replacement attempts are rejected before mutation.
- Package compatibility and composition are validated before canonical reset.
- A binding failure publishes no new snapshot.
- A reset failure removes the provisional package binding and publishes no new snapshot.
- The single synchronization publication happens only after successful archive, cleanup and canonical preparation.

## Failure diagnostics

The service exposes stable failure codes for active exercise, invalid lifecycle, missing/incompatible package, binding/protocol/module failures, version conflict, authorization, persistence and runtime initialization. UI messages are derived from those typed outcomes.

## Known boundary

WP-39A binds the package's canonical `patientDatasetId`, protocol provenance and module composition. The repository does not yet contain a general package patient-dataset materializer; existing normal reset fixtures remain the data source used by reference packages. No package-specific dataset bypass was introduced in this work package.

## Verification

Automated checks:

- TypeScript: PASS
- ESLint: PASS
- `git diff --check`: PASS
- Jest: 74 suites, 397 tests PASS
- Runtime Hardening: PASS
- Golden regression: PASS
- exact ALS protocol/module provenance: PASS
- repeated command idempotency and atomic failure paths: PASS
- archive immutability and deterministic ordering: PASS
- exact `READY` package restoration: PASS

## Manual verification

### Android emulator — PASS

The normal product flow was completed without direct state or Supabase changes:

1. disposable Botulism exercise completed through ExCon controls;
2. `ALS Generic Protocol Reference Package` confirmed active;
3. **Prepare New Exercise** created one new `READY` exercise;
4. exact `ALS_GENERIC_V1@1.0.0` provenance and deterministic Airway/Cardiac Arrest/Medication Core/ALS composition confirmed;
5. application restart restored the same `READY` exercise and package;
6. existing Start control produced `RUNNING`;
7. P01 Inspector showed `ARREST`, `PEA`, `NON_SHOCKABLE`, CPR state and shock-attempt count;
8. CPR start/stop and defibrillation attempt updated canonical snapshots;
9. Timeline contained Exercise start, cardiac arrest, rhythm observation, CPR start/stop and defibrillation facts in canonical order;
10. WP-38 produced `EXPECT-CPR = MET` and `EXPECT-SHOCK = NOT_APPLICABLE` for the non-shockable rhythm;
11. WP-39 produced completion `100%` and satisfaction `100%` for one assessable expectation;
12. Metric → Assessment Result → Timeline/Intervention evidence drill-down was verified;
13. Analytics and Debrief displayed the same neutral descriptive data without Score, grade, pass/fail or performance language.

The practical run also exposed and fixed two correctness defects: stale expected versions in ExCon control commands, and the false substring match `NON_SHOCKABLE → SHOCKABLE`. Cardiac reference bootstrap facts are now published to the canonical Timeline so assessment evaluates real product evidence rather than test-only fixtures.

### Physical Android — PARTIAL

Verified on device `D8TNU20630101957` through the current development build:

- bundle loaded over ADB USB forwarding;
- login and normal ExCon navigation;
- synchronized `RUNNING` exercise;
- exact ALS package, protocol provenance, module composition and capabilities;
- P01 Timeline showed canonical cardiac arrest and PEA/non-shockable rhythm facts.

The full phone-side intervention flow could not be claimed. A Scenario Runtime created on the emulator is device-local, so the phone Inspector correctly had shared Timeline data but reported `Canonical runtime pending`. Inspector back-navigation then triggered a device-specific native `react-native-screens` `ViewGroup.dispatchAttachedToWindow` `NullPointerException` on this older Huawei Android build. No architecture bypass or direct-state workaround was added. Emulator end-to-end verification remains complete; physical verification is explicitly partial.

No development bypass, direct Runtime write, Supabase edit or `ExerciseResetService` bypass was used.
