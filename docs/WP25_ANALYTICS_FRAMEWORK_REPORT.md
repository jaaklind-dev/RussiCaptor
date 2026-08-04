# WP-25 — Analytics Framework

## Outcome

WP-25 adds a deterministic, extensible, read-only Analytics Framework downstream of
the canonical Debrief model. It defines provider, metric, evidence, diagnostic,
precision, category-summary, configuration, and report contracts without adding
clinical scoring, grading, thresholds, benchmarks, or recommendations.

```text
Canonical DebriefReport
          ↓
AnalyticsProviderRegistry
          ↓
    AnalyticsEngine
          ↓
Canonical AnalyticsReport
          ↓
 Read-only ExCon UI
```

## Provider and metric contracts

Provider IDs and metric IDs are globally unique and versioned. The registry fails
closed on duplicates or malformed definitions and executes providers in canonical
provider-ID/version order. Registration order cannot affect result order, registry
version, or analytics hash. Static typed registration is the WP-25 extension point;
remote plugin loading is not implemented.

Results distinguish `VALUE`, `UNAVAILABLE`, `NOT_APPLICABLE`, and `ERROR`. Production
values reference compact canonical evidence rather than copying source records.
Providers receive only immutable Debrief context and analytics configuration.

## Execution, errors, and precision

The engine validates input/registry/results, isolates provider exceptions, creates
typed error results where definitions are known, continues healthy providers,
normalizes numeric precision centrally, sorts canonically, and derives category
counts without category scores. Unknown configured IDs and legacy clock state create
typed diagnostics.

## Hash contract

The stable analytics hash covers analytics version, Debrief source hash, registry
version, normalized metrics, diagnostics, category summaries, simulation generation
time, and deterministic configuration. Wall clock, UI filters, device state, and
registration order are excluded. GitHub's Node 20/22/24/26 matrix runs the analytics
hash stability test in addition to Runtime Hardening.

## Initial production metrics

- `exercise.duration.seconds`: factual Debrief duration; `UNAVAILABLE` for a legacy
  clock, never zero or normalized.
- `exercise.timeline.event_count`: factual canonical timeline count and available
  independently of clock migration status.

Both include evidence. Neither evaluates clinical quality.

## Performance and UI

The UI is a virtualized, read-only list with category/scope/status/search filters,
summary hashes, diagnostics, status badges, and expandable evidence references.
Filtering does not mutate or re-run canonical analytics. Tests cover 100-patient/
10,000-event-compatible Debrief input, 50 providers, and 500 results under a two
second local budget.

## Deferred scope

Clinical KPI packs, scores, grading, benchmarks, learner rankings, protocol
recommendations, AI analysis, exports, and threshold configuration remain deferred.

