# WP-38 – Protocol Assessment Foundation

## Status

Implemented as a read-only layer over canonical Protocol Configuration, Debrief and Exercise Timeline artifacts. It determines whether explicit factual expectations are satisfied. It does not score, grade, recommend treatment or mutate simulation state.

## Architecture gate

| Gate | Result | Basis |
|---|---|---|
| Protocol Configuration extension | SUFFICIENT | WP-37 provides typed conditions, expected actions, temporal constraints and evidence requirements. |
| Debrief evidence model | SUFFICIENT | Immutable report identifies the exercise, patients, clock integrity, provenance and canonical Timeline. |
| Timeline evidence model | SUFFICIENT | Stable IDs, patient scope, simulation time, sequence number, event type and metadata support factual matching. |
| Analytics extension points | SUFFICIENT | Future providers can consume immutable assessment output; WP-38 does not alter Analytics. |
| Canonical Runtime contract change required | NO | No Runtime service is imported or written by the assessment engine. |
| Dependency-direction change required | NO | Runtime → Timeline/Debrief → Assessment remains downward. |
| ADR required | NO | Existing Architecture v0.7 extension points are used. |

## Data flow

```text
ClinicalProtocolConfiguration (expected)
                 +
DebriefReport / ExerciseTimelineEvent (happened)
                 ↓
        AssessmentEvidenceIndex
                 ↓
 condition → applicability → temporal matching
                 ↓
       ProtocolAssessmentReport
```

The engine accepts immutable artifacts, builds indexes once, and returns a deeply frozen report. Runtime, Timeline, Debrief, Analytics and protocol configuration remain unchanged.

## Result semantics

- `MET`: the condition applies and canonical action evidence satisfies its temporal relation.
- `NOT_MET`: the condition applies and canonical evidence is sufficient, but no valid action match exists.
- `NOT_APPLICABLE`: canonical domain evidence establishes a different context from the declared condition.
- `UNAVAILABLE`: applicability or timing cannot be established from trustworthy canonical evidence.

`UNAVAILABLE` is never converted to `NOT_MET`. Results contain stable IDs, exact protocol identity, patient/subject scope, ordered evidence references and typed diagnostics.

## Evidence and applicability

Only canonical Exercise Timeline and Debrief content is indexed. Evidence references point back to Timeline events, interventions, medications, process facts or Debrief fields; no parallel evidence log exists. Applicability is explicit: a matching condition trigger makes an expectation applicable, contradictory domain evidence makes it not applicable, and missing domain evidence makes it unavailable.

Initial declarative predicates support cardiac state, rhythm and rhythm classification conditions plus the WP-37 actions `START_CPR`, `STOP_CPR`, `DEFIBRILLATION`, `MEDICATION_ADMINISTRATION` and `AIRWAY_INTERVENTION`. No imperative callback is accepted in protocol data.

## Temporal evaluation and matching

Only canonical `simulationTimeSec` is used. `AFTER`, `BEFORE` and inclusive `WITHIN` are supported. Durations come from protocol configuration; the engine contains no guideline timing values. `REPEATING` remains deliberately unsupported and produces an isolated `UNAVAILABLE / INVALID_TEMPORAL_CONSTRAINT` result.

Canonical matching selects:

1. earliest trigger by simulation time;
2. lowest sequence number at the same time;
3. stable event ID as final tie-break;
4. earliest action satisfying the declared temporal relation under the same ordering.

Repeated facts do not create scores. WP-38 emits one result per declared expectation and deterministically identified patient subject.

## Diagnostics and error isolation

Typed diagnostics include missing trigger/action evidence, invalid expectations or temporal constraints, ambiguous/unknown evidence, incomplete Debrief and legacy clock. A malformed expectation becomes `UNAVAILABLE`; remaining expectations continue to evaluate. Only an invalid top-level context, including Timeline/Debrief mismatch, rejects the full run.

## Assessment hash

`assessmentHash` covers assessment schema version, protocol identity/hash, canonical Debrief hash, ordered results, evidence and diagnostics. It excludes wall time, device state, filters and UI state. The Node 20/22/24/26 workflow runs a fixed assessment-hash fixture alongside replay, Analytics and protocol hash checks.

## Legacy clock policy

Any assessment requiring event ordering or an interval returns `UNAVAILABLE` with `LEGACY_CLOCK` unless `clockMigrationStatus` is `CANONICAL`. The engine neither normalizes nor repairs legacy time. Non-temporal factual evaluation can be added later without changing this safety rule.

## ALS Generic reference

`ALS_GENERIC_V1@1.0.0` proves the end-to-end path with two factual expectations:

- cardiac arrest evidence followed by `CPR_STARTED`;
- shockable-rhythm evidence followed by `DEFIBRILLATION_ATTEMPTED`.

These results mean only that configured evidence exists. They do not assert that CPR was clinically correct, that a shock was appropriate, or that an ALS algorithm was followed.

## Read-only UI

Debrief exposes **Open Protocol Assessment** for protocol-bound exercises. The view displays exact protocol provenance and assessment/Debrief hashes, filters by status, patient and expectation, and opens evidence details. Timeline-backed evidence navigates to the existing read-only Timeline detail route. There are no edit or treatment controls.

## Performance

Timeline events are canonically sorted and indexed once by type and patient. Predicate queries are cached by patient, condition or action, so repeated expectations do not rescan all 10,000 events. An automated fixture evaluates 500 expectations against 10,000 events within a guarded local budget.

## Protected regressions

Verification includes the full test suite, TypeScript, ESLint, `git diff --check`, Runtime Hardening, Golden Runner/replay, WP-36 cardiac tests, WP-36A historical baselines, Analytics hash stability, WP-37 protocol hash stability, Package/Definition hashes and dependency-cycle validation. Historical Golden values and Runtime Hardening thresholds are unchanged.

## Known limitations

- Existing/legacy exercises that did not record canonical cardiac trigger or rhythm facts yield `UNAVAILABLE`; current state is not reverse-engineered into history.
- `REPEATING` and aggregate episode semantics are reserved for a later protocol extension.
- WP-38 does not add assessment metrics, percentages, weighting, grading or course pass/fail.
- Manual verification must not alter the current running exercise. If no protocol-bound read-only view is available without creating a second active exercise, the result is `BLOCKED_BY_SINGLE_ACTIVE_EXERCISE_POLICY`.

## Manual verification evidence

Android emulator `emulator-5554` was rebuilt from the WP-38 worktree and opened without pausing, resetting, completing or otherwise mutating the running exercise. The new read-only route rendered correctly and reported **No protocol is bound to this exercise**, which is accurate for the active `BOTULISM Template Package`. No new React Native or Android runtime warning/error was observed.

A result/evidence drill-down could not be exercised manually because the only active exercise is running without protocol provenance and the supported product flow does not permit replacing it solely for a disposable verification run. Status: `BLOCKED_BY_SINGLE_ACTIVE_EXERCISE_POLICY`. The automated ALS integration and presentation tests remain mandatory and pass. No physical Android was visible in `adb devices -l` during this verification.

## Future scoring boundary

WP-39 may consume `ProtocolAssessmentReport` through the existing Analytics provider extension point. It must not make WP-38 calculate scores, and must preserve factual results and their evidence unchanged.
