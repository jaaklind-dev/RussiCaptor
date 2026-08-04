# WP-23 – ExCon Exercise Timeline & Audit

## Outcome

WP-23 adds a canonical, read-only exercise-wide timeline for ExCon. It projects existing exercise control audits, instructor command audits and patient timeline events without mutating runtime or creating clinical behaviour.

## Data flow

```text
Exercise control audit ─┐
Instructor command audit ├─→ ExerciseTimelineAggregator
Patient timeline events ─┘             ↓
                              Canonical timeline
                                      ↓
                         filters / grouping / search
                                      ↓
                         virtualized ExCon timeline UI
```

The aggregator uses simulation time as the primary order and deterministic source order as the tie-breaker. Wall-clock timestamps are neither compared nor included in canonical IDs. Instructor events already present in the patient timeline are omitted there because their command audit is the canonical command source.

## Canonical contract

Each timeline entry has a stable ID, exercise ID, simulation time, sequence number, category, type, severity, optional patient and issuer, display text and immutable metadata. The canonical array and entries are frozen. Filtering, search, newest-first ordering and grouping return presentation projections and never mutate the source.

New patient timeline entries receive canonical simulation time and insertion sequence when they are created. Restored legacy entries without these fields retain stable source insertion order and are never ordered by their ISO wall-clock timestamp.

## Sources and persistence

- Exercise lifecycle and speed events, including rejected commands
- Accepted and rejected patient event-injection commands
- Existing patient assignment, transfer, status and clinical timeline events
- Existing event metadata only; no synthetic runtime or synchronization events

Exercise and instructor command audits are persisted in local/cloud exercise state. Restoring accepted command audits also restores command idempotency when a runtime event ID is available.

## UI

- New `Exercise Timeline` route from Instructor Dashboard
- Virtualized newest-first event list with stable keys
- Category, severity, patient ID and Case Manager filters
- Client-side free-text search
- Optional Today, simulation-minute, patient and category grouping
- Read-only detail route with full identifiers and metadata
- Available in READY, RUNNING, PAUSED and COMPLETED states

## Verification

- Deterministic ordering and IDs
- Category, severity, patient and Case Manager filtering
- Free-text search
- Presentation-only grouping
- Immutability
- Identical timeline replay hash
- 1000-event linear filtering performance
- Lifecycle, event injection and ownership integration
- Existing Runtime Hardening and Golden replay suites unchanged

No export, debrief, scoring, KPI, recommendation or analytics logic was added.
