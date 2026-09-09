# WP-NARVA-08 release freeze and dress-rehearsal evidence

Date: 2026-09-09

Status: `NARVA_DRESS_REHEARSAL_BLOCKER_FOUND`

## Frozen release candidate

- Source: `a8d06284fe1e97419c42857e9bc09dc590f5b806`
- Trauma package: `russicaptor.narva-trauma@1.0.1`
- Trauma catalog hash: `bcefea0e0a08c7e92ab3ba33b82d317daf6e2499f84caefffdf086a223136cc5`
- Trauma definition hash: `1fb41fb8bd06e1f0492bfe2a0a7d6d076cdb36a6f7d60a9e73a1484b08d4fa35`
- IRO package: `russicaptor.narva-iro-evacuation@1.0.0`
- IRO reference hash: `cc3bfde4a9723a8328aed726df08823590da82f7e8e25a5a5cf853ac1c4854e5`
- APK: `RussiCaptor-1.0.0-64-upgrade-validation.apk`
- Version: `1.0.0` / versionCode `64`
- APK SHA-256: `4b5efe908ad6b7250ee7445fef2d02813047ebb73a915285bb5f47e6abbaf732`
- Signer SHA-256: `b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b`
- Source dirty: `false`
- Production signed and non-debuggable: yes
- Validation harness: enabled
- Distributable: no

## Automated release gate

The exact frozen source passed the release gate before the physical rehearsal:

- Focused release checks: 15 suites, 109 tests passed
- Full suite: 195 suites, 1,543 tests passed
- Runtime Hardening: 2/2 passed
- TypeScript: passed
- ESLint: passed
- `git diff --check`: passed
- Persistence performance: passed; representative payload 1,877,524 bytes, checkpoint capture 27 ms in the focused run and 29 ms in the full run, timer delay 111/116 ms, canonicalization 9/12 ms, hashing 11/11 ms, delta generation 113/125 ms
- Historical/hash compatibility: passed
- Narva trauma and IRO package checks: passed
- Multi-CM, ownership/CAS/idempotency, A/B/D, completion, recovery, terminal immutability, heartbeat/lease, checkpoint publication, and Realtime/recovery checks: passed

No thresholds were changed.

## Migration and backend freeze

Frozen HEAD contains 23 tracked migration files. The remote migration ledger reports the following post-ledger versions, all matched by migration name to the corresponding tracked local migration:

- `202608190001` — runtime checkpoint egress hardening
- `20260826190508` — runtime checkpoint metadata Realtime
- `20260828083146` — runtime checkpoint delta hydration
- `20260828113258` — runtime checkpoint delta byte budget
- `20260829124632` — production operator identity authorization
- `20260829124829` — production operator identity authorization hardening
- `20260829135717` — conflict-safe multi-CM shared workflow
- `20260901071320` — stale-checkpoint expired-lease recovery
- `20260901071552` — stale-checkpoint payload-envelope fix
- `20260906063421` — package-projection divergence recovery
- `20260907162401` — Narva multi-CM terminal convergence
- `20260907163503` — Narva terminal projection fence
- `20260908042246` — terminal completion SQL qualification
- `20260908091942` — Runtime patient-command SQL qualification
- `20260909060818` — terminal shared-workflow mutation fence

The eight older foundational local migrations predate the remote CLI ledger. Their required schema/RPC capabilities were verified directly on the backend. Required tables, RLS, grants, RPCs, Realtime publication, terminal fencing, and package-registry compatibility passed. Missing required migration capability: zero. No backend change or migration deployment was performed in this work package.

## Devices and remote fixture

- Device A: Samsung SM-X306B, serial `R5GL236L6ZJ`, Android 16, mobile network available, v64 installed in place
- Device B: Samsung SM-X210, serial `R92X10DCNQD`, Android 16, Wi-Fi available, v64 installed in place
- Exercise: `EX-1788947202682-1`
- Package: `russicaptor.narva-trauma@1.0.1`
- Roles: CM-A, CM-B, and EXCON, each scoped only to this exercise
- Active global rehearsal roles: zero
- Patient ownership at stop: pelvic = CM-A at revision 9; chest = CM-B at revision 5

No credentials, tokens, principal identifiers, or service-role material are recorded here. During device preparation, accidentally exposed technical-account passwords were immediately rotated and active sessions were revoked; only the replacement credentials stored in macOS Keychain remained valid.

## Physical workflow evidence

Two CMs successfully claimed different patients and submitted clinical commands through the supported workflow. Authoritative Runtime patient-command evidence materialized:

- Pelvic: peripheral IV, pelvic binder, MTP activation, RBC start, RBC delivery-mode switch to rapid infuser, and later plasma start
- Chest: pleural drain and two peripheral IV accesses
- A first plasma request was correctly rejected with `NO_FREE_VASCULAR_ACCESS`; it produced no partial administration
- No duplicate materialized command was observed

At checkpoint revision 100, the chest Runtime preserved initial pleural drainage of 1,450 mL, ongoing drain rate 3.333333 mL/min (200 mL/h), and total drain output about 1,672.56 mL. The pelvic Runtime preserved the binder intervention and the transfusion workflow. Additional pelvic TXA, fibrinogen, calcium, analgesia, and the remaining transport/completion gates were not run after the blocker was confirmed.

## Release blockers found

