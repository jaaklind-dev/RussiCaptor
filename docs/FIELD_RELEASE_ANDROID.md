# Android field release operator guide

The canonical field artifact is a signed, non-debuggable APK built by `npm run field-release:android`. It contains its JavaScript bundle and does not require Expo Go, Metro, USB, or a developer workstation after installation.

## Prerequisites

- clean, reviewed Git commit on `main`;
- Node.js 24, Java 17, Android SDK/build-tools;
- production `EXPO_PUBLIC_SUPABASE_URL` and publishable key;
- canonical production Android keystore from macOS Keychain/local secure storage or the protected GitHub `field-release` environment;
- remote Supabase migrations listed in `release/field-release.json` already deployed.

The keystore is held outside Git in encrypted release-secret storage. Losing or changing it prevents in-place upgrades. Never use the validation debug identity for distribution.

## Build and verify

1. Update `applicationVersion`, monotonically increasing `versionCode`, filename, pinned signer fingerprint, and required migrations in `release/field-release.json`; keep `app.json` aligned.
2. Complete the release gate in the WP-NEXT-04 report.
3. Run `npm run field-release:android`, or manually dispatch **Android field release** in GitHub Actions.
4. Distribute the APK together with `release-manifest.json`, its `.sha256` file, this guide and the release notes from `dist/field-release/`. Only a canonical manifest with `distributable: true` is a field release.

## Fresh install

The old versionCode 1 validation APK is debug-signed and cannot be upgraded to the production signer. Perform the one-time approved uninstall/reinstall boundary, launch RussiCaptor, sign in with a provisioned production operator, and confirm the Supabase project reference shown on the login screen. Disable the temporary installation permission afterward.

## In-place upgrade

Build with the same package ID and signing identity and a higher `versionCode`, then install over the existing app. Do not uninstall first. Verify session/data retention, startup, restart, current-exercise discovery, and reconnect.

## Rollback

Android will not normally accept a lower `versionCode`. Preferred rollback is a new APK built from the last known-good Git commit using the same signing identity and a versionCode higher than every distributed build. Emergency uninstall/reinstall is last resort and deletes local app data/session; authoritative Supabase data is not deleted, but recovery must follow supported application workflows.

## Backend ordering

Deploy backward-compatible Supabase migrations before dependent clients. Keep old clients working during staged rollout. Never bundle destructive automatic migrations. Confirm the remote migration ledger contains every version required by the release manifest before installing the first client.
