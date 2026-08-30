# WP-NEXT-05 — Rugged-Tablet Interaction Safety

## Scope and policy

This work package hardens the existing Android tablet UI without changing clinical behavior, authentication, Runtime authority, CAS, lease, or shared-workflow semantics. The operational orientation remains intentionally locked to portrait. Rotation therefore cannot hide controls or discard an in-progress form.

Critical actions use an effective minimum 48dp target. Network-backed actions acknowledge the first press immediately, expose a pending/disabled state, and coalesce physical repeat presses into the same in-flight result. Destructive confirmation is reserved for completing an exercise, terminating an unrecoverable exercise, and ownership transfer/rejection.

## Interaction inventory and findings

| Path | Main risk | Severity | Resolution |
| --- | --- | --- | --- |
| Login | keyboard and delayed authentication could invite repeat presses | HIGH | existing immediate disabled/submitting feedback retained; global safe area added |
| Exercise selection and empty state | unclear remote/reconnect state | MEDIUM | existing CloudSync status text retained; raw Runtime codes replaced with operator wording |
| Scan and claim | repeated tap could issue duplicate claim; keyboard could consume navigation touch | CRITICAL | single-flight claim, immediate busy state, keyboard-safe layout |
| Patient ownership and transfer | adjacent actions and delayed server result | CRITICAL | 48dp targets, confirmation, screen-wide single-flight transfer gate, pending disable |
| Patient workspace mutations | repeat medication/intervention/note/order intent | CRITICAL | one in-flight authoritative mutation per workspace; immediate pending banner; backend command idempotency retained |
| Lifecycle Start/Pause/Complete | repeat press and irreversible Complete | CRITICAL | single-flight control gate, immediate pending label, 48dp targets, explicit destructive confirmation |
| Recovery/takeover | raw codes and ambiguous wait | HIGH | existing pending disable retained; conflict codes translated to actionable wording |
| Long patient forms | first tap after keyboard focus | HIGH | `keyboardShouldPersistTaps="handled"`; portrait scroll remains available |
| System bars and gesture inset | controls previously could sit under Android system UI | HIGH | root SafeAreaProvider/SafeAreaView protects all four edges |
| High-frequency clinical controls | small or tightly packed choices in legacy modules | MEDIUM | shared critical paths hardened now; remaining module-by-module visual normalization tracked below |

## Feedback and conflict presentation

Pending state is visible immediately and suppresses another logical intent until the authoritative result settles. Repeated presses share the same promise; this complements rather than replaces backend idempotency. Ownership remains visible by patient and transfer rejection/acceptance gives a named, factual outcome. Checkpoint and lease codes are never shown raw to field operators; the UI explains whether another device owns Runtime, reconnect is required, or remote recovery is available.

## Safe area, readability, and accessibility

All routes are inset-aware on top, bottom, left, and right. Primary and destructive controls use text labels, not color alone; disabled and pending states include wording or accessibility state. Critical touch targets are at least 48dp. Portrait is the documented and enforced field orientation, avoiding unsaved-intent loss during rotation while keeping long content scrollable.

## Validation and remaining risk

Automated coverage verifies single-flight duplicate suppression, pending state, safe-area integration, touch-target policy, ownership/conflict wording, destructive confirmation, keyboard tap handling, and absence of Dev Client interaction paths.

Physical validation used Samsung SM-X306B (`R5GL236L6ZJ`, Android 16, 1200×1920 at 320dpi) with a freshly built standalone validation release. Install/upgrade, cold relaunch, background/foreground, authenticated patient claim and mutation, long-content scrolling, keyboard appearance/dismissal, portrait enforcement, and both classic and gesture-navigation system insets passed. Five rapid claim presses produced one logical/applied claim, and five rapid note presses produced exactly one new applied append. Immediate pending and settled feedback remained visible.

With gesture navigation enabled, application content occupied y=60…1890, the Android gesture region occupied y=1890…1920, and the lowest critical control ended at y=1842. No control overlapped the system region. The original three-button navigation mode was restored afterward. The technical exercise was completed, its Runtime lease released, and all temporary role assignments revoked. Two-device ownership concurrency remains the separate WP-NEXT-03 physical gate.

Remaining MEDIUM risk: several lower-frequency clinical module buttons still define their target sizes locally. They are not authority/destructive controls, but should be sampled during physical smoke and normalized later only where a measured target is below 48dp.
