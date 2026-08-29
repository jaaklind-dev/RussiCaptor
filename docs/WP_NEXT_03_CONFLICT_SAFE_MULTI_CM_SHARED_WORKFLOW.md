# WP-NEXT-03 — Conflict-Safe Multi-CM Shared Workflow

Date: 2026-08-29

## Previous hazard

`CloudSyncService.publishCloudProjection()` serialized every shared domain into
`exercise_states.state` and used an unrestricted full-row upsert with a
client-calculated revision. Two CMs starting from the same revision could both
succeed and the later full JSON value silently removed the earlier CM's work.
The same local-only ownership check was vulnerable to simultaneous claims.

## Shared-state inventory

| Domain | Previous classification | WP-NEXT-03 model |
|---|---|---|
| Patient assignment/ownership | LAST_WRITER_WINS_CURRENTLY | Exclusive patient head, transactional ownership transition |
| Transfer/request/release/reacquire | LAST_WRITER_WINS_CURRENTLY | Patient revision CAS plus owner check |
| Patient status/location | LAST_WRITER_WINS_CURRENTLY | Patient revision CAS |
| Questions, labs, imaging, orders | LAST_WRITER_WINS_CURRENTLY | Patient revision CAS |
| Notes | APPEND_ONLY but rewritten as array | Transactional append merge by stable ID |
| Interventions and medication administrations | APPEND_ONLY plus canonical Runtime where applicable | Transactional append merge by stable ID; Runtime semantics unchanged |
| Manual vital signs | APPEND_ONLY but rewritten as array | Transactional append merge by stable ID |
| Patient Timeline events | APPEND_ONLY but rewritten as array | Transactional append merge by stable ID |
| Exercise lifecycle/control | CAS/authority-specific | Remains EXCON-controlled; not part of CM patient mutation RPC |
| Canonical clinical Runtime/checkpoints | CAS_PROTECTED | Unchanged |
| Scenario events, package/materialization, workbook | SINGLE_OWNER_ONLY / Runtime-owned | Unchanged |

## Conflict and ownership model

The authoritative conflict domain is `(exercise_id, patient_id)`. Different
patients have independent revisions. `shared_workflow_patient_states` stores
the current opaque patient workflow slice, revision and exclusive owner UUID.
The mutation RPC locks exactly one patient head.

- `CLAIM`/`REACQUIRE`: accepted only when the authoritative owner is empty.
- `TRANSFER_REQUEST`: any correctly scoped CM may request, but the owner and
  patient revision must still match.
- `TRANSFER`/`RELEASE`: only the current owner (or scoped EXCON control) may
  cross the ownership boundary.
- `MUTABLE`: requires exact patient revision and current ownership.
- `APPEND`: requires current ownership but may merge across an older revision;
  stable IDs make concurrent append actions lossless.

Every command has a stable client command ID in
`shared_workflow_commands`. Repeating the same command by the same actor is an
idempotent no-op. Reusing it for another patient, actor or kind is rejected.

## Client commit and conflict UX

The client builds a proposal by running existing repository mutation code with
sync notification suppressed, captures the proposed patient slice and restores
the prior local slice before network I/O. Only an `APPLIED` or `IDEMPOTENT`
authoritative response is exposed locally. Rejections restore the returned
authoritative state.

The patient workspace presents explicit pending/result text. Typed outcomes
distinguish already-owned, ownership-changed, stale-version, authorization,
reconnect-required and unavailable states. A rejected optimistic mutation is
never presented as committed.

## Realtime and convergence

`shared_workflow_notifications` contains only exercise ID, patient ID, revision,
actor and time. It is the only new Realtime publication. A receiving client
fetches one scoped patient row, not the full exercise projection, then replaces
only that patient's workflow slice. Duplicate or older notification revisions
are harmless. A reconnect resubscription fails patient mutation closed until
the channel is available. Startup and resubscription subscribe first and then
hydrate the scoped authoritative patient heads, closing the missed-notification
window and preserving restart/reconnect convergence without downloading every
exercise.

## Offline policy

- Ownership, transfer, release and mutable actions require an online server
  decision and fail closed.
- Append actions also require connectivity in this version. Their stable IDs
  make explicit user retry safe after reconnect; there is no hidden offline
  queue and therefore no silent merge.
- The local proposal is transient and rolled back before awaiting the backend.

## Server enforcement and security

The additive migration creates patient heads, command ledger, metadata
notifications and `apply_shared_workflow_patient_mutation`. Tables have RLS,
anonymous access is revoked, and mobile roles receive read-only table grants.
All mutations pass through the authenticated RPC, which uses an empty
`search_path`, checks `CM_WORKFLOW_WRITE` or `EXCON_EXERCISE_CONTROL`, validates
scope, locks the patient head, verifies ownership/revision and attributes the
write to `auth.uid()`.

Direct CM insert/update of `exercise_states` is removed. EXCON retains the
lifecycle projection path. Runtime lease/CAS/checkpoint policy is unchanged.

## Instrumentation

Aggregate counters record ownership conflicts, stale-write rejections,
idempotent duplicates, concurrent mutations, successful retries and reconnect
conflict resolutions. No patient payload or clinical value is logged.

## Backward compatibility

The migration neither updates nor deletes historical `exercise_states`,
checkpoints, archives or hashes. Old snapshots remain readable. Patient heads
are created lazily and initially unowned; only an authenticated `CLAIM` or
`REACQUIRE` transition can establish ownership. Existing domain
arrays remain the external/local representation, while the new transaction
boundary makes new writes conflict-safe.

## Physical acceptance plan

Use two authenticated physical Android devices: CM-A and CM-B.

1. Simultaneous claim: exactly one winner; both devices/backend converge.
2. Transfer race: transfer succeeds and the former owner's stale mutation is rejected.
3. Concurrent append: separate note/vital/action IDs are both retained.
4. Concurrent mutable update: one succeeds and one receives `STALE_VERSION`.
5. Reconnect: disconnected device cannot commit, then refreshes the patient head
   and safely retries after reconnection.

Physical acceptance is deferred until the migration is deployed.
