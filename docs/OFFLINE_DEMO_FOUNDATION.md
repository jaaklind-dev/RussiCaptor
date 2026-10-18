# Offline demo foundation

This feature adds a separate Android-only Expo application under offline-demo. It does not change root app.json, canonical package/version 1.2.0 (181), canonical entry or field-release policy. Source baseline: 929da398043148e96388dd5efa45d7ef992f0e27.

## Impact and guardrails

Classify this as isolated UI/local persistence/native configuration: K/L/X and the UI/persistence impact rows apply within the demo. A–J/M–W/Y production contracts remain unchanged; the full guardrail union, Runtime Hardening, full suite, TypeScript, ESLint, Builder assets and release configuration regressions must pass. No canonical snapshot, authority, checkpoint or patient command is reused. Physical demo interaction, native manifest, restart and side-by-side preservation remain required before any release; no physical PASS is claimed.

## Initialization map

Production src/app/_layout.tsx loads canonical state, starts persistence and OperatorSessionService, then CloudSync discovery and RuntimeCheckpointSync after authority. SupabaseService creates a client at module import when configured and registers Auth refresh. ProviderFactory/DemoDataProvider names refer to production global arrays, not an isolated demo. CurrentUserService contains DEV-only identity selection, not a safe released-demo authorization mechanism. These modules and their shared mutable presentation wrappers are not imported.

The new entry installs a network boundary before requiring Expo registration or the demo UI. Only demo-owned relative modules plus expo, expo-constants, expo-sqlite/kv-store, React and React Native are allowed. No shared application component was sufficiently independent to justify introducing a production import for this minimal card; React Native presentation primitives are reused. A static transitive application graph verifier and Metro resolver reject production modules, unknown libraries, dynamic import targets and escapes outside the demo source/dependency roots. Runtime fetch/XHR/WebSocket/EventSource calls throw a fixed safe code; no request details are logged.

## Build identity

Package com.jaaklind.RussiCaptor.demo; label RussiCaptor DEMO; demo version 0.1.0 / 1 in its independent namespace. A dedicated amber vector launcher icon with DEMO lettering is applied by the Android config plugin. No production scheme, EAS project, Supabase configuration or OTA updates are included. Backend/service-role/production release environment inputs fail closed. This is not an upgrade-validation artifact and cannot replace canonical RussiCaptor.

The plugin removes Android permissions through manifest-merger removal markers, including INTERNET and ACCESS_NETWORK_STATE, removes incoming URI/deep-link intent filters, keeps only the launcher MainActivity and marks other merged entry components nonexported. Backup and cleartext traffic are disabled. The final merged release manifest and native autolinked module inventory still require verification when an APK build is separately authorized; source/plugin tests are not a binary proof. Do not use Expo Go/Metro as an offline acceptance substitute.

No APK builder or signing fallback is supplied in this milestone. Before the first APK build: select an approved separate demo signing resource, add a reviewed release-only demo build/merged-manifest/artifact verifier, confirm entry resolution/native dependency set, verify absent INTERNET/deep-links/backend config and publicationAuthorization=NOT_GRANTED. Never weaken canonical scripts or set production package ID in the demo config.

The five direct demo dependency versions exactly match the existing repository package-lock.json. Local checks reuse that locked dependency installation; neither the root lockfile nor canonical dependencies changed. Do not independently install an unlocked dependency tree inside offline-demo for a release build; the future demo build policy must preserve this locked resolution or supply its own reviewed lockfile.

## UI and state

Home, synthetic patient card, fixed DEMO banner, back/home, reset and safe Android exit. No clinical commands, runtime engine, Auth, roles, owner, lease, production exercise or real patient identifiers. Displayed vital values are explicitly static demo examples, not live physiology or medical advice. Exit calls Android BackHandler.exitApp without launching any production URI.

SQLiteStorage uses its own russicaptor-offline-demo-v1.db and only key russicaptor.offline-demo.session.v1. Persisted shape contains schemaVersion, generation, screen and visit count; the immutable synthetic patient is code-owned, so a stored record cannot inject patient data. Shape/range violations and read/write failure fail closed with bounded UI text, never a raw exception or a production fallback. Reset writes only this key, persists first and then publishes state. Captured generation prevents pre-reset callbacks from modifying the new session. No asynchronous state queue or simulation timer exists in this stage. The separate Android package sandbox and absent shared-storage permissions prevent ordinary cross-application storage access; native verification is still pending.

## Verification commands

Run node scripts/verify-offline-demo.mjs and the root Jest suite (including offline-demo tests), npm run typecheck, npm run lint, npm run test:guardrails, node scripts/builder-verify-published.mjs, canonical release configuration tests and git diff --check. Use no cloud mutation endpoints. The standalone graph verifier is a source gate, not a claim that a signed APK exists.

## Later stages

First: reviewed demo-only signed build and native isolation/physical acceptance. Then scoped local command adapter and clinical engine, coherent clock, CM/EXCON presentation, lab/imaging and demo-specific Builder storage. Preserve the production writer/readiness contract; never manufacture a production WRITER state or authenticated principal to enable demo actions. Production multi-CM release acceptance remains BLOCKED. Publication is NOT_GRANTED.

## Foundation validation on 2026 10 18

- Full regression: 337 suites / 2920 tests PASS.
- Focused demo/security/canonical-release regression: 8 suites / 94 tests PASS; the five new demo suites contribute 56 tests.
- Runtime guardrail union: 90 suites / 924 tests PASS, including the existing writer, persistence, multi-device and security-related contracts. Runtime Hardening also passed in the full suite.
- TypeScript, ESLint, Builder published-asset verification and staged git diff --check PASS.
- Source graph: five application modules, zero production imports. Existing canonical app/config/dependencies/release policy, runtime, Auth and migrations are byte-unchanged.
- Offline Expo public-config and introspection evaluation passed without prebuild, Gradle or APK creation. Introspected Android manifest has the demo identity/icon, launcher-only activity and INTERNET removal markers. Final merged APK permissions/native initialization and physical interaction remain unverified, not PASS.
- Initial regression runs found missing external Narva workbook fixtures in the new clone environment. The original and corrected fixtures were copied beside this isolated checkout and matched frozen hashes 30ac1194643884c41ee08d5c65513ccc3945f5458d9ea6190ebb5f27ddd8bb3b and a29d8c5db6adc43dd388536f15bbc9a2fb0ee784d9eabcde99e71049dcb10d2d. No fixture, guardrail or threshold was changed; the final rerun passed.

DEMO_APK_BUILD_READINESS remains BLOCKED until the separately authorized signing/build/merged-manifest verification step is prepared. This does not classify the source-only foundation milestone as failed. No build/install, production access, cloud project restoration, permission change, push or merge occurred.
