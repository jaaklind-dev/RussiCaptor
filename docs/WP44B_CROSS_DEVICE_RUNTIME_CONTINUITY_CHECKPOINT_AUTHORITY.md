# WP-44B — Cross-Device Runtime Continuity & Checkpoint Authority

## Status

Implemented above the WP-44A canonical persistence boundary. Clinical Runtime, replay, PatientProcess lifecycle and physiology contracts are unchanged. Authority metadata is an outer, nonclinical envelope.

## Root cause

`CloudSyncService` previously used a client-maintained `exercise_states.revision`, timestamp tie-breaking and blind upsert. `applyRemoteRow()` restored the entire remote `SharedExerciseState`; therefore an older one-patient remote document could replace a newer two-patient local WP-44A runtime after successful local rehydration. The shared document revision was neither a canonical Runtime revision nor backend CAS.

## Architecture gate

| Area | Result |
|---|---|
| `PersistedRuntimeState` | SUFFICIENT — schema v1 payload remains unchanged. |
| Checkpoint revision model | EXTENSION_REQUIRED — monotonic per-exercise envelope revision added. |
| Supabase Runtime checkpoint storage | EXTENSION_REQUIRED — one atomic latest checkpoint per exercise. |
| Local checkpoint storage | EXTENSION_REQUIRED — envelope stored beside WP-44A local state. |
| Remote transport | EXTENSION_REQUIRED — checkpoint-specific Realtime subscription and guarded repository. |
| Writer authority | EXTENSION_REQUIRED — expiring lease keyed by exercise and runtime installation. |
| Conflict resolution | EXTENSION_REQUIRED — one canonical resolver. |
| RuntimeOwnershipResolver | SUFFICIENT and unchanged. |
| Offline continuity | EXTENSION_REQUIRED — local continuation retained, guarded publication on reconnect. |
| Canonical Runtime / replay / lifecycle / dependency direction | NO contract change. |
| ADR | NO — implementation remains inside the frozen persistence/application extension point. |

## Checkpoint identity and resolver

`RuntimeCheckpointEnvelope` contains exercise ID, envelope and persistence versions, monotonic revision, full atomic `SharedExerciseState` payload, payload integrity hash and provenance hash. Writer identity and timestamps are not part of clinical payload or clinical hashes.

Resolution among valid same-exercise checkpoints is deterministic:

- higher revision wins regardless of arrival time or device;
- same revision plus same hash is equivalent;
- same revision plus different hash fails closed with `CHECKPOINT_REVISION_DIVERGENCE`;
- invalid/corrupt checkpoints cannot outrank valid checkpoints;
- exercise/provenance mismatch fails closed.

The legacy shared projection no longer publishes `persistedRuntimeStates`, and an active shared row is never allowed to restore canonical Runtime. Incoming Runtime state must pass the checkpoint resolver.

## Backend authority and atomicity

Migration `202608120003_runtime_checkpoint_authority.sql` adds:

- `runtime_checkpoints`: one latest complete envelope per exercise;
- `runtime_writer_leases`: one expiring writer identity per exercise;
- `runtime_checkpoint_authority_audit`: nonclinical authority audit;
- security-definer RPCs for acquire, renew, release and atomic publish.

There are no direct client write policies for checkpoint or lease tables. `publish_runtime_checkpoint` locks lease and checkpoint rows, verifies lease owner/expiry and expected revision, then replaces the complete JSON envelope atomically. Two writers based on revision N cannot both publish the next authoritative checkpoint.

## Writer authority and takeover

Device/runtime installation identity is persisted locally and remains separate from authenticated user identity. A healthy writer renews a 60-second lease every 20 seconds. Another device remains a reader while that lease is healthy. Takeover is permitted only after explicit release or expiry and only after:

1. load and validate latest remote checkpoint;
2. acquire against its exact revision;
3. reload and revalidate the same revision/hash (TOCTOU guard);
4. rehydrate; then resume Runtime.

Readers stop the local clock and Runtime commands fail at the runtime-owner boundary. The dashboard exposes the supported `Resume Runtime` action only in reader state. Fresh fixture bootstrap is never used for takeover.

## Offline and network-partition policy

The current writer may continue locally while offline and WP-44A local checkpoints continue advancing. This maximizes same-device availability without claiming remote authority. After its backend lease expires, that device cannot publish; reconnect must reacquire against the exact remote revision. If another writer has advanced, guarded publication fails and the stale device becomes reader/conflict instead of rolling back remote state.

Cross-device takeover always requires backend connectivity. During ambiguous partitions the system prioritizes no silent clinical-state corruption over availability. It does not provide distributed consensus and does not allow two branches to merge.

## Continuity contracts

The checkpoint payload is the exact WP-44A artifact set, so takeover preserves simulation time, event sequence, PatientProcess instances, Clinical Effects, resources, intervention idempotency, assessment state and two-patient isolation. Rehydration restores history rather than replaying it. Downstream Timeline, Debrief, Analytics and evaluation continue through their normal canonical paths.

## Verification

- resolver ordering, corruption, equivalent revision and divergence tests: PASS;
- repository typed diagnostics: PASS;
- migration/RLS/CAS architecture tests: PASS;
- WP-44A Pelvic/Pleural/Cardiac persistence equivalence: PASS;
- reader Runtime write guard: PASS;
- live Supabase first publish, active-writer rejection, release takeover, next publish, stale old-writer rejection and latest read: PASS;
- live lease-expiry takeover and expired-writer rejection: PASS;
- Runtime Hardening and all historical clinical/hash suites: unchanged in the full regression run.

## Performance and storage

Runtime tick performs no backend operation. Local saves remain serialized/coalesced. Remote publication follows existing local checkpoint notifications and uploads a full atomic snapshot for v1. Correctness is preferred over delta complexity; bounded/latest-only remote storage prevents unbounded growth. Lease renewal is low-frequency and does not create checkpoint revisions.

## Security and audit

Checkpoint payloads and auth tokens are not logged. Integrity hashes are identifiers, not secrets. Authenticated users retain read access according to the current exercise policy; all writes must use RPC guards. Authority events are recorded outside the clinical Timeline.

## Known limitations

- v1 stores only the latest authoritative remote checkpoint, not revision history;
- offline branches are not merged; ambiguity fails closed;
- clean app termination cannot be guaranteed, so expiry remains the crash-recovery mechanism;
- a real two-device UI acceptance test still requires two connected independent Android clients and supported authentication on each.

## WP-45 release condition

WP-45 remains `BLOCKED_BY_RUNTIME_CONTINUITY_AUTHORITY` until the mandatory two-client Device A → Device B UI/process-kill acceptance test proves exact two-patient takeover, continuation, stale Device A reconnect protection, clock/event continuity, effects and intervention idempotency on real independent client storage.
