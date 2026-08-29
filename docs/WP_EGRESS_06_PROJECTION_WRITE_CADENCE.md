# WP-EGRESS-06 projection write cadence

## Baseline and ownership

`CloudSyncService` is the only routine owner of `exercise_states.projection`. Local sync notifications scheduled a
publication after five seconds; a continuously progressing Runtime therefore produced up to 720 projection writes per
client-hour. Lifecycle changes already bypassed the delay. Archive migration is a separate, terminal evidence path and
is not a routine projection writer.

The upsert sends only the exercise identity, projection revision, compact shared projection, timestamp and actor, and
returns only `exercise_id,revision,updated_at`. The active Runtime checkpoint remains separately owned. No schema or RLS
change is required.

## Selected policy

All routine projection intents now pass through one coordinator:

- rapid local changes coalesce for at most 60 seconds;
- stable canonical projection identity suppresses an unchanged write entirely;
- READY/RUNNING/PAUSED/COMPLETED identity or lifecycle boundaries flush immediately;
- app background flushes a pending latest projection;
- foreground and reconnect schedule one bounded reconciliation;
- one write may be in flight; mutations during it collapse into one follow-up write of the newest projection;
- failed writes do not advance the successful identity and remain retryable.

Projection identity is SHA-256 over the repository's canonical stable JSON representation. It ignores object-key order
but retains all semantic projection values. The existing projection format, discovery columns, authority, CAS, lease,
checkpoint and archive semantics are unchanged.

The 60-second bound matches discovery's existing safety interval. It reduces stable progressing-Runtime writes by 91.7%
while keeping passive remote visibility bounded to one minute. Explicit lifecycle transitions remain immediate.

## Deterministic estimate

For a representative projection request body of `P` bytes:

| Period | Previous 5 s cadence | WP-EGRESS-06 60 s bound | Reduction |
| --- | ---: | ---: | ---: |
| 1 hour | 720 writes / `720P` bytes | at most 60 writes / `60P` bytes | 91.7% |
| 24 hours | 17,280 writes / `17,280P` bytes | at most 1,440 writes / `1,440P` bytes | 91.7% |

If the semantic projection is unchanged, successful-hash deduplication reduces subsequent routine writes to zero until
the projection changes. Development instrumentation records aggregate bytes sent, coalesced intents, identical writes
avoided and estimated bytes saved without logging projection or patient content.
