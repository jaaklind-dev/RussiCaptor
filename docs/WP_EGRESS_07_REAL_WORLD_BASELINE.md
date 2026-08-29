# WP-EGRESS-07 — real-world Supabase egress baseline

Date: 2026-08-29  
Backend: `fimcsrivizpliiuoqopv` (real Supabase, Free plan)  
Physical client: Samsung SM-X306B, Android 16, release 1.0.0 (versionCode 1)  
Technical exercise: `EX-1787986187433-1`, pelvic-injury reference 1.0.0

## Scope and method

This is a post-WP-EGRESS-01…06 measurement baseline, not a billing export. Development-only aggregate instrumentation was enabled in a release build. It records operation/category, count, rows, serialized response/request bytes, maxima, avoided requests, and fallback reasons. It does not retain patient data, identifiers, checkpoint JSON, or payload contents.

The byte estimates are UTF-8 serialized application payload sizes. HTTP, TLS, WebSocket, and PostgREST framing are not included, so dashboard usage will be somewhat higher. Supabase egress means backend-to-client bytes. Client-to-backend bytes are reported separately because they affect network load but not the Supabase egress quota.

Local analytical events such as `CACHE_HIT`, `DELTA_CHAIN_CANDIDATE`, and `FULL_PAYLOAD_AVOIDED` are not counted as network traffic. Dashboard Usage is delayed and aggregate, so it was not used to attribute individual scenarios.

## Instrumentation coverage

| Path | Attribution | Evidence captured |
| --- | --- | --- |
| Full checkpoint hydration/fallback | `CHECKPOINT_FULL_IN` | count, bytes, max, fallback reason |
| Delta hydration | `CHECKPOINT_DELTA_IN` | count, bytes, max, chain selection |
| Checkpoint metadata/Realtime | `CHECKPOINT_METADATA_IN` | selects, messages, writer echoes, bytes |
| Checkpoint publication | `CHECKPOINT_OUT` | RPC count, request/response bytes, max |
| Exercise discovery/full-state selection | `DISCOVERY_IN` | request count and response bytes |
| Projection persistence | `PROJECTION_OUT` | writes, coalesced intents, request/response bytes |
| Legacy terminal archive migration | `TERMINAL_ARCHIVE_OUT` | write count and outbound bytes without a response-row fetch |
| Lease/auth/evaluation traffic | `AUTH_OR_MISC` | count and response bytes |
| Unknown | `UNKNOWN` | aggregate safety bucket; no network bytes observed in the scenarios |

The audit added only missing aggregate attribution for outbound checkpoint publication, legacy terminal-archive writes, category totals, and per-request maxima. No sync, authority, clinical, checkpoint, projection, or archive semantics changed.

## Scenario measurements

| Scenario | Window/action | Requests/messages of interest | Inbound (Supabase egress) | Outbound | Total | Result / unexpected traffic |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| A — stable idle RUNNING | 10 min | 7 checkpoint writes; 2 projection writes; 7 Realtime messages; 1 discovery; 6 renewals | 5,370 B | 6,776,470 B | 6,781,840 B | 296 projection intents coalesced; 11 discovery requests avoided; no hydration |
| B — active workflow | 30 UI mutations plus 2 min observation | 5 checkpoint writes; 1 projection write; 5 Realtime messages; 1 discovery; 6 renewals | 4,084 B | 5,484,689 B | 5,488,773 B | 287 projection intents coalesced; no full/delta hydration |
| C — warm restart | current durable cache | metadata/discovery plus writer acquisition/renewal | 1,866 B | 0 B | 1,866 B | `CACHE_HIT`; no full or delta fetch |
| D — stale reconnect | remote advanced by supported takeover, then stale Samsung restored | metadata + delta-cost query + one full fallback | 1,090,283 B | 0 B | 1,090,283 B | 1,085,489 B full payload; `DELTA_COST_LEGACY_FALLBACK: missing_or_invalid_cost`; no rejected-delta download |
| E — cold start | supported physical app-data reset and normal login | discovery + metadata + one full checkpoint | 1,087,078 B | 0 B | 1,087,078 B | 1,085,489 B full payload; reason `empty_cache` |
| F — lifecycle completion | supported Complete UI | 1 final checkpoint; 1 immediate projection; metadata/discovery/lease close | 2,360 B | 1,553,613 B | 1,555,973 B | no duplicate/archive write storm; final remote lifecycle `COMPLETED` |

Scenario F was independently verified in Supabase: projection revision 28, Runtime checkpoint revision 184, checkpoint payload 1,302,510 B, lifecycle `COMPLETED`, and latest writer lease released/inactive.

## Aggregate category totals

### Backend-to-client (Supabase egress)

| Rank | Category | Bytes | Share |
| ---: | --- | ---: | ---: |
| 1 | `CHECKPOINT_FULL_IN` | 2,170,978 B | 99.08% |
| 2 | `CHECKPOINT_METADATA_IN` | 12,049 B | 0.55% |
| 3 | `DISCOVERY_IN` | 3,190 B | 0.15% |
| 4 | `CHECKPOINT_OUT` RPC responses | 3,170 B | 0.14% |
| 5 | `AUTH_OR_MISC` | 1,274 B | 0.06% |
| 6 | `PROJECTION_OUT` responses | 380 B | 0.02% |
| 7 | `CHECKPOINT_DELTA_IN` | 0 B | 0% |
| 8 | `TERMINAL_ARCHIVE_OUT` responses | 0 B | 0% |
| 9 | network `UNKNOWN` | 0 B | 0% |
| | **Total** | **2,191,041 B** | **100%** |

### Client-to-backend

