# Multi-device acceptance worksheet

Date: 2026-08-31 Exercise ID: `EX-1788095971438-1` Package: `russicaptor.runtime-continuity-reference@1.0.0`

Device A / CM-A: serial `R5GL236L6ZJ` model Samsung SM-X306B / Android 16 version 1.0.0 (validation versionCode 5) scope EXERCISE
Device B / CM-B: serial `R92X10DCNQD` model Samsung SM-X210 / Android 16 version 1.0.0 (validation versionCode 5) scope EXERCISE
Device C / EXCON (optional): serial ___ model ___ version/SHA ___ scope ___

Patient A `PT-PELVIC-001`: claim/transfer/same-patient conflict. Patient B `PT-PLEURAL-001`: different-patient concurrency.

| Gate | Class | Start rev/owner | Result | Final rev/owner | Evidence |
|---|---|---|---|---|---|
| Simultaneous claim | REQUIRES_2_DEVICES | rev 0 / unowned | NOT VALIDATED | rev 2 / CM-B | CM-A input did not submit; CM-B won without a real race. Losing UI later showed an explicit owner/takeover dialog; no raw RPC error. |
| Transfer + stale former owner | REQUIRES_2_DEVICES | rev 2 / CM-B | PARTIAL | rev 4 / CM-A | Supported request/accept transfer passed and both clients converged. A former-owner mutation was not submitted inside the convergence window, so stale-owner rejection remains unproven physically. |
| Concurrent append | REQUIRES_2_DEVICES | rev 4 / CM-A | PASS (owner-authorized path) | rev 7 / CM-A | Three distinct APPEND command IDs produced three retained records exactly once. Exclusive ownership intentionally prevents the other CM from mutating this patient. |
| Same-patient mutable conflict | REQUIRES_2_DEVICES | rev 7 / CM-A | BLOCKED | rev 7 / CM-A | Product UI makes the non-owner read-only and exposes no prepared owner-authorized two-client mutable-race harness. Test cannot be manufactured without bypassing ownership/CAS. |
| Different-patient concurrency | REQUIRES_2_DEVICES | pelvic rev 4 / CM-A; pleural rev 2 / CM-B | PASS | pelvic rev 5 / CM-A; pleural rev 3 / CM-B | Coordinated physical-client submissions both succeeded; independent APPEND commands and notifications were retained once. |
| Missed-update reconnect | REQUIRES_2_DEVICES | pelvic rev 6 / CM-A | PASS (scoped convergence) | pelvic rev 7 / CM-A | Device B Wi-Fi disconnected; Device A advanced pelvic to rev 7; after reconnect Device B resolved CM-A as current owner and offered supported takeover. No stale ownership retained. |
| Runtime writer loss/takeover | REQUIRES_2_DEVICES | checkpoint 88 | NOT RUN | lease INACTIVE | Dress rehearsal correctly stopped because critical WP-NEXT-03 claim/conflict gates were incomplete. |
| CM device loss | REQUIRES_2_DEVICES | ___ | NOT RUN | ___ | Dress rehearsal not entered. |
| Independent EXCON device loss | REQUIRES_3_DEVICES | ___ | PASS/FAIL/DEFER | ___ | ___ |
| Complete/terminal/archive/audit | REQUIRES_2_DEVICES | RUNNING | NOT RUN | RUNNING | Dress rehearsal not entered; prepared fixture retained for follow-up. |

Cleanup: assignments revoked NO (fixture retained); lifecycle terminal NO (`RUNNING`); lease inactive YES; ownership clear NO (CM-A/CM-B retain their test patients); checkpoint metadata present at revision 88; audit actor/result attributable. STOP reason: canonical v2 login crash required a narrow fix and validation build, while simultaneous-claim, stale-former-owner and same-patient mutable-conflict gates remain incomplete.
