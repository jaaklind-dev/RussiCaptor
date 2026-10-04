# Narva MVP 1.0.0 — Validated Release Baseline

Freeze date: 2026-10-04
Status: **VALIDATED**

## 1. Release identity

This record freezes the exact validated tuple below. The runtime source commit is
the physically tested baseline. The later documentation-only commit records this
evidence and must not be described as physically validated.

| Identity | Validated value |
| --- | --- |
| Runtime source commit | `987eb5fc0cacf6bf2fc027cbda81b791aa088926` |
| APK SHA-256 | `f8972c5c2115d54dd6bebc222aa8c617bdade036f38645fb2544d00f9e14910b` |
| Signer SHA-256 | `b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b` |
| Narva package hash | `723d6c2fc57f34c2cf681215cf1a7149e5110ca1a34d618b2391a87aff5568c6` |

Machine-readable evidence: [narva-mvp-1.0.0-baseline.json](narva-mvp-1.0.0-baseline.json).

## 2. Source commit

- Validated runtime baseline: `987eb5fc0cacf6bf2fc027cbda81b791aa088926`
- Branch at freeze: `wp-narva-10b1`
- Validation expectation: clean working tree
- The release-documentation commit is evidence-only and does not replace the
  validated runtime baseline.

## 3. APK identity

- Artifact: `dist/field-release/RussiCaptor-1.0.0-126-upgrade-validation.apk`
- versionName: `1.0.0`
- versionCode: `126`
- APK SHA-256: `f8972c5c2115d54dd6bebc222aa8c617bdade036f38645fb2544d00f9e14910b`
- Production signer SHA-256:
  `b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b`

The APK was verified in place. It was not rebuilt for this freeze record.

## 4. Package identity

- Package: `russicaptor.narva-trauma@1.0.5`
- Package hash: `723d6c2fc57f34c2cf681215cf1a7149e5110ca1a34d618b2391a87aff5568c6`
- Both final patient Runtime artifacts recorded this package identity and hash.

## 5. Test environment

- Physical client: Samsung SM-X306B, serial `R5GL236L6ZJ`, Android 16
- Second client: Android emulator `Pixel_10_Pro_XL`, Android 17
- Both clients used the same versionCode 126 APK and production signer.

## 6. Physical acceptance summary

Final exercise: `EX-1791101412200-1`

Final durable evidence:

- P02 completion:
  `PATIENT_COMPLETE:EX-1791101412200-1:PT-CHEST-001:1`
- P01 internal transfer:
  `PATIENT_LOCATION_TRANSFER:EX-1791101412200-1:PT-PELVIC-001:P01-MOVE-ED:1`
- P01 completion:
  `PATIENT_COMPLETE:EX-1791101412200-1:PT-PELVIC-001:1`
- Terminal checkpoint revision: `346`
- Terminal checkpoint hash:
  `c80771b747d7ee214fce6fd19f779deeda490ec5d354af18da3e9e5fa6b3dd46`

Final state:

- P01: `Completed`, `NARVA_ED`, owner `null`
- P02: `Completed`, `NARVA_ED`, owner `null`
- Active assignments: `0`
- GLOBAL assignments: `0`
- Active writer leases: `0`
- Stale patient owners: `0`

Latest final gate:
`PATIENT_COMPLETION_FINALIZATION_PHYSICAL_GATE = PASS`.

## 7. Closed gates

| Gate | State |
| --- | --- |
| Runtime bootstrap | CLOSED / PASS |
| CM reader readiness | CLOSED / PASS |
| P01 package-owned location authority | CLOSED / PASS |
| Imaging durable lifecycle | CLOSED / PASS |
| ETT durable canonical materialization | CLOSED / PASS |
| Transport physical regression | CLOSED / PASS |
| PATIENT_COMPLETE canonical release | CLOSED / PASS |
| Two-client convergence | CLOSED / PASS |
| Restart persistence | CLOSED / PASS |
| Emulator cold-start hydration | CLOSED / PASS |
| Writer takeover | CLOSED / PASS |
| Stale-writer rejection | CLOSED / PASS |
| P01 durable transfer | CLOSED / PASS |
| P02 completion | CLOSED / PASS |
| P01 completion | CLOSED / PASS |
| Both patients completed | CLOSED / PASS |
| Exercise finalization | CLOSED / PASS |
| Terminal checkpoint validation | CLOSED / PASS |
| Terminal restart/readback | CLOSED / PASS |
| Terminal stale-client rejection | CLOSED / PASS |
| Final cleanup | CLOSED / PASS |