### 1. Non-writer transport was accepted locally but not made authoritative

On the CM-B device, the chest patient transport to IVKH was accepted by the visible workflow and shown locally as `IN_TRANSIT`. Backend evidence subsequently showed:

- no corresponding `runtime_patient_commands` row;
- `patientTransportRuntime.sequence = 0`;
- `patientTransportRuntime.transports = []`;
- the reanimobile remained `AVAILABLE`;
- both patient locations remained `NARVA_ED`.

After authoritative reconciliation/restart, the local transport state disappeared. The attempted physical order was chest to IVKH; authoritative transport order remained none. This is a lost operator mutation and prevents the required multi-CM transport rehearsal.

### 2. Cold-restarted read-only CM did not restore its patient's Runtime

After Device A was cold restarted while Device B held the Runtime writer lease, Device A rediscovered the correct running exercise and restored CM-A ownership, but the patient Actions view showed:

`Patsiendi Runtime ei ole ravikorralduseks valmis.`

and:

`Aktiivset ravi ei ole.`

This persisted while the remote checkpoint contained two valid persisted Runtime states and the pelvic patient retained authoritative binder/transfusion evidence. Device A's local trace recorded checkpoint preparation with `persistedRuntimeCount: 0`. Therefore the restarted non-writer client could not continue normal treatment despite valid authoritative Runtime state. This fails the required restart/reconnect and multi-CM operational gates.

### Stop-state backend evidence

- Exercise lifecycle: `RUNNING`
- Exercise projection revision: 23 at the final evidence query
- Exercise projection simulation time: 9,314 s
- Latest durable checkpoint: revision 100, `RUNNING`, simulation time 6,374 s
- Checkpoint payload: 9,261,839 bytes, two persisted Runtime states
- Checkpoint hash: `371e6a1af3b9dcc20e22ecc08666797e982ed94e4db3465b213943f536e3304b`
- Transport sequence/count: 0 / 0
- Completion requests: 0
- Writer lease: active, unreleased
- Runtime writer: Device B's current Runtime instance

Routine checkpoint revision 100 was also materially behind the live exercise projection while Device B logged repeated routine publication transport timeouts. This was recorded as supporting evidence, not independently classified as the primary release blocker.

## Rehearsal decision

The freeze-break policy requires stopping on a demonstrated release blocker. The remaining trauma workflow, transport lifecycle, completion, post-terminal immutability, post-completion restart, and IRO physical rehearsal were therefore not executed. Frozen source was not modified. No commit was created and nothing was pushed.

After the evidence capture, both app processes were force-stopped to prevent further simulation progress or network traffic. The exercise-scoped roles and failed rehearsal fixture were intentionally left in place for reproducible follow-up diagnosis; the lease was not represented as explicitly released because terminal completion was not run.

Smallest next work should address, with dedicated regressions, (1) authoritative routing/fencing of transport commands from a non-writer CM and (2) hydration of persisted patient Runtime state on a restarted read-only CM. The frozen baseline must not otherwise be changed.

Narva decision: **NO-GO** until both defects are fixed and the trauma dress rehearsal is rerun; IRO physical rehearsal remains pending afterward.

## Authorized WP-NARVA-09 freeze break

The original frozen HEAD remains `a8d06284fe1e97419c42857e9bc09dc590f5b806`.
The freeze was intentionally broken on 2026-09-09 only for the two physical
release blockers documented above.

- `1433a60` — `fix(transport): route non-writer transport authoritatively`
- `fa278a1` — `fix(runtime): hydrate patient runtime for non-writer readers`
- Proposed candidate HEAD before this evidence commit: `fa278a1`

Transport now uses the authenticated, patient-owned, revision-checked durable
Runtime patient-command inbox. A non-writer submission remains visibly pending
and does not mutate the local transport engine; the one active Runtime writer
materializes the command into the existing transport engine. Existing command
idempotency, completion fencing and reanimobile exclusivity remain authoritative.

A validated same-exercise reader Runtime is no longer discarded by a later
discovery-projection echo. Reader hydration continues to use the existing
validated checkpoint/cache/delta path, starts neither a writer heartbeat nor a
second writer lease, and keeps every Runtime mutation method write-authority
gated.

The forward-only migration
`20260909123250_add_transport_runtime_patient_command.sql` was deployed through
the supported migration workflow. Remote verification confirmed both the table
constraint and `submit_runtime_patient_command` RPC accept `TRANSPORT_START`;
authentication, exercise-scoped authorization, patient ownership, patient CAS,
idempotency and terminal completion fencing remain enforced.

Regression evidence on the combined candidate:

- focused blocker/regression gate: 17 suites, 190 tests passed;
- complete suite: 198 suites, 1,559 tests passed;
- Runtime Hardening and persistence performance: 5/5 tests passed;
- representative persistence payload: 1,877,524 bytes; checkpoint capture 107 ms;
- TypeScript: passed on the candidate sources (an excluded pre-existing untracked
  diagnostic test is not part of the candidate);
- ESLint: passed;
- `git diff --check`: passed;
- no historical package, clinical physiology, checkpoint hash, CAS, lease,
  heartbeat or completion semantics were changed.

This candidate is not re-frozen yet. A clean versionCode 65 validation build and
the narrow two-device transport/restart retest are still required before the
candidate can replace the original frozen baseline.
