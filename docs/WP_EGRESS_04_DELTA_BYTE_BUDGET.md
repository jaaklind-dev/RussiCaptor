# WP-EGRESS-04 delta-chain byte budget

## Previous decision path

WP-EGRESS-03 first compared durable local checkpoint metadata with the authoritative notification. For an older valid
cache it immediately selected and downloaded up to nine `delta_payload` JSON rows. Only after transfer did the client
validate the eight-revision maximum, ordering, schema version, base/target hashes and final canonical envelope. The
database stored neither delta payload bytes nor authoritative checkpoint bytes, so transfer cost was unknown until the
payloads had already arrived. A rejected or expensive chain could therefore be followed by a full checkpoint fetch.

## Architecture and policy

This work adds transactionally maintained serialized JSON byte counts:

- `runtime_checkpoints.payload_bytes` for the authoritative full envelope;
- `runtime_checkpoint_notifications.checkpoint_bytes` for lightweight discovery;
- `runtime_checkpoint_deltas.payload_bytes`, plus explicit delta/runtime versions for lightweight chain validation.

The client now queries only delta metadata first. It validates revision/hash continuity and selects delta payloads only
when the candidate has at most eight rows, is schema-compatible, is no larger than 4 MiB, and costs at most 80% of the
full checkpoint. Equality at the 80% boundary selects deltas deterministically. Otherwise it fetches the authoritative
full checkpoint exactly once without downloading delta JSON. The 80% default reserves 20% for the extra metadata
request, JSON/HTTP overhead and estimation variance.

Old checkpoints or delta rows are backfilled by the additive migration. During rollout, absent/malformed byte metadata
causes a conservative full fetch; it never reverts to an unbounded legacy delta download. Delta payloads selected after
the cost gate retain every WP-EGRESS-03 integrity check and canonical final-hash validation.

## Instrumentation

Development-only aggregate metrics distinguish cost-metadata reads, candidate row/byte counts, `DELTA_SELECTED`,
`FULL_SELECTED_BY_COST`, chains that would exceed a full payload, missing-size fallback and estimated bytes avoided.
No payload content or patient data is logged.

The migration is intentionally not deployed by this implementation work package. Real-backend and physical acceptance
must follow deployment before commit.
