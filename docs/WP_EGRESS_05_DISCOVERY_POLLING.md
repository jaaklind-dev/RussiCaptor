# WP-EGRESS-05 exercise discovery polling

## Previous path

`startCloudSync()` performed one narrow startup query and then repeated the same active-exercise discovery every five
seconds for the lifetime of the root layout. The query selected only exercise identity, revision, update metadata,
exercise-session metadata and package display metadata, but a stable 535-byte representative response still meant 720
requests and about 385,200 response bytes per client-hour. Concurrent refresh attempts were dropped rather than sharing
one authoritative result.

## Selected architecture

WP-EGRESS-05 uses adaptive polling with connectivity and foreground invalidation. It intentionally does not subscribe to
`exercise_states` Postgres Changes because those notifications carry the large `state` JSON row. The client now performs:

- one immediate authoritative query during startup;
- one immediate query after returning to the foreground;
- one immediate reconciliation when a payload-free Realtime connectivity channel successfully resubscribes;
- one 60-second safety query while the app remains stable;
- manual refreshes required by supported conflict/recovery workflows.

All triggers share one in-flight promise. Duplicate foreground/reconnect invalidations in the same two-second resume
burst are also satisfied by the just-completed authoritative query. Concurrent safety or user refreshes are coalesced. The
database query remains the durable source of truth, so Realtime is never the only recovery mechanism. Existing narrow
columns, active filtering, terminal fallback, conflict resolution and terminal full-state loading remain unchanged.

The 60-second interval bounds discovery of a remote lifecycle change when no foreground/reconnect signal occurs. Local
lifecycle changes still publish immediately. This trades a maximum 60-second passive remote-detection delay for a 91.7%
reduction in stable polling requests without adding schema, triggers, policies or migration risk.

## Deterministic estimate

For a representative 535-byte stable response:

| Period | Previous 5 s poll | WP-EGRESS-05 60 s safety poll | Reduction |
| --- | ---: | ---: | ---: |
| 1 hour | 720 requests / 385,200 B | 60 requests / 32,100 B | 91.7% |
| 24 hours (extrapolated) | 17,280 requests / 9,244,800 B | 1,440 requests / 770,400 B | 91.7% |

Realtime join/reconnect control messages are not included in response-byte estimates. Instrumentation separately records
discovery response bytes, identical responses, triggers, reconnect/foreground invalidations, coalesced refreshes, avoided
legacy requests and estimated bytes saved. No exercise payload or patient data is logged.
