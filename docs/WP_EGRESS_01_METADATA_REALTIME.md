# WP-EGRESS-01 metadata-only checkpoint Realtime

Date: 2026-08-26. Status: implementation verified locally; migration not deployed.

## Architecture

Before, `runtime_checkpoints` itself belonged to `supabase_realtime`. Every checkpoint update therefore emitted the complete row, including the approximately 58–60 KB canonical payload, to every subscribed client.

After migration `20260826185115_runtime_checkpoint_metadata_realtime.sql`:

- `runtime_checkpoints` remains the single durable authoritative payload and retains its existing CAS/lease write path;
- `runtime_checkpoint_notifications` contains only exercise ID, revision, payload/provenance hashes, writer instance and timestamp;
- the guarded `publish_runtime_checkpoint_metadata` RPC updates both rows in the same database transaction;
- only `runtime_checkpoint_notifications` belongs to `supabase_realtime`;
- an authenticated client performs a conditional full-payload read only when revision/hash comparison proves local state stale or conflicting.

Existing checkpoint rows seed the new notification table. Checkpoint JSON, hashes, authority rules and old-checkpoint readers are unchanged.

## Race and recovery handling

`RuntimeCheckpointMetadataCoordinator` serializes full reads. Duplicate metadata is coalesced; rapidly increasing revisions retain the newest target. If an in-flight read already returns the newest checkpoint, no second read occurs. A same-writer metadata echo can acknowledge the already-held local envelope without downloading it. Subscription and resubscription both reconcile the durable metadata row, so missed WebSocket events do not become a correctness dependency.

Malformed metadata fails closed. Same-revision/different-hash metadata triggers an authoritative read and existing conflict resolution. CAS conflict, lease conflict, takeover and recovery remain owned by their existing RPCs and checkpoint authority services.

## Deterministic egress profile

Representative sequence: 12 publications, 60 KB compact checkpoint, listener missing one update.

| Metric | Before | After |
|---|---:|---:|
| Full checkpoint row | 60,147 bytes | conditional only |
| Realtime notification | ~60,147 bytes | 151 bytes |
| Full payload deliveries/reads | 12 | 1 |
| Total received | 721,755 bytes | 61,836 bytes |
| Reduction | — | 91.4% |

A listener already current performs zero conditional full reads, so its expected reduction is approximately 99.7% for this sequence.

## Remaining validation

Deploy the additive migration before installing the matching client. Then run two-client real-backend and physical-device validation covering active writer echo, stale reader convergence, disconnect/reconnect, restart and takeover while observing the development egress counters. Do not deploy the new client before its schema dependency.
