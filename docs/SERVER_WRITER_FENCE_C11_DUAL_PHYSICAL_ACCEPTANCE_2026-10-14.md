# C11: two-physical-Android stale-writer acceptance — 2026-10-14

## Scope and evidence boundary

This is the **subsequent** physical C11 acceptance. The earlier [production server acceptance](SERVER_WRITER_FENCE_PRODUCTION_DEPLOY_2026-10-11.md) correctly recorded C11 as **NOT RUN at that earlier checkpoint**. The source tested here was `db4c970e483d3037994b1e5ce1ab2b9b252f1201`, before the post-C11 removal of the temporary diagnostic control. Production project: `fimcsrivizpliiuoqopv`. No migration or server permission change was made during C11.

The acceptance artifact was `RussiCaptor-1.2.0-172-upgrade-validation.apk`, versionCode **172**, SHA-256 `f02240d6bc40bbbb5d6ad5958e5b6abb7fc86df9617b4c3d8cecbdcc862f36ac`. The repository-local artifact was rehashed with that result during the post-C11 audit. It was an **upgrade-validation, non-distributable** build, not a release APK. The previous physical run recorded the same APK/source identity on Samsung A `R5GL236L6ZJ` (SM-X306B, Android 16) and Samsung B `R92X10DCNQD` (SM-X210, Android 16). That device/install observation is from the physical run; server logs alone cannot identify the Samsung serial.

Controlled TEST exercise: `EX-1792005514997-1`, package `russicaptor.narva-trauma@1.0.5`. One existing operator account was used on both physical devices with an exercise-scoped EXCON role; no second account or GLOBAL role was needed. The previous physical run recorded a successful Device A publish, active Device B takeover, a Device A physical stale-probe send, Device B continuation, Device A force-stop/restart, and supported finalization. These UI observations were not repeated in this documentation work.

## Retained server evidence (UTC)

The following rows were re-read on 2026-10-15 using **read-only** production queries against `exercise_state_publication_operations`, `runtime_writer_leases`, and `exercise_states`. Production `edge_logs` and `postgres_logs` were queried only for the narrow 2026-10-14 19:30:35–19:31:10 UTC interval.

Evidence locators: local ignored artifact `dist/field-release/RussiCaptor-1.2.0-172-upgrade-validation.apk` and its `release-manifest.json` (`distributable=false`, `c11StaleWriterProbe=true`, source `db4c970e…`); production `public.exercise_state_publication_operations WHERE exercise_id='EX-1792005514997-1' ORDER BY created_at`; `public.runtime_writer_leases WHERE exercise_id='EX-1792005514997-1'`; `public.exercise_states WHERE exercise_id='EX-1792005514997-1'`; Supabase unified logs for project `fimcsrivizpliiuoqopv`, sources `edge_logs`/`postgres_logs`, 19:30:35–19:31:10 UTC, filtered for the publish RPC and `WRITER_GENERATION_STALE`. The artifact is local test evidence, not committed to Git or approved for distribution.

| Event | Observed evidence |
| --- | --- |
| READY create | `ADMIN-CREATE-1792005514997-1`, revision 1, 19:19:06.209501. |
| A initial start and publications | Lease `076516f2-f007-4a39-97da-d2d42c23eed8`, generation **1** in the physical acceptance record. START-RUNNING revision 2 at 19:23:44.359996; further A receipts advanced revisions 3, 4, 5 and 6 through 19:27:49.434978. The overwritten A lease row no longer retains A's `writer_instance_id`; the lease UUID is the durable A identity available in the operation receipts. Do not substitute a guessed instance ID. |
| B active takeover | Current lease row records B lease `53e724ae-d311-4222-8a96-fcd5dd08deb8`, `writer_instance_id=runtime-muqi7a1q-75hil6cre25`, generation **2**, acquired 19:28:36.828826. One canonical lease row exists for the exercise. |
| B pre-rejection publication | B lease receipt `projection-1792006182342-121`, revision **7**, 19:29:44.440438. |
| Physical A stale-probe attempt | The prior physical acceptance recorded operation ID `C11-PROBE-mv8i3kn1-b6j79v8zq0` sent from Device A with its captured old lease/generation. The production API log records `POST /rest/v1/rpc/publish_exercise_state_current_writer`, Android `okhttp/4.9.2`, **HTTP 403** at **19:30:45.663**. PostgreSQL logs `WRITER_GENERATION_STALE` at **19:30:45.717**. The server logs do not include the operation ID or device serial; correlation to the physical probe is by the recorded test sequence and timestamp, not by a server-side request-ID join. |
| Zero A durable mutation | There is **no** operation receipt for `C11-PROBE-mv8i3kn1-b6j79v8zq0`. The latest successful receipt before the rejection is B's revision 7 and the next is B's revision 8 at 19:31:00.468387. The deployed publish function raises `WRITER_GENERATION_STALE` before its canonical UPDATE; the rejected database transaction cannot commit a partial update. This is the server-side basis for the zero-mutation conclusion. A complete before/after payload fingerprint at the instant of rejection was not retained; do not treat the final exercise payload as that snapshot. |
| B continuation | B lease advanced revisions **8–12** after rejection, including revision 8 at 19:31:00.468387 and revision 12 at 19:35:18.109252. An API POST 200 is logged at 19:31:00.336. |
| A restart | The physical run reported force-stop/restart of A without restoration of stale writer authority. This is a physical observation, not independently encoded in the retained database row. |
| Finalization | The canonical exercise row is `COMPLETED`, revision **13**, updated 19:35:36.682921. B's lease was released at that same time. |

The physical run recorded a maximum of **one authoritative writer**. The single `runtime_writer_leases` row and generation transition 1→2 support the server contract, but a current-state query by itself is not a historical maximum-over-time measurement.

## Cleanup readback

Read-only 2026-10-15 checks scoped to this TEST exercise returned: active writer leases **0**; active exercise-scoped roles **0**; patient owners **0**; unused bootstrap authorizations **0**; stale-probe durable receipts **0**. The TEST exercise remains COMPLETED as audit evidence; it was not deleted. Earlier physical cleanup also reported zero temporary GLOBAL/admin roles and no RUNNING/PAUSED TEST residue. Those broader counts were not independently recomputed in this narrow readback.

## Acceptance-only boundary and conclusion

The APK 172 diagnostic control was gated to a non-distributable validation build and an authenticated, exercise-scoped EXCON session. It captured A's real lease and original generation, sent one ordinary `publish_exercise_state_current_writer` RPC, and bypassed only the client's local stale-send suppression. It used neither a service-role credential, direct `exercise_states` write, nor an RLS exception; the production server rejected it. The diagnostic service, UI, and build activation flag are removed in the subsequent post-C11 merge-preparation commit. Historical evidence is retained here rather than retaining the production-facing diagnostic mechanism.

Observed server rejection plus durable operation ordering, together with the recorded two-device physical sequence, support **C11 = PASS** and `SERVER_WRITER_FENCE_ATOMICITY_GATE = PASS` for source `db4c970e483d3037994b1e5ce1ab2b9b252f1201`. This conclusion does **not** itself approve a distributable APK, merge, tag, or release. The physical test is not repeated for the source-only diagnostic removal; automated regression and a separate release gate cover the later build.
