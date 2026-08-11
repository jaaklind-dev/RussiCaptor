# WP-40 — Exercise Evaluation Profile Foundation

## Architecture Gate

| Extension point | Result | Reason |
| --- | --- | --- |
| ExercisePackage | SUFFICIENT | Optional exact-version configuration references are an established extension pattern. |
| ExerciseDefinition | SUFFICIENT | Read-only composition provenance already exists for modules and protocol configuration. |
| Protocol Configuration | SUFFICIENT | Canonical expectation IDs and an exact protocol hash are available. |
| ProtocolAssessmentReport input | SUFFICIENT | WP-38 provides immutable statuses, evidence and assessment hash without a Timeline rescan. |
| Assessment Metrics input | SUFFICIENT | WP-39 provides neutral canonical metric results and provenance. |
| Package Loader binding authority | SUFFICIENT | Loader already composes modules and protocol and remains the single binding authority. |
| Analytics extension points | SUFFICIENT | No new provider or numerical metric is required; WP-39 results are consumed read-only. |

- Canonical Runtime contract change required: **NO**
- Dependency-direction change required: **NO**
- ADR required: **NO**

WP-40 sits after WP-38/WP-39. It neither imports nor mutates canonical Runtime and does not scan Timeline evidence.

## Model and identity

`ExerciseEvaluationProfile` is recursively immutable and identified by exact `profileId@version`. The reference profile is `ALS_GENERIC_EVALUATION_V1@1.0.0`; `latest` lookup and silent upgrades are unsupported. Its deterministic `evaluationProfileHash` is calculated from canonical, sorted configuration only.

`ExerciseEvaluationResult` records profile, protocol and assessment identities/hashes, ordered dimensions, factual expectation statuses, neutral WP-39 metrics, diagnostics and a deterministic `evaluationHash`.

## Registry and package binding

`ExerciseEvaluationProfileRegistry` provides exact-version lookup, deterministic listing, duplicate rejection and fail-closed unknown-version behavior. The Package Loader composes in this order:

```text
Package → Definition → Clinical Modules → Protocol → Evaluation Profile
```

Only `russicaptor.als-protocol-reference@1.0.0` binds the reference profile. Packages without the optional reference remain unchanged and produce no evaluation output. The historical default Package and Definition hashes remain unchanged.

Binding validates the profile against the exact bound protocol. Missing profiles, wrong protocol versions, unknown expectation IDs, duplicate dimensions or expectation references, invalid identity and invalid hash fail closed with typed diagnostics/errors.

## Dimension and classification semantics

WP-40 initially defines only `RESUSCITATION_ACTIONS`, because it is required by the current ALS Generic exercise:

- `EXPECT-CPR` — `CRITICAL`
- `EXPECT-SHOCK` — `CORE`

`CRITICAL`, `CORE` and `INFORMATIVE` are categorical designer metadata. They never rewrite WP-38 status and do not imply pass, fail, competence, points, weights or a score.

Canonical ordering is profile dimension `displayOrder`, then dimension ID; within a dimension it is `CRITICAL`, `CORE`, `INFORMATIVE`, expectation ID, then subject ID.

## Status and provenance

`MET`, `NOT_MET`, `NOT_APPLICABLE` and `UNAVAILABLE` survive unchanged. A profile reference without a corresponding WP-38 result becomes explicit `MISSING`, contributes to unavailable accounting and emits `ASSESSMENT_RESULT_MISSING`; it is never converted to `NOT_MET`.

The drill-down chain is:

```text
Evaluation → Profile → WP-38 Assessment Result → canonical evidence
Evaluation → WP-39 Metric → WP-38 Assessment Result → canonical evidence
```

Hashes are preserved at every canonical boundary.

## Engine, hash and performance

`ExerciseEvaluationEngine` indexes `ProtocolAssessmentReport.results` once, groups already-computed results into dimensions, attaches categorical metadata and optional existing WP-39 metrics, then hashes the canonical output. It does not evaluate protocol conditions, inspect clinical evidence or calculate WP-39 ratios.

Tests cover input permutations and a 500-result fixture. Runtime cost is linear in assessment results plus referenced output size, with no 10,000-event Timeline scan.

## UI and Debrief

ExCon provides a compact read-only Exercise Evaluation view and embeds the same factual summary in Protocol Assessment and Debrief. Expectation rows navigate to the existing WP-38 detail, which retains canonical evidence navigation. Critical items are identifiable without failure language. Existing WP-39 terms remain unchanged; no Score, grade, pass/fail or competency wording is introduced.

## Historical compatibility

Profiles are optional and are not retroactively injected. Historical packages produce no WP-40 output. WP-40 does not change Runtime, replay, Debrief or Analytics canonical models/hashes.

## Verification

- Exact registry identity, duplicates and unsupported versions
- Profile hash and recursive immutability
- Protocol compatibility and expectation references
- All four WP-38 statuses preserved
- Missing-result diagnostic
- Critical/Core/Informative classification
- Deterministic canonical ordering, evidence ordering and evaluation hash
- Assessment permutation invariance
- Exact ALS Package → Protocol → Profile binding
- Historical package/hash regression
- 500-result performance fixture
- Node 20/22/24/26 profile/evaluation hash fixture

Manual emulator and available physical-Android results are recorded after final verification. Known pre-existing physical-device limitations remain out of WP-40 scope: device-local Scenario Runtime may show `Canonical runtime pending`, and older Huawei navigation may trigger a `react-native-screens` native NPE.

## WP-41 boundary

Future instructor judgement may reference an exercise, dimension or expectation, but it must be a separate layer. WP-40 contains no evaluator identity, rubric, comments, manual judgement or competency decision.
