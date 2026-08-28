# WP-EGRESS-03 checkpoint cache and delta hydration

## Decision

The existing persisted `runtimeCheckpoint` envelope is the durable device cache. The server-side full row in
`runtime_checkpoints` remains the sole authoritative recovery payload. A bounded delta chain is an optional transfer
optimization and never a second source of truth.

Hydration order is deterministic:

1. load checkpoint notification metadata;
2. accept the local durable envelope only when exercise ID, revision, payload hash, and provenance hash all match;
3. for a valid older envelope, request at most eight ordered deltas and validate every base revision/hash and the final
   canonical payload/provenance hash;
4. otherwise load the unchanged full authoritative checkpoint.

Malformed, missing, duplicated, out-of-order, excessive, schema-incompatible, or unverifiable deltas fail closed to the
full payload. Cold installs and checkpoints created before this migration therefore remain compatible.

## Payload inventory

`SharedExerciseState` contains the exercise session, patients and operational records, scenario/timeline history,
interventions, medication/vital records, audit arrays, package materialization, patient transport state, and the large
`persistedRuntimeStates` process snapshots. The deterministic performance fixture records total serialized bytes and
per-section bytes. Its representative two-patient payload is approximately 1.5–2.1 MB; runtime process state and a long
scenario-event history dominate. Clinical ticks generally change only simulation time and small process fragments,
while append-only evidence arrays grow incrementally.

The smaller deterministic delta fixture measures:

- full checkpoint response: about 60.6 KB;
- metadata: about 237 B;
- one typical delta row: about 464 B;
- current-cache reduction: about 99.6%;
- one-delta hydration reduction: about 98.8%.

These figures are regression profiles, not production billing claims. Development traffic metrics separately count
cache metadata checks, hits/misses/invalidations, delta reads/applies, full-payload fallbacks, and avoided full reads.
They record aggregate sizes only and no patient content.

## Publication and rollout

`publish_runtime_checkpoint_delta` validates the active writer lease and expected revision, then writes the full
checkpoint, optional delta, metadata notification, and audit entry in one database transaction. Only the latest 32
delta publications per exercise are retained. The full checkpoint is never pruned by this feature.

Clients probe the new RPC only when they can construct a delta. During mixed-version rollout, a missing RPC causes the
same publication to retry through the existing metadata publication RPC; subsequent publications keep using that old
path for the process lifetime. Readers encountering a missing delta table or chain use the full checkpoint.

The migration must be deployed before physical validation. Rollback is client-safe: an older client ignores delta rows,
and a newer client without the database migration falls back to the existing full-checkpoint paths. Removing the table
or RPC is not required to disable the optimization.

## Invariants

No clinical, Runtime clock, CAS, authority, lease, takeover, recovery, lifecycle, hash-input, or checkpoint-envelope
semantics change. Reconstructed envelopes pass the same canonical checkpoint validator as full payloads. The existing
WP-EGRESS-01 metadata Realtime stream and WP-EGRESS-02 metadata freshness checks remain intact.
