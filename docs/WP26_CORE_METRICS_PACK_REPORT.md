# WP-26 — Core Metrics Pack

## Outcome

WP-26 registers six independent production providers on the unchanged WP-25
Analytics Framework. They describe objective exercise facts and contain no score,
grade, threshold, benchmark, protocol judgement, or recommendation.

## Provider catalogue

| Provider | Factual metric area |
|---|---|
| `core.exercise` | duration, pauses, running/paused time, speeds, control/timeline/audit counts |
| `core.patient-flow` | first ownership, ownership changes, distinct owners, participation/lifetime, completion, transfers |
| `core.ownership` | ownership durations, handovers, ownerless patients, conflict availability |
| `core.interventions` | first intervention and medication/order/imaging/lab/airway/respiratory/circulation counts |
| `core.timeline` | category and command counts plus clock-dependent event rates |
| `core.resources` | resource assignment/release/concurrency/utilization/unused-resource contract |

Each provider owns its definitions and evaluation only. No provider calls another
provider. All use the existing central precision policy and WP-25 result validation.

## Evidence and indexing

Every result contains compact references to Debrief fields, patient summaries, or
canonical timeline/audit events. A read-only WeakMap index groups a Debrief's
timeline once by patient and category; it changes no source data and avoids repeated
full scans for each metric.

## Unavailable policy

- Every duration/rate metric is `UNAVAILABLE` for a legacy Exercise Clock.
- Counts remain available because they do not infer time.
- Missing ownership or intervention history is `UNAVAILABLE`, never zero when the
  fact itself cannot be established.
- Ownership conflict is `UNAVAILABLE` until Debrief carries canonical overlap
  intervals.
- Resource metrics are `NOT_APPLICABLE` because canonical resource history is not
  currently part of Debrief. No usage is invented.

## Determinism and performance

Providers emit immutable results and deterministic evidence. Identical Debriefs
produce identical metrics, order, evidence, and analytics hash. The supported-Node
hash matrix now executes the complete production provider pack. Tests cover 100
patients, 10,000 timeline events, and more than 1,000 metric results under the
existing two-second local analytics budget.

## Deferred scope

KPI thresholds, scores, grading, protocol compliance, benchmarking, rankings,
recommendations, AI review, and charts remain deferred to later work packages.
