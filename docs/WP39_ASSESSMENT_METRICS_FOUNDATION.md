# WP-39 – Assessment Metrics Foundation

## Status

Implemented as a read-only extension of the frozen v0.7 architecture. No Runtime, Timeline, Debrief, protocol assessment, replay, or canonical hash contract was changed.

## Architecture gate

| Question | Result |
|---|---|
| Is `ProtocolAssessmentReport` sufficient? | Yes. It supplies deterministic statuses, subject attribution, evidence, protocol provenance, and an assessment hash. |
| Is the WP-25 provider framework sufficient? | Yes. WP-39 is one additional deterministic `AnalyticsMetricProvider`. |
| Is the WP-26 metric contract sufficient? | Yes. Only additive assessment evidence and provenance metadata were required. |
| Is Debrief sufficient? | Yes. It remains the canonical Analytics input and receives no assessment writes. |
| Runtime contract change required? | No. |
| Dependency direction change required? | No. |
| ADR required? | No. Existing extension points are used without changing their semantics. |

## Data flow

```text
ProtocolAssessmentReport (immutable WP-38 output)
        ↓ read-only
ProtocolAssessmentMetricsProvider
        ↓
AnalyticsEngine canonical ordering and precision
        ↓
AnalyticsReport
        ↓ read-only
Assessment / Debrief / Analytics UI
```

The provider never reads Runtime or Timeline and never re-evaluates protocol expectations. Assessment remains the only owner of assessment truth.

## Metric semantics

Exercise and patient scopes expose the same nine neutral aggregates:

- `total = MET + NOT_MET + UNAVAILABLE + NOT_APPLICABLE`
- `applicable = MET + NOT_MET + UNAVAILABLE`
- `assessable = MET + NOT_MET`
- `completion_ratio = assessable / applicable`
- `satisfaction_ratio = MET / assessable`

`MET`, `NOT_MET`, `UNAVAILABLE`, and `NOT_APPLICABLE` are counted directly from the immutable assessment results. A zero denominator returns `NOT_APPLICABLE` with `ZERO_DENOMINATOR`; it is never silently converted to zero.

Patient definitions use the existing multi-subject metric convention with an explicit sparse-scope declaration. If no patient has a relevant assessment result, no synthetic patient metric is produced and the absence is not treated as a provider failure. The default provider contract is unchanged for every historical provider.

These are descriptive aggregates, not scores, grades, pass/fail decisions, protocol compliance claims, or team-performance judgements. No weighting, threshold, ranking, or clinical interpretation is introduced.

## Evidence and provenance

Every value references the source assessment report and its contributing assessment result IDs. Every result carries exact protocol and assessment provenance:

- protocol ID, version, and hash;
- assessment version and hash.

Evidence is canonically ordered by the Analytics Engine. Patient metrics are emitted in natural Patient ID order and final results retain the framework's canonical ordering.

## Compatibility and hashes

The existing provider registry remains unchanged when an exercise has no protocol assessment. Consequently historical Analytics configuration, registry version, result set, and analytics hash are byte-for-byte unchanged. The assessment provider is selected only when a current WP-38 report exists.

The cross-version workflow verifies the assessment metrics analytics hash on every supported Node version alongside the pre-existing hash checks.

## Presentation

Assessment shows exercise-level aggregates and switches to the selected patient's metrics when a patient filter is active. Debrief shows the same read-only summary and links to contributing assessment results. Analytics retains its existing category/provider/scope/status filtering and evidence presentation.

## Failure isolation and performance

Missing assessment input contributes no metrics. Invalid input is isolated by the Analytics provider boundary and does not prevent other providers from producing results. The provider aggregates only assessment results; it does not rescan the Debrief timeline. The automated load case covers 100 patients and 500 assessment results.

## Verification scope

Automated coverage includes counts, invariants, denominator rules, patient aggregation, input-order determinism, immutable output, provider failure isolation, historical no-assessment compatibility, load behavior, and cross-version hash stability. Manual Android verification is read-only and must not alter a currently active exercise.
