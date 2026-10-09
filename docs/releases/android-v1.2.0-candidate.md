# RussiCaptor Android 1.2.0 — signed release candidate

Candidate validated on 2026-10-09. This is **not** a final validated release or a distribution announcement.

## Source and version

| Item | Candidate value |
| --- | --- |
| Starting `main` | `3880c3d528b4d043a9382fb00d80c0c0105da52a` |
| APK source commit | `32d1f3a7c2c8e68bbacd22985cd667d8ac901acc` |
| Release branch | `release/android-v1.2.0` |
| Android version | `1.2.0` / `versionCode` 151 |
| APK | `RussiCaptor-Android-1.2.0-v151.apk` |
| APK SHA-256 | `5df9009768eafb6238b0ca1d9965053b7b9252e15b686114e5c62c05febce40c` |
| APK size | 137,201,051 bytes |
| Production signer SHA-256 | `b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b` |
| Package ID | `com.jaaklind.RussiCaptor` |
| Previous validated Android tag | `android-v1.1.0-validated` (unchanged) |

The signed, non-debuggable APK was built from the release-preparation commit. This evidence document was written afterward and is **not** bundled in that APK. No final `android-v1.2.0-validated` tag or GitHub Release was created.

## EAS version preflight

The read-only EAS Android remote version query returned `versionCode` 1. `eas.json` uses `appVersionSource: remote`, and the production profile enables auto-increment. The canonical local field-release build uses `release/field-release.json`; it does not advance the EAS counter. VersionCode 151 exceeds the prior distributed 134, the highest known validation build 150, and the observed EAS remote value 1.

**Future EAS cloud builds need a separate remote-version alignment check.** With the currently observed remote counter, EAS auto-increment alone would not produce this candidate's versionCode. Do not mistake the locally signed candidate for an EAS cloud build.

## Automated regression

- Targeted Admin, role-mode, auth, readiness, sign-out, finalization, and UI tests: **19 suites / 202 tests / PASS**.
- Runtime guardrails: **PASS**.
- Multi-device guardrails: **16 suites / 182 tests / PASS**.
- Full suite: **298 suites / 2433 tests / PASS**.
- TypeScript, ESLint, release configuration, and `git diff --check`: **PASS**.

The guardrails use the unchanged external Narva workbook fixtures. Only temporary references outside the Git worktree were needed to make those read-only fixtures visible to the clean release worktree.

## Targeted physical acceptance

Primary device: Samsung SM-X306B, serial `R5GL236L6ZJ`, Android 16. The previously installed signed build was `1.1.0` / 150. The candidate installed in place without clearing application data, launched normally, and restored the existing authenticated Admin session after a cold app restart. The login screen briefly displayed `Versioon 1.2.0 · järk 151` during startup. No blank screen or readiness loop was observed.

- Administration and Users opened; Exercises opened repeatedly and rendered existing exercises.
- Package selection, Back, Cancel, and a fresh second selection showed no stale package choice.
- Admin → CM → Admin → EXCON → CM worked without logout under one authenticated multi-role test identity. The temporary roles were both `EXERCISE` scoped; no GLOBAL role was created. No writer lease was acquired in the READY fixture, so writer-release-on-mode-switch was not applicable.
- A token-free `russicaptor://auth/callback` link opened the app and failed closed with the bounded message “Autentimislink ei ole kehtiv.” No reset email or credential was used.
- Exactly one durable Narva TEST exercise, `EX-1791521001952-1`, was created from `russicaptor.narva-trauma@1.0.5`. The initial `exercise_states` acknowledgement was revision 1, and the same exercise was discovered after app restart. It was started and completed through supported EXCON controls for cleanup, ending at projection revision 4. No clinical durable command was created.

## Cleanup and release boundary

Both temporary exercise-scoped roles were revoked. The TEST exercise is `COMPLETED` with zero active scoped assignments, zero stale patient owners, and no active writer lease. Global active assignments and active unused bootstrap authorizations are zero.

The validated 1.1.0 tag is unchanged. This candidate record does not mark Android 1.2.0 as a final validated release. Final tagging and publication require a separate decision.
