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
4. Verify the signed artifact with `node scripts/verify-field-release-artifact.mjs dist/field-release/release-manifest.json --require-canonical`. Only after separate publication authorization, distribute the APK together with `release-manifest.json`, its `.sha256` file, this guide and release notes from `dist/field-release/`. A mutable manifest alone is not release proof.

The next canonical candidate `versionCode` is **179**, following canonical APK 178 and incorporating the validated discovery-unavailable navigation correction. `minimumVersionCodeExclusive` is 178, preserving in-place upgrade ordering. `versionName` remains 1.2.0. Repository history and GitHub release assets were checked during preparation: no version 179 was recorded. The installed canonical baseline is APK 178. The canonical local field build uses this descriptor; this preparation does not query or advance the separate EAS remote version counter.

APK 175 was the earlier canonical candidate, followed by acceptance-only APK 176, canonical restoration APK 177 and Admin creation fix APK 178. APK 179 preparation does not authorize installation, production completion recovery or publication. Pending completion recovery was validated in isolated PostgreSQL fixtures, not executed in production. Production was read-only verified at 53/53 migrations, including `20261016065854_ready_exercise_cancellation.sql`, with activation OFF. Each actual build still requires fresh verified production ledger evidence; do not substitute scratch history or fabricated metadata. The existing signer, package identity, and writer-fence requirements remain unchanged. Physical recovery validation and runtime image acceptance remain open.

### Predeployment candidate (technical verification only)

`npm run field-release:android -- --mode=predeployment-candidate` uses the committed versionName/versionCode (currently 1.2.0 / 179), package ID and existing production signer. It requires clean committed source and verifies the entire local migration set against Git HEAD. It does not deploy or enable anything. No APK was built as part of implementing this mode.

Supply the real read-only production ledger via `RUSSICAPTOR_DEPLOYED_MIGRATIONS` and bind it to `RUSSICAPTOR_MIGRATION_PROJECT_REF=fimcsrivizpliiuoqopv`. This remains an operator/protected-CI evidence boundary, not a live database query or proof of the supplied ledger's authenticity. Malformed, duplicate or wrong-project evidence fails both modes. Missing evidence is explicitly `UNAVAILABLE`: required versions are unverified, not falsely classified as confirmed absent. A valid partial ledger records the exact missing requirements and `productionCompatibility=BLOCKED`. A complete ledger can establish compatibility PASS, but never makes a candidate distributable.

Candidate output is isolated under `dist/predeployment-candidate/`, with `RussiCaptor-1.2.0-179-predeployment-candidate.apk` and `predeployment-candidate-manifest.json`. The manifest separately records build validity, signing verification, package/version identity, all local migration SHA-256 values, production compatibility/evidence/missing versions, source commit and APK/signer SHA-256. Every candidate has `distributable=false`, `publicationAuthorization=NOT_GRANTED`, `automaticPublication=false` and `promotionPolicy=CANONICAL_REBUILD_REQUIRED`. It cannot enable the validation harness.

The APK also contains signature-protected `assets/russicaptor-build-evidence.json`. `node scripts/verify-field-release-artifact.mjs <manifest-path>` independently verifies the APK signature, pinned production signer, package/version, non-debuggable configuration, APK hash and embedded evidence. Changing only the sidecar cannot turn a candidate into a canonical artifact. Do not install, distribute or publish a predeployment candidate under this technical build authorization. Existing validation APK modes still require a higher versionCode and verified compatible production migrations.

Canonical builds always enforce production migration verification, independent of `RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS`. CI explicitly selects canonical mode and revalidates the signed artifact with `--require-canonical` before uploading its canonical output directory. Static `field-release:verify` without a mode remains an offline configuration check, not a production compatibility or publication approval. After separately authorized backend deployment, rebuild through the canonical process; do not promote a candidate by renaming files or editing metadata. `distributable=true` means technical canonical eligibility only: publication authorization and all operational/physical release gates remain separate and are never granted by the build.

This change affects release tooling only, not Runtime authority, persistence, lifecycle, UI, RLS or migration SQL. Runtime/security/persistence guardrails and the full regression remain mandatory; no new physical interaction is introduced by this build-mode change.

## Fresh install

The old versionCode 1 validation APK is debug-signed and cannot be upgraded to the production signer. Perform the one-time approved uninstall/reinstall boundary, launch RussiCaptor, sign in with a provisioned production operator, and confirm the Supabase project reference shown on the login screen. Disable the temporary installation permission afterward.

## In-place upgrade

Build with the same package ID and signing identity and a higher `versionCode`, then install over the existing app. Do not uninstall first. Verify session/data retention, startup, restart, current-exercise discovery, and reconnect.

## Rollback

Android will not normally accept a lower `versionCode`. Preferred rollback is a new APK built from the last known-good Git commit using the same signing identity and a versionCode higher than every distributed build. Emergency uninstall/reinstall is last resort and deletes local app data/session; authoritative Supabase data is not deleted, but recovery must follow supported application workflows.

## Backend ordering

Deploy backward-compatible Supabase migrations before dependent clients. Keep old clients working during staged rollout. Never bundle destructive automatic migrations. Confirm the remote migration ledger contains every version required by the release manifest before installing the first client.

READY cancellation must remain OFF through database/Edge deployment and client rollout. Activate only after separate authorization and verified coverage of compatible Admin/EXCON/CM clients, including offline/spare devices. APK 173/174 are not compatible with existing CANCELLED records; switching the gate OFF later does not make those records safe for old clients. Follow [the activation runbook](READY_CANCELLATION_ACTIVATION_GATE_2026-10-16.md) and preserve historical audit records.
