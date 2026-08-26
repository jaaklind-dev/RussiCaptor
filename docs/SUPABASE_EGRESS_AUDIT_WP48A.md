# Supabase egress audit baseline

Date: 2026-08-26. Scope: application Data API, RPC, Auth and Realtime paths. This audit does not change clinical or synchronization semantics.

## Traffic inventory

| Path | Source / trigger | Frequency | Endpoint and shape | Large/repeated | Correctness | Impact |
|---|---|---:|---|---|---|---|
| Runtime checkpoint Realtime | `RuntimeCheckpointSyncService.startRuntimeCheckpointSyncForExercise`; active exercise subscription, reconnect/resume | Every published checkpoint; resubscribes after reconnect | `runtime_checkpoints`, `postgres_changes`, complete `payload.new` including checkpoint payload | Full checkpoint JSON is delivered to every subscribed client, including writer echo | Authority reconciliation and reader continuity required; row shape is not minimal | HIGH |
| Runtime checkpoint bootstrap | `SupabaseRuntimeCheckpointRepository.loadLatest`; startup, takeover, reacquire and recovery | Startup plus 1–2 extra reads per takeover | `runtime_checkpoints.select("payload")` by exercise | Full checkpoint; takeover currently performs two full reads | Required, but the freshness guard only needs revision/hash metadata | HIGH |
| Current exercise discovery | `CloudSyncService.refreshRemoteCurrentExercise`; startup and 5-second timer | 17,280 requests/client/day while open | `exercise_states`; explicit metadata plus two small JSON projections, active filter | Small response, but high fixed frequency and identical repeats | Current-exercise/conflict discovery required | MEDIUM |
| Shared exercise projection writes | `CloudSyncService.scheduleCloudSave/saveToCloud`; local sync notifications, coalesced to 5 seconds | At most once/5 s during local churn; immediate terminal boundaries | `exercise_states.upsert(state).select(exercise_id,revision,updated_at)` | Upload may be large; response is already minimal, so inbound egress is low | Required discovery/terminal archive projection | LOW egress (potentially high ingress) |
| Terminal/full shared state | discovery terminal selection, explicit conflict selection | On changed terminal selection | explicit full `state` row | Includes patients, timeline and completed archive | Required only when terminal state changes | MEDIUM |
| Completed archive migration | `migratePendingCompletedExerciseArchives`; cloud startup | Once per pending archive per startup/retry | full `exercise_states.state`, then optional upsert | Full state and eager per-archive loop | Compatibility/evidence durability required | MEDIUM |
| Completed archive read | `loadCompletedExerciseArchive`; explicit historical/debrief use | On demand | JSON projection `state->completedExerciseArchives` | Narrow column but may contain full archive array | Required on demand | MEDIUM |
| Runtime writer lease | checkpoint repository; acquire/renew/release, renewal interval and reconnect wake | Acquire once; renew periodically; reconnect wake | lease RPCs, metadata only | Small | Required authority/CAS | LOW |
| Conflict metadata | `loadActiveExerciseConflictDetails`; conflict UI refresh | On conflict screen/refresh | explicit checkpoint and lease metadata for selected IDs | Filtered and narrow | Required for supported recovery UI | LOW |
| Runtime recovery | recovery repository; explicit terminate/reconcile | Exceptional | recovery RPC may return recovered full state; fallback reads full state plus latest audit | Large but rare | Required recovery compatibility | MEDIUM |
| Instructor evaluation | evaluation repository; evaluation load/save | On evaluation screen/save | all revision `content`; save RPC returns content | History grows; no limit/lazy revision selection | Correct history is required, but UI may not need all revisions eagerly | MEDIUM |
| Authorization roles | role authority; authentication/authorization refresh | Login and authority cache expiry (5 min) | explicit role columns by user | Narrow and filtered | Required | LOW |
| Authorization audit | audit sink; protected permission checks | Per protected audited operation | RPC, no selected row | Frequent small calls | Required audit | LOW |
| Auth/session | Supabase client auto refresh; cloud startup; authorization adapter | Startup, token refresh, auth-state changes | `getSession`, `getUser`, anonymous sign-in/refresh | Small and SDK-managed | Required | LOW |
| Module package import | `ModuleImportService`; explicit admin import | Rare/manual | module/exercise hash checks, registration RPCs, canonical payload inserts | Large canonical payload upload; small responses | Required only during import | LOW egress |
| Package discovery | `loadActiveExercisePackage`; catalog/package activation | Explicit load | `exercise_versions` explicit selected columns | May include canonical payload depending on call | Required on demand | LOW/MEDIUM |