## 8. Exactly-once guarantees demonstrated

- Each patient had one `PATIENT_COMPLETE` command, one writer materialization,
  one completion evidence event, and one assignment end.
- P01 had one `P01-MOVE-ED` command and one transfer evidence event.
- Exercise finalization had one completion request and one canonical terminal
  checkpoint lineage.
- Restart and replay introduced no duplicate command, evidence, ownership-release,
  transfer, or finalization effects.

## 9. Multi-client and write-authority guarantees demonstrated

- An ordinary scoped CM reader submitted durable patient commands.
- Only the canonical writer materialized commands and published checkpoints.
- Samsung-to-emulator and emulator-to-Samsung takeover maintained at most one
  active writer.
- A stale former writer could not regress patient state, reclaim ownership,
  duplicate commands, or publish a non-terminal checkpoint.

## 10. Restart and hydration guarantees demonstrated

The baseline includes the hydration correction at commit
`987eb5fc0cacf6bf2fc027cbda81b791aa088926`:

- React Native cooperative frame-yield;
- `requestAnimationFrame`;
- bounded 50 ms timer fallback;
- frame cancellation where applicable.

Validated outcomes were restoration of the large two-patient checkpoint and both
patient Runtime artifacts on the emulator, reader transition to `READY`, rendered
UI, and supported writer takeover after restart.

## 11. Terminal finalization guarantees demonstrated

- Both patients were `Completed` and unowned before finalization.
- Exercise lifecycle became `COMPLETED` exactly once.
- Terminal checkpoint revision 346 contained both completed patients and null
  owners.
- Restarting both clients retained terminal readback without creating a writer
  lease, readiness loop, or blank UI.
- Stale-client re-entry did not reopen the exercise or rewrite the terminal
  checkpoint.

## 12. Cleanup result

Cleanup used supported audited lifecycle paths. The final exercise retained its
audit history while ending with zero active scoped assignments, zero GLOBAL
assignments, zero writer leases, and zero stale patient owners. Temporary roles
were revoked and the consumed bootstrap authorization was revoked.

## 13. Known limitations and non-blocking debt

- No known defect remains in the validated Narva MVP acceptance scope.
- Destination-specific restrictions and consult/OR/receiving semantics remain
  authority questions. They are not missing validated functionality and require
  new source authority before implementation.
- The validation APK is a controlled acceptance artifact; distribution policy is
  separately governed by the Android field-release process.

## 14. Automated evidence

The latest validated complete suite result was 271 suites and 2,130 tests: PASS.
It is recorded evidence and was not rerun solely to create these documents.

Final acceptance regressions also passed:

- PATIENT_COMPLETE tests;
- finalization tests;
- terminal checkpoint tests;
- hydration tests;
- ownership/shared-workflow tests;
- takeover tests;
- Runtime guardrails;
- multi-device guardrails;
- TypeScript;
- ESLint;
- `git diff --check`.

## 15. Freeze policy

The validated baseline is the exact tuple of runtime Git commit, APK SHA-256,
signer SHA-256, and Narva package hash recorded in section 1. A change to any
tuple member is not this validated baseline and must not inherit its validation
status without applicable revalidation.

## 16. Revalidation triggers

| Change class | Required response |
| --- | --- |
| A. Documentation-only | Runtime acceptance remains valid. |
| B. UI-only, no runtime/package semantics | Run targeted UI regression. |
| C. Runtime, persistence, or multi-client | Run relevant automated and physical regression. |
| D. Clinical or package logic | Repeat the affected patient/package gate. |
| E. Supabase schema, RPC, or RLS | Run backend and physical multi-client regression. |
| F. Build or signing | Verify APK identity, signature, and release configuration. |

Any new documentation commit records this evidence only. The physically tested
source identity remains `987eb5fc0cacf6bf2fc027cbda81b791aa088926`.