| Rank | Category | Bytes | Notes |
| ---: | --- | ---: | --- |
| 1 | `CHECKPOINT_OUT` | 13,405,625 B | 13 publications; average 1,031,202 B; maximum 1,415,418 B |
| 2 | `PROJECTION_OUT` | 409,147 B | 4 writes; average 102,287 B; maximum 138,195 B |
| 3 | `TERMINAL_ARCHIVE_OUT` | 0 B | no legacy archive migration in this exercise |
| | **Total** | **13,814,772 B** | not Supabase egress quota |

## Normalized metrics

| Metric | Measured value |
| --- | ---: |
| Idle Supabase egress | 32,220 B/hour |
| Warm restart | 1,866 B |
| Cold start | 1,087,078 B |
| Stale reconnect | 1,090,283 B |
| Lifecycle completion | 2,360 B egress; 1,553,613 B outbound |
| Checkpoint publication | 1,031,202 B outbound average; 244 B response average |
| Projection write | 102,287 B outbound average; 95 B response average |

## Ranked current traffic sources

1. **Full checkpoint fallback/hydration** — 2,170,978 B and 99.08% of measured Supabase egress. Rare but approximately 1.085 MB each; cold start and the stale reconnect fallback dominate.
2. **Checkpoint publication upload** — 13,405,625 B across the experiment. This is the largest bidirectional path but is client upload, not Supabase egress.
3. **Projection upload** — 409,147 B. WP-EGRESS-06 keeps its cadence bounded; response egress is only 380 B.
4. **Checkpoint metadata/Realtime** — 12,049 B. Frequent but small; no writer-echo payload fetch occurred.
5. **Discovery** — 3,190 B. WP-EGRESS-05 suppression held; no burst was observed.
6. **Auth/lease/miscellaneous** — 1,274 B.
7. **Delta hydration** — 0 B in these scenarios. The stale chain was rejected by metadata/cost policy before payload transfer.
8. **Terminal archive** — no separate legacy archive migration occurred; completion used one immediate compact projection plus final checkpoint.

## Representative two-hour projection

This estimate is not measured data. Assumptions: one cold start, two hours at the measured stable-idle rate, one active-workflow burst equivalent to Scenario B, and one completion. It deliberately uses the expensive cold-start path rather than a warm restart.

| Contribution | One client | Five clients, conservative linear upper bound |
| --- | ---: | ---: |
| Full checkpoint | 1,085,489 B | 5,427,445 B |
| Metadata/Realtime | 34,040 B | 170,200 B |
| Discovery | 7,956 B | 39,780 B |
| Checkpoint RPC responses | 21,936 B | 109,680 B |
| Projection responses | 2,470 B | 12,350 B |
| Auth/lease/misc | 6,071 B | 30,355 B |
| Delta | 0 B | 0 B |
| Terminal archive response | 0 B | 0 B |
| **Estimated Supabase egress** | **1,157,962 B (~1.16 MB)** | **5,789,810 B (~5.79 MB)** |

For operational context, the same one-writer exercise projects approximately 88,355,942 B of client upload: about 86,027,966 B checkpoint publication and 2,327,976 B projection persistence. Reader-only clients should not multiply writer uploads, so the five-client outbound total is intentionally not linearly extrapolated.

## Plan/quota comparison

The organization reports the **Free** plan. Current Supabase documentation gives Free organizations 5 GB uncached and 5 GB cached egress quotas; RussiCaptor database/Auth/Realtime traffic is uncached. The available aggregate dashboard observation supplied for this billing period is approximately **1.3 GB** and remains separate from these per-test measurements because dashboard data is delayed.

Using decimal quota arithmetic solely for capacity planning, approximately 3.7 GB uncached quota remains. At the conservative estimates above, that is roughly 3,195 one-client two-hour exercises or 639 five-client exercises. Protocol overhead and non-RussiCaptor organization traffic reduce those counts, but the margin is still large. The source that most threatens the quota is repeated cold/stale **full checkpoint hydration**, not idle Realtime or discovery.

## Regression and defect findings

- No full checkpoint fetch occurred on warm restart.
- No delta fetch occurred with a current cache.
- No repeated discovery burst, writer-echo payload fetch, archive duplication, or network `UNKNOWN` traffic occurred.
- Stable idle still publishes large checkpoints from the writer. This is high upload volume but not a Supabase-egress regression.
- Stale reconnect selected a safe full fallback because cost metadata was missing/invalid. The fallback was correct and no rejected delta payload was downloaded.
- One audit-only defect was prevented before final verification: terminal-archive instrumentation initially requested a metadata response solely for measurement. The response selection was removed, retaining outbound-byte attribution without generating egress.

## Recommendation

The measured next candidate is **checkpoint payload decomposition / section hydration** because full checkpoint reads account for 99.08% of current measured egress and approximately 93.7% of the conservative one-client exercise estimate. A sectioned cold-start path could plausibly avoid 70–90% (roughly 0.76–0.98 MB) of each full read when only startup-critical sections are needed.

Candidate classification: **VERY HIGH VALUE per affected request**, **high implementation complexity**, and **high correctness risk** for restart, takeover, old checkpoints, deterministic hashes, and cross-section invariants.

Despite its dominance, the absolute measured egress is already small relative to the current Free quota. Therefore the evidence-based recommendation is **do not start another egress architecture WP now**. Monitor aggregate usage and these counters. Open a future `WP-EGRESS-08 — sectioned checkpoint hydration` only if cold/stale full-fetch frequency or dashboard usage approaches a defined threshold (for example, 60–70% of uncached quota before mid-cycle). Projection slimming and delta encoding are lower-value based on current egress evidence.

Status: `BASELINE_COMPLETE`