No unfiltered `select('*')` was found. The principal problem is complete JSON carried by checkpoint Realtime and repeated full checkpoint reads, not an obvious wildcard query.

## Ranked suspects and evidence

1. **Checkpoint Realtime full rows — VERY HIGH.** The channel subscribes to every change on `runtime_checkpoints` and consumes `payload.new.payload`. PostgreSQL Changes sends the changed row, so each publication fans the full checkpoint to writer and readers. With an observed active payload around 58–60 KB and a five-second cadence, the theoretical upper bound is roughly 1.0 GB/client/day before protocol overhead.
2. **Repeated checkpoint bootstrap/takeover downloads — HIGH.** `loadLatest()` selects the full payload. Takeover loads once for validation and again for CAS freshness, although the second comparison uses only revision and payload hash.
3. **Five-second exercise discovery — MEDIUM.** The response is already metadata-only (previous measured representative response 567 bytes), but 17,280 polls/day/client means about 9.8 MB/day/client before HTTP overhead, including identical responses while idle.
4. **Terminal archive/full-state reads — MEDIUM.** Terminal selection and migration load full `exercise_states.state`; historical evidence grows and migration loops per archive.
5. **Evaluation revision history — MEDIUM.** Every load selects `content` for all revisions with no limit; cost grows monotonically with revision count.

## Development baseline instrumentation

`SupabaseTrafficMetrics` is enabled only in development or with `EXPO_PUBLIC_SUPABASE_EGRESS_DEBUG=1`. It aggregates operation/endpoint only and never retains IDs, payloads, patient data or query values. Metrics include request count, returned row count, approximate UTF-8 JSON bytes, repeated same-path requests, full-snapshot fetch count and Realtime resubscribe count. Initial instrumentation covers all dominant checkpoint/discovery/archive/recovery paths plus evaluation and authorization paths.

## Recommended implementation sequence

1. **WP-EGRESS-01 — metadata-only checkpoint Realtime notification + conditional payload fetch (VERY HIGH).** Publish/subscribe to revision, hashes and writer metadata only. Writer echoes acknowledge from metadata. Readers fetch a payload only when the incoming revision is newer and actually required. Preserve existing CAS, lease and checkpoint payload semantics.
2. **WP-EGRESS-02 — split checkpoint metadata load from payload load (HIGH).** Use metadata for takeover freshness guard and fetch the full payload exactly once per accepted recovery/startup.
3. **WP-EGRESS-03 — adaptive current-exercise discovery (MEDIUM).** Back off the five-second poll while stable/backgrounded and wake on app resume, explicit refresh and lifecycle operations. Do not weaken conflict discovery.
4. **WP-EGRESS-04 — lazy terminal archive and evaluation history (MEDIUM).** Fetch the requested exercise archive and latest evaluation revision first; load history only when opened.
5. **WP-EGRESS-05 — immutable package cache (LOW/MEDIUM).** Cache version/hash-addressed canonical package configuration locally and avoid identical downloads across navigation/restart.

## Risks and protection requirements

- Realtime correctness: metadata notifications must not be treated as state; readers must fetch and validate the exact advertised revision/hash.
- Multi-device consistency: writer echo acknowledgement, remote conflict detection and monotonic revision rules must remain unchanged.
- Restart/reconnect: reconnect must perform a metadata reconciliation and fetch a full checkpoint when local revision/hash is stale.
- Backward compatibility: existing rows containing full payloads and existing RPC contracts must remain readable during rollout.
- Old snapshots/checkpoints: payload schema, canonical hashes and rehydration validators must not change; only transport shape/fetch timing may change.

Status after this audit: `READY_FOR_EGRESS_OPTIMIZATION`.
