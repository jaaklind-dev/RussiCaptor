# Exercise Builder v1: authoring and compilation boundary

This is a new authoring cycle after the immutable `android-v1.2.0-validated` release. The Builder is available only in Administration to an authenticated platform administrator. The app's existing route gate and `is_platform_admin` authority remain authoritative; CM and exercise-scoped EXCON roles do not grant Builder access.

## Existing contracts reused

- `ExercisePackage`, its manifest, `createExercisePackage`, `ExercisePackageValidator`, `ExercisePackageLoader` and the immutable registry own package identity and hash.
- `PackagePatientDataset` and patient materialization own patient identity, location and Runtime fixture binding.
- `GoldenFixture.initialState.baselineVitals` is the supported initial-vitals input; Builder exposes only existing Runtime keys and units. No new physiology expression language is introduced.
- The Narva lab catalog remains the sole analyte catalog. Builder offers only `STATIC_BASELINE` and `DEMOGRAPHIC_CONDITIONAL` reportable values. Dynamic analytes retain their existing physiology generator; `aB-Hb-Fr` remains a non-reportable panel token.
- Package-owned imaging definitions retain the existing study/order schema. The existing image ingest core inspects JPEG/PNG bytes, creates deterministic IDs, SHA-256, dimensions, provenance manifest and Metro static `require` entries.
- Installed packages and compiled package versions remain immutable. Transport and action/intervention editing are read-only/deferred in v1.

## Narrow additive laboratory contract

An optional `laboratoryConfiguration` binds an otherwise custom package to the existing `NARVA_POLYTRAUMA` or `NARVA_IRO_ASTRUP` catalog. It may supply per-patient static initial results and per-result-group simulation-second delays. It is part of the immutable package hash. At collection, the writer freezes authored values and delays into the canonical sample; restart/takeover reads those frozen inputs. Absence of this optional contract preserves all historical Narva package behavior.

Runtime ordering also requires an exact server-side registration of the compiled package ID, version, hash, and chosen catalog. A reviewed deployment migration may register a frozen package, or an authenticated PLATFORM_ADMIN may invoke `register_exercise_package_lab_catalog` after checking the compiled artifact. CM/EXCON cannot register a package; neither a client-supplied catalog name nor an arbitrary package namespace grants laboratory scope. Registration is immutable per package ID/version, and active exercise publication freezes the package hash. This 2026-10-10 architecture amendment corrects the earlier assumption that Builder laboratory support required no Supabase migration.

## Draft → source export → compiled package

The Android Builder stores editable drafts locally, partitioned by platform-admin user ID. Imported JPEG/PNG bytes are copied into app-local draft storage; source URLs are provenance only. A directory chosen through Android's system document picker receives a deterministic JSON source bundle with image bytes embedded. The portable bundle strips device-local file URIs and contains no Drive credentials. It is an **authoring input**, not an installed Runtime package.

On a trusted repository checkout, `npm run builder:publish -- /path/to/<package>-source.json` is the explicit promotion step. It invokes the existing compiler and image ingest core, validates the package in a fresh process against the generated static image registry, and verifies a new-process roundtrip. It records the portable source export and deterministic, timestamp-free publication evidence under `assets/builder/published/<package-id>/<version>/`, updates the publication index, and generates the package/dataset and static imaging registries. The source export is provenance/build input, not app-local draft storage or a Runtime fetch target. Commit the source, evidence, index, compiled manifest, generated registries and package-owned image bytes together. Runtime never contacts Drive or the source file.

`builder:compile` remains a lower-level staging/compiler command for authoring tests; compilation alone is not publication. `builder:verify-published` is the build-time gate and rejects compiled entries lacking publication evidence, missing source/assets, content drift, stale generated registries or an indexed package absent from the runtime manifest. `field-release:android` runs it before Expo prebuild. Repeating `builder:publish` with byte-identical source is a no-op. The same ID/version with different source or package content is rejected; publish a new version instead. Export or validation never invokes publication automatically.

The published BuilderPickerTest153 TEST fixture demonstrates this contract: `russicaptor.builder-picker-test153@1.0.0` has package hash `993ec01c571c158afc9f8715520887dd83dacaac535efd5d3f7cde0f7488129c` and one package-owned PNG with SHA-256 `a4e030697a7571b3e95d31860e4da55d2f98e5e861e2b55e414f45a8556828ba`. It is TEST-only content, not a validated clinical package. A clean checkout contains everything needed to build it; the source export need not be fetched from the Builder device or Google Drive.

The Android UI cannot alter a Metro `require` registry inside an already-installed APK. Accordingly, the UI must never call a source bundle a published package or show a provisional final hash. The final hash is available only after desktop compilation and build verification.

Image `contributor` is optional in both the draft and the compiled provenance. Empty, whitespace-only, null, and absent values compile as an absent field; a non-empty value is trimmed. Image source and license remain required by Builder validation.

## V1 limits and revalidation

Drafts are local to the device and not synchronized between administrators. Large source images enlarge the exported JSON; no cloud authoring service is introduced. Builder v1 does not author dynamic lab formulas, transport routes, new clinical processes, or exercise instances. A newly compiled package requires a new APK and the applicable package, laboratory, imaging, Runtime and physical regression before clinical use. Existing validated APK and Narva package hashes remain unchanged.
