# WP-NEXT-04 — Controlled field release and deployment

## Audit and classification

The previous native Gradle `release` path produced an APK with the debug keystore, included `expo-dev-client`, fixed versionCode 1, and carried no source provenance. EAS profiles existed but remote version ownership and credential state were undocumented. Supabase public configuration came from `.env`; missing values disabled the client, while no release-environment/provenance gate existed. Login itself already used production password authentication and production builds excluded the development identity switch.

| Component | Previous classification | WP-NEXT-04 result |
|---|---|---|
| Password auth and role gate | PRODUCTION_READY | Retained |
| Supabase publishable client boundary | PRODUCTION_READY | Explicit production validation added |
| Local Gradle release APK | NEEDS_HARDENING | Canonical scripted path |
| Android signing | NEEDS_HARDENING | External stable keystore required; debug signing rejected |
| `expo-dev-client` | DEV_ONLY | Removed from production dependency/configuration |
| Version/provenance | MISSING | Manifest + in-app safe diagnostics |
| Install/upgrade/rollback | MISSING | Documented |
| Release CI | MISSING | Manual, protected validation/build workflow |

`DemoDataProvider` and `DemoClinicalDataProvider` are legacy names for the local canonical state repositories used by Runtime. They are not an authentication fallback. Production login has no anonymous or demo route; `CurrentUserService` demo identities remain guarded by `__DEV__`.

## Canonical target

The supported first field format is an APK: `RussiCaptor-<version>-<versionCode>.apk`. It is self-contained and works without Expo Go, Metro, a workstation, USB, or a local server. AAB/store publication is outside this WP. WP-NEXT-07 provisions and pins the sole production signer; validation/debug signing is no longer an available release path.

`npm run field-release:android` is the sole local build command. It performs a clean Expo 57 Android prebuild, applies the tracked external-signing configuration to the generated native project, and assembles the embedded release APK. `release/field-release.json` is its versioned release definition; the generated companion manifest adds Git SHA, UTC build time, dirty-tree state, artifact SHA-256/size, signing certificate SHA-256, permissions/SDK metadata and distributability. The script refuses a dirty tracked tree, missing migration proof, missing signing credentials, debug keystores and a signer-fingerprint mismatch.

## Environment and startup boundary

Release builds require `EXPO_PUBLIC_RELEASE_ENVIRONMENT=production`, a valid hosted Supabase URL, a publishable or legacy anon key, a 40-character Git SHA, build timestamp, and positive Android versionCode. Local URLs, missing provenance, secret-key formats, and malformed configuration fail closed. The login surface explains invalid configuration and disables authentication. It exposes only version, versionCode, abbreviated Git SHA, environment, and non-secret project reference. Tokens, keys, user IDs, and credentials are never displayed or logged.

Traffic instrumentation remains disabled by default outside `__DEV__` unless its explicit aggregate-only flag is enabled. Developer cards remain `__DEV__`-only. Expo updates are disabled in native configuration, so the embedded release does not depend on an OTA or Metro endpoint.

## Signing and versioning

The application ID is `com.jaaklind.RussiCaptor`. Production signing uses a stable external keystore referenced only through `RUSSICAPTOR_RELEASE_*` environment variables or protected GitHub environment secrets. Private material is ignored and must not enter Git. Every distributed build increments versionCode monotonically; semantic `applicationVersion` is user-facing. Changing or losing the signing key breaks upgrade compatibility and requires a new application identity or uninstall/reinstall.

The repository debug keystore is never accepted by the field build. The stable production certificate fingerprint and secure local/CI custody model are defined in `WP_NEXT_07_PRODUCTION_SIGNING_DISTRIBUTABLE_RELEASE.md`.

## Release gate

- reviewed clean tree on exact `main` SHA; no unrelated artifacts;
- focused release/auth/config tests, full suite, Runtime Hardening, TypeScript, ESLint, and `git diff --check` pass;
- remote migration ledger satisfies `release/field-release.json` before client rollout;
- WP-NEXT-02 backend auth and WP-NEXT-03 backend workflow deployed;
- physical WP-NEXT-02 login/session and WP-NEXT-03 two-device concurrency remain separately deferred and must gate broad field rollout;
- production Supabase URL/publishable key confirmed; no service-role/secret key;
- version/versionCode and release notes reviewed;
- stable signing certificate fingerprint matches the previous field release;
- generated manifest says `distributable: true` and artifact metadata/hash/signature match;
- fresh install, login, restart, reconnect, and logout smoke pass;
- in-place upgrade preserves intended state/session;
- known-good rollback source and higher rollback versionCode are prepared.

## Migration rollout lessons

WP-EGRESS migrations are backward compatible and must precede clients that consume metadata/delta/byte-budget RPCs. WP-NEXT-02/03 authorization and shared-workflow RPCs must also precede dependent clients. Rollout order is database migration, backend acceptance, small client cohort, then wider client rollout. A rollback client must remain compatible with the already-forward database schema. No application build runs database migrations automatically.

## CI and artifact package

The manually dispatched `android-field-release.yml` workflow runs the release gate, decodes its protected keystore only into the ephemeral runner, builds the APK, emits the manifest, and retains both for 30 days. It performs no store upload and no production deployment. The field package is the APK, generated manifest, `FIELD_RELEASE_ANDROID.md`, release notes, and completed validation checklist; binaries remain outside Git.

## Physical status and remaining gates

The self-contained validation APK was installed in place on Samsung SM-X306B (`R5GL236L6ZJ`). It launched and cold-restarted without Expo Go, Metro, or a workstation service; Android reported package `com.jaaklind.RussiCaptor`, version `1.0.0` / versionCode 1, and the UI showed the expected production environment, abbreviated Git SHA, and Supabase project reference. No startup crash or Metro/dev-launcher dependency appeared. The artifact is intentionally marked non-distributable because the source tree was uncommitted and the validation debug certificate was used.

Final distributable field-release smoke requires provisioned stable signing credentials and a clean committed tree. Physical login/CM/EXCON acceptance and two-device multi-CM acceptance remain the explicitly deferred WP-NEXT-02/03 gates.
