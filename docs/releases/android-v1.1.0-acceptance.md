# RussiCaptor Android 1.1.0 — validated release

Validated on 2026-10-05. This record freezes the post-administration and production-UI Android release without redefining the historical Narva MVP baseline.

## Release identity

| Item | Validated value |
| --- | --- |
| Parent `main` | `f80fba151ab8516ae9604532a05861d3653d1e5f` |
| Release-code commit | `411f62350db8881ead0b8e090c1bfdfaee557578` |
| Evidence commit | annotated tag target (`android-v1.1.0-validated`) |
| Android version | `1.1.0` (`versionCode` 134) |
| Package ID | `com.jaaklind.RussiCaptor` |
| APK | `RussiCaptor-Android-1.1.0-v134.apk` |
| APK SHA-256 | `3b37d841cf8e39eeb38b33912d63cf8d5277e078d77fbb19564a164005693ec3` |
| Production signer SHA-256 | `b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b` |
| Narva package | `russicaptor.narva-trauma@1.0.5` |
| Narva package SHA-256 | `723d6c2fc57f34c2cf681215cf1a7149e5110ca1a34d618b2391a87aff5568c6` |

The APK was built from the clean release-code commit. These evidence-only files are not imported by the application bundle. The annotated tag points to the subsequent evidence commit; this distinction is intentional and auditable.

## Version decision

The canonical manifest previously remained at `1.0.0` / 90 while physical acceptance used non-canonical `upgrade-validation` builds up to 133. Canonical builds reject version overrides; the new canonical source is therefore `1.1.0` / 134. A release guardrail requires the Expo version, package version, release manifest, and Android versionCode to agree, and requires versionCode 134 to exceed the declared prior distributed maximum 133.

## Automated acceptance

- Full suite: **280 suites / 2196 tests / PASS**.
- Runtime guardrails: **19 suites / 241 tests / PASS**.
- Multi-device guardrails: **16 suites / 182 tests / PASS**.
- TypeScript: **PASS**.
- ESLint: **PASS**.
- Release configuration and monotonic version checks: **PASS**.
- `git diff --check`: **PASS**.

## Physical Android acceptance

Device: Samsung SM-X306B, serial `R5GL236L6ZJ`, Android 16.

- The existing production-signed `1.0.0` build 133 was verified with the same signer.
- `adb install -r` upgraded it to `1.1.0` build 134 without clearing data; the original install timestamp remained unchanged.
- Application startup, login, and normal production UI: **PASS**.
- Login displayed `Versioon 1.1.0 · järk 134`: **PASS**.
- `russicaptor://auth/callback` resolved to RussiCaptor; a token-free callback failed closed with a bounded user message: **PASS**.
- Platform Administration, Users, Exercises, and restricted Technical details: **PASS**.
- Exercise-scoped CM login exposed the assigned exercise and operational CM surface without Administration: **PASS**.
- Exercise-scoped EXCON login exposed the operator surface without development metadata: **PASS**.
- EXCON writer sign-out released the active writer lease immediately and completed Auth logout: **PASS**.
- A separate fresh install was not required after the successful realistic upgrade path.

No Imaging, ETT, transport, completion, or other clinical durable command was created during this release smoke.

## Backend readiness and cleanup

The Supabase project was healthy. Required runtime and User & Exercise Administration migrations were present, and the two admin Edge Functions were active with JWT verification enabled. The deployed auth callback behavior was unchanged from its validated configuration.

After smoke cleanup:

- active exercise-scoped assignments: **0**;
- active GLOBAL assignments: **0**;
- active writer leases: **0**;
- owned patients in the selected smoke TEST exercise: **0**.

## Included release scope

- User & Exercise Administration;
- secure real-user invitation and recovery callback flow;
- exercise-scoped CM/EXCON administration;
- account deactivate/reactivate lifecycle and bounded auditability;
- production UI cleanup and restricted diagnostics;
- hardened writer sign-out, including pending-publication drain ordering.

## Baseline relationship

`narva-mvp-v1.0.0-validated` remains fixed at `987eb5fc0cacf6bf2fc027cbda81b791aa088926`. It is the historical Narva MVP baseline and was not moved, recreated, or modified by this release.

Any change to release code, APK bytes, signer, version identity, backend authority semantics, or clinical package invalidates the corresponding part of this baseline until proportionate automated and physical regression is completed.
