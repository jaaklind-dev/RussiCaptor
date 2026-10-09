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

An optional `laboratoryConfiguration` binds an otherwise custom package to the existing `NARVA_POLYTRAUMA` or `NARVA_IRO_ASTRUP` catalog. It may supply per-patient static initial results and per-result-group simulation-second delays. It is part of the immutable package hash. At collection, the writer freezes authored values and delays into the canonical sample; restart/takeover reads those frozen inputs. Absence of this optional contract preserves all historical Narva package behavior. No Supabase schema, RLS, RPC or migration changes are needed.

## Draft → source export → compiled package

The Android Builder stores editable drafts locally, partitioned by platform-admin user ID. Imported JPEG/PNG bytes are copied into app-local draft storage; source URLs are provenance only. A directory chosen through Android's system document picker receives a deterministic JSON source bundle with image bytes embedded. The portable bundle strips device-local file URIs and contains no Drive credentials. It is an **authoring input**, not an installed Runtime package.

On a trusted repository checkout, `npm run builder:compile -- /path/to/<package>-source.json` calls the existing image ingest core, validates the package in a fresh process against the generated static image registry, generates a package/dataset registry entry, verifies a new-process roundtrip, and reports the final package and dataset hashes. It rejects a pre-existing package ID/version. If validation fails, generated manifests/registries and newly created assets are rolled back. The resulting package is bundled into the next APK; Runtime never contacts Drive or the source file.

The Android UI cannot alter a Metro `require` registry inside an already-installed APK. Accordingly, the UI must never call a source bundle a published package or show a provisional final hash. The final hash is available only after desktop compilation and build verification.

Image `contributor` is optional in both the draft and the compiled provenance. Empty, whitespace-only, null, and absent values compile as an absent field; a non-empty value is trimmed. Image source and license remain required by Builder validation.

## V1 limits and revalidation

Drafts are local to the device and not synchronized between administrators. Large source images enlarge the exported JSON; no cloud authoring service is introduced. Builder v1 does not author dynamic lab formulas, transport routes, new clinical processes, or exercise instances. A newly compiled package requires a new APK and the applicable package, laboratory, imaging, Runtime and physical regression before clinical use. Existing validated APK and Narva package hashes remain unchanged.
