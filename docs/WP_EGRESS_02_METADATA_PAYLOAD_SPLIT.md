# WP-EGRESS-02 metadata/payload read split

## Inventory

| Flow | Classification | Result |
| --- | --- | --- |
| Startup/restart authoritative restore | PAYLOAD_REQUIRED | Full read retained |
| Initial takeover validation and adoption | PAYLOAD_REQUIRED | Full read retained |
| Takeover post-acquisition freshness guard | METADATA_ONLY_SUFFICIENT | Notification metadata |
| Initial explicit recovery validation/adoption | PAYLOAD_REQUIRED | Full read retained |
| Recovery post-acquisition freshness guard | METADATA_ONLY_SUFFICIENT | Notification metadata |
| Lost publish-response/CAS reconciliation | METADATA_ONLY_SUFFICIENT | Notification metadata |
| Stale Realtime listener convergence | PAYLOAD_REQUIRED | Conditional full read retained |
| Current/reconnect Realtime reconciliation | METADATA_ONLY_SUFFICIENT | Already metadata-only in WP-EGRESS-01 |
| Active-exercise conflict discovery | METADATA_ONLY_SUFFICIENT | Already explicit columns, no payload |
| Writer lease validation/renewal | METADATA_ONLY_SUFFICIENT | Already lease-only RPC/query |

`loadCheckpointFreshness` is the explicit low-egress boundary. Missing, malformed,
or rollout-unavailable metadata falls back to the authoritative payload and is
instrumented. A revision/hash mismatch remains a conflict and never grants stale
authority.

No clinical, Runtime, CAS, lease, takeover-policy, checkpoint JSON, or historical
hash semantics are changed. WP-EGRESS-01 acceptance status remains unchanged.
