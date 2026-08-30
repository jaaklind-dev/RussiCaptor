# WP-NEXT-07 — Production signing and distributable Android release

## Canonical signing model

RussiCaptor uses one stable Android field-release signer for `com.jaaklind.RussiCaptor`. The private JKS is never stored in Git. On the release Mac it is held at `~/Library/Application Support/RussiCaptor/signing/russicaptor-field-release.jks` with mode `0600`; its passwords are separate macOS Keychain entries. GitHub Actions receives the same keystore and credentials only through the protected `field-release` environment. There is no debug-signing or validation-signing fallback.

The public signer certificate SHA-256 is `b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b`. The build compares the APK signer against this pinned value. Losing or replacing the JKS would break in-place upgrades and requires an explicitly managed application-identity transition.

## Version and source policy

The first production-signed field release keeps versionName `1.0.0` and uses versionCode `2`. Every distributed APK increments versionCode; a signing-only change does not change the semantic product version. Release tags use `android-field-v<versionName>-<versionCode>` after the exact source commit is approved.

`npm run field-release:android` is the only production APK path. It requires a clean tracked tree, exact Git SHA, production Supabase public configuration, verified remote migration versions and the canonical signer. CI accepts only `main`, a clean checkout and protected release credentials. Controlled `upgrade-validation` and `rollback-validation` variants may use a higher versionCode with the same signer, but are always marked non-distributable.

## Artifact verification and provenance

The build verifies package ID, versionName/versionCode, non-debuggable state, absence of `SYSTEM_ALERT_WINDOW`, Android signature and pinned signer fingerprint. The generated manifest records Git SHA, UTC timestamp, environment/channel, artifact name/size/SHA-256, signer fingerprint, permissions, min/target SDK and verified Supabase migration versions. The package also contains a checksum and the field install/upgrade/rollback documentation. No binary is committed.

## Backend and authentication gate

WP-EGRESS-01/03/04 and WP-NEXT-02/03 database prerequisites must appear in the externally supplied verified deployment ledger. Missing entries fail release verification before Gradle runs. The remote ledger was checked against project `fimcsrivizpliiuoqopv`; no migration is deployed by the build.

Production configuration continues to require hosted Supabase URL, publishable key, provenance and a valid scoped operator session. Anonymous/demo sign-in, service-role material, Expo Go, Metro and `expo-dev-client` are absent from the field artifact. Runtime and CloudSync remain fail-closed without authenticated scope.

## Upgrade transition and rollback

The historical versionCode 1 validation APK uses Android Debug certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Android cannot upgrade it with the production signer. The transition therefore requires one documented uninstall/reinstall, which removes local app state and session but does not modify authoritative Supabase data. From production versionCode 2 onward, same-signer higher-versionCode APKs upgrade in place.

Operational rollback is not an Android downgrade. Build the previous known-good committed source with the same production signer and a versionCode higher than every deployed release. Install it over the current app. `adb install -d`, debug keys and uninstall/reinstall are not the field rollback strategy.

## Distribution and remaining gates

`dist/field-release/` contains the APK, release manifest, checksum, operator guide, release foundation, this report and known limitations. The GitHub workflow retains the same package as a protected artifact and does not publish to a store.

WP-NEXT-03 two-device concurrency and the full WP-NEXT-06 dress rehearsal remain deferred. They gate broad field rollout, not signing-pipeline correctness.

## Validation evidence

The production signer generated `RussiCaptor-1.0.0-2.apk` (137,502,671 bytes, SHA-256 `0dc711b1265b3a4aff120a1f53a79b9317889f96648d88f76ed4f2c767dcbb4f`). Android inspection reported package `com.jaaklind.RussiCaptor`, versionName `1.0.0`, versionCode `2`, minSdk 24, targetSdk 36, non-debuggable, no `SYSTEM_ALERT_WINDOW`, and the pinned signer fingerprint.

Samsung SM-X306B (`R5GL236L6ZJ`, Android 16) required the documented one-time uninstall of the debug-signed versionCode 1 artifact. Production-signed v2 then launched standalone and survived force-stop/relaunch. The login screen showed production environment, source SHA `aedcc138eda1316b655943a3f3756e630ea815e9`, versionCode 2 and Supabase project `fimcsrivizpliiuoqopv`; no fatal Android or React Native error was observed.

Same-signer `upgrade-validation` versionCode 3 installed over v2 without uninstall and preserved `firstInstallTime`. Same-signer `rollback-validation` versionCode 4 installed over v3 without a downgrade flag and again preserved the install boundary. Both launched with the expected production configuration and identical certificate fingerprint.

The acceptance artifacts are intentionally `distributable: false` because this WP remains uncommitted by instruction. The canonical script refuses to label a dirty tracked tree distributable. After the reviewed WP-NEXT-07 commit, the same protected pipeline must build canonical v2 from that exact clean SHA; only that generated manifest may say `distributable: true`.
