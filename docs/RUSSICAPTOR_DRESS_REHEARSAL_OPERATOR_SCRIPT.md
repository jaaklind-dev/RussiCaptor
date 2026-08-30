# Dress rehearsal operator script

## Setup

1. EXCON prepares **Runtime Continuity Reference Package** and starts it. Wait for a durable checkpoint.
2. Sign Device A in as CM-A and Device B as CM-B. Confirm both show the same exercise and both patients. A third device stays signed in as EXCON when available.
3. Record source SHA, exercise ID, checkpoint revision and current owners. STOP if the GO checklist is not fully green.

## Two-device WP-NEXT-03 gate

1. **Claim:** open `PT-PELVIC-001` on A and B; tap **Võta patsient** together. One must succeed and one must show a conflict. Wait until both show the same owner.
2. **Transfer:** winner transfers Patient A to CM-B. Before A refreshes, attempt one normal mutable action on A. It must be rejected; B remains owner.
3. **Append:** from the same starting revision submit two distinct append-only records as permitted by the UI. Both IDs must appear once after convergence.
4. **Mutable conflict:** align both devices to the same Patient A revision, submit distinct mutable changes together. Exactly one commits; the other shows stale/conflict. No silent overwrite.
5. **Different patients:** A acts on Patient A while B acts on `PT-PLEURAL-001`. Both must succeed independently.
6. **Reconnect:** disconnect B, mutate with A, then reconnect B. B must hydrate authoritative state before any new write. STOP if stale data commits.

## Operations rehearsal

1. Continue one routine workflow, then force-stop the current Runtime writer device.
2. On EXCON diagnostics verify lease/checkpoint, wait for supported takeover eligibility, and use **Võta Runtime üle**. Confirm the former writer cannot write after return.
3. Simulate CM loss and repeat authenticated recovery on the spare device. With Device C, separately force-stop EXCON and verify the prepared EXCON can resume diagnostics; otherwise mark only this `REQUIRES_3_DEVICES` item deferred.
4. Complete through normal EXCON UI. Wait for COMPLETED, stopped Runtime, inactive lease, terminal checkpoint/archive and audit evidence.
5. Revoke temporary roles through trusted administration and run cleanup check. Never continue after an unexplained conflict, missing checkpoint, wrong actor, stale lease or backend outage.
