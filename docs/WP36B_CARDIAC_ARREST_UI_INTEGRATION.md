# WP-36B – Cardiac Arrest UI Integration

## Scope

WP-36B connects the existing Cardiac Arrest reference runtime to the ExCon presentation layer. It adds no physiology, rhythm algorithm, replay rule, protocol logic, or optimistic patient state.

## End-to-end path

```text
Active Cardiac Arrest reference package
  → existing exercise START command
  → ClinicalScenarioEngine reference fixture
  → canonical cardiac PatientProcess
  → RuntimeSnapshotService
  → Instructor Patient Inspector
```

ExCon CPR and defibrillation controls use the existing clinical intervention definitions. The UI waits for the canonical runtime snapshot; it never predicts CPR, rhythm, shockability, ROSC, or vital-sign outcomes locally.

## Role decision

The controls are placed in the existing ExCon Patient Inspector because this reference workflow is an instructor verification surface. This preserves the current role model and does not invent new authorization. A future CM treatment workflow may reuse the same command boundary after its existing role policy explicitly permits it.

## Presentation

The cardiac panel is rendered only when `CARDIAC_ARREST_V1` is present in the patient's canonical process projection. It shows cardiac state, rhythm, rhythm classification, CPR state, shock attempts, and the latest cardiac runtime event.

Accepted CPR/defibrillation commands create factual intervention timeline entries. Timeline and Debrief consume those existing entries and the canonical final snapshot; they do not infer or recalculate clinical outcomes.

## Failure behaviour

Commands fail closed with stable UI-facing codes:

- `UNAVAILABLE` – no authoritative cardiac runtime is registered;
- `INVALID_STATE` – the action is incompatible with the current canonical state;
- `RUNTIME_FAILURE` – the authoritative intervention path rejected the action.

Repeated `commandId` values are idempotent and return the stored result without creating another runtime event.

## Architecture confirmation

- No direct RuntimeState mutation from UI.
- No local rhythm or ROSC transition.
- No polling or duplicate runtime store.
- No changes to cardiac physiology, ownership, aggregation, replay hashing, or Golden expectations.

## Final manual verification status

`BLOCKED_BY_SINGLE_ACTIVE_EXERCISE_POLICY`

The application has no supported product flow for running a second disposable local exercise while the canonical exercise is `RUNNING` or `PAUSED`. The canonical `ExerciseResetService` explicitly rejects preparation of another exercise with `ACTIVE_EXERCISE`, and no parallel-exercise UI path exists.

The existing running exercise was not paused, completed, reset, replaced, or otherwise modified. The emulator verification therefore stopped before selecting or starting a disposable Cardiac Arrest exercise. This is an intentional exercise-lifecycle policy limitation, not a Cardiac Arrest runtime, UI-command, replay, or test failure. WP-36B does not change that policy.
