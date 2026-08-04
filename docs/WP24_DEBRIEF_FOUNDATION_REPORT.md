# WP-24 — Debrief Foundation

## Outcome

WP-24 introduces a canonical, read-only Debrief layer. It reconstructs what
happened during an exercise from immutable Exercise Snapshot, Runtime Snapshot,
Exercise Timeline, and optional replay-event inputs. It does not mutate runtime,
evaluate performance, calculate KPIs, or assign scores.

## Architecture

```text
Canonical exercise and patient snapshots
                    +
Canonical exercise timeline / replay events
                    ↓
              DebriefEngine
                    ↓
         immutable DebriefReport
                    ↓
       playback selectors and ExCon UI
```

`DebriefEngine` is a pure function with explicit inputs. `DebriefService` is the
application adapter that reads existing canonical repositories and subscriptions.
Playback uses an immutable presentation-only cursor; it never drives ScenarioEngine
or Replay.

## Canonical model

The report records exercise identity/state/duration, its deterministic source hash,
patient and completion counts, command/audit/timeline counts, factual patient
summaries, and the canonical timeline. Patient summaries contain locations,
assignments, process projections, categorized clinical records, timeline references,
and factual outcomes only.

The model deliberately contains no score, grade, KPI, benchmark, recommendation,
or clinical-performance classification. Future analytics and exports may consume
the model through new adapters without changing Debrief reconstruction.

## Playback

- Play, pause, bounded seek, event jump, and patient jump use immutable cursors.
- Timeline playback exposes only events at or before the cursor.
- Patient playback projects that patient's events and process list in exercise
  context.
- UI lists remain virtualized and reuse the existing subscriptions; there is no
  polling or local simulation.

## Determinism and performance

The Debrief source hash excludes wall-clock metadata and uses stable canonical JSON.
Repeated reconstruction from identical clinical inputs produces an identical report
and hash. Tests cover immutable reconstruction, patient/timeline playback, filters,
wall-clock independence, and a 100-patient/10,000-event workload.

## Deferred scope

Scoring, grading, KPIs, benchmarking, recommendations, AI analysis, and PDF/CSV/JSON
exports remain explicitly deferred to later work packages.

## Known issue

Persisted state from an older exercise may contain an excessively large canonical
`simulationTimeSec`. Debrief deliberately displays the Exercise Snapshot value as
received and does not calculate, clamp, normalize, or repair it. Correcting legacy
exercise time belongs to a dedicated Exercise State / Clock migration or reset work
package, not WP-24.
