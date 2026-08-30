# Multi-device acceptance worksheet

Date: ___ Exercise ID: ___ Package: `russicaptor.runtime-continuity-reference@1.0.0`

Device A / CM-A: serial ___ model ___ version/SHA ___ scope ___
Device B / CM-B: serial ___ model ___ version/SHA ___ scope ___
Device C / EXCON (optional): serial ___ model ___ version/SHA ___ scope ___

Patient A `PT-PELVIC-001`: claim/transfer/same-patient conflict. Patient B `PT-PLEURAL-001`: different-patient concurrency.

| Gate | Class | Start rev/owner | Result | Final rev/owner | Evidence |
|---|---|---|---|---|---|
| Simultaneous claim | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |
| Transfer + stale former owner | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |
| Concurrent append | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |
| Same-patient mutable conflict | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |
| Different-patient concurrency | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |
| Missed-update reconnect | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |
| Runtime writer loss/takeover | REQUIRES_2_DEVICES | checkpoint ___ | PASS/FAIL | lease ___ | ___ |
| CM device loss | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |
| Independent EXCON device loss | REQUIRES_3_DEVICES | ___ | PASS/FAIL/DEFER | ___ | ___ |
| Complete/terminal/archive/audit | REQUIRES_2_DEVICES | ___ | PASS/FAIL | ___ | ___ |

Cleanup: assignments revoked ___; lifecycle terminal ___; lease inactive ___; ownership clear ___; checkpoint/archive aligned ___; audit actor/result ___ . STOP and retain diagnostics on any FAIL.
