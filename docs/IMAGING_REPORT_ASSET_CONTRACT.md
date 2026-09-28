# Imaging report and asset contract

Package definitions retain the authored report source and may bind one immutable `ImagingAssetReference`. Ordering captures that source into the durable study instance. RESULTED creates an `ImagingReleasedResult` with its own deterministic result ID, durable instance identity, patient/definition/package provenance, authored-report SHA-256, release time and optional asset reference.

`BUNDLED_LOCAL` is implemented through the closed local registry. `MANAGED_REMOTE` is a contract-only future source kind; retrieval is deliberately unsupported. Arbitrary URLs, paths and workbook attachments never become trusted assets.

The legacy `attachment` field is import-only compatibility. A known legacy demo key is adapted once at the package/runtime boundary or schema-1 restore boundary into the canonical asset reference. Unknown keys remain explicitly unresolved. New package-owned definitions must use `asset`; package validation rejects legacy attachment keys and provenance mismatches. Thus only the asset-reference model is authoritative after ordering.

Canonical checkpoints contain report and asset metadata only. They never contain binary image bytes, data URLs, signed URLs or remote credentials. Build/test validation freezes the bundled file SHA-256 and byte length; rendering resolves the already-validated stable identity without repeatedly hashing bytes.

## Authoring a bundled local asset

Only JPEG and PNG are accepted by the v1 ingest pipeline. The command validates the file signature, extension/media-type agreement, dimensions, byte length, SHA-256, package/study provenance and immutable identity before writing. Unsupported, corrupt, empty, traversing or colliding input fails closed.

Preview an asset without writing:

```sh
npm run imaging:asset-ingest -- \
  --dry-run \
  --source /absolute/path/to/image.jpg \
  --package-id russicaptor.example \
  --package-version 2.0.0 \
  --patient-id PT-EXAMPLE-001 \
  --definition-id EXAMPLE-XR \
  --logical-name primary \
  --asset-version 1 \
  --role PRIMARY_DIAGNOSTIC_IMAGE
```

Remove `--dry-run` to ingest. The tool copies the bytes under `assets/imaging/packages/`, updates `assets/imaging/manifest.json`, and regenerates `ImagingBundledAssetRegistry.generated.ts`. The generated registry contains literal `require(...)` calls because Expo/Metro must discover native bundled assets at build time. Verify all registered bytes and generated output with:

```sh
npm run imaging:asset-verify
```

The low-level ingest command remains available for registry maintenance. Package authors should normally use the transactional authoring command below; it removes the former manual package-binding and hash-editing step.

Optional provenance flags are `--source-url`, `--attribution`, `--license-id`, `--license-url`, `--contributor`, and `--modification-note`. They are immutable package provenance only and never control clinical state. Externally sourced content still requires separate license approval. No Radiopaedia-specific behavior exists in this pipeline.

## Authoring a package version without source edits

Always preview the exact operation first:

```sh
npm run imaging:author -- \
  --dry-run \
  --source /absolute/path/to/image.jpg \
  --package-id russicaptor.example \
  --base-version 2.0.0 \
  --new-version 2.0.1 \
  --patient-id PT-EXAMPLE-001 \
  --definition-id EXAMPLE-XR \
  --logical-name primary
```

The required arguments are `--source`, `--package-id`, `--base-version`, `--new-version`, `--patient-id`, `--definition-id`, and `--logical-name`. The provenance flags listed above remain optional. `--asset-version` may be supplied for a replacement, and `--role` may be `PRIMARY_DIAGNOSTIC_IMAGE` or `SUPPORTING_IMAGE`.

Dry-run resolves the real package registry and patient dataset, validates exact (not fuzzy) IDs, inspects the image, and reports the operation, old asset if present, proposed immutable asset identity, package hash, and every file that would change. It writes nothing. Remove `--dry-run` only after reviewing that plan. Add `--json` for one bounded machine-readable result containing metadata only—never image bytes.

A successful write is one logical transaction: the tool ingests the bytes, regenerates the static Metro registry, writes a package-version recipe that clones the named immutable base version, binds only the selected study asset, calculates the canonical package hash, and validates the result through the normal package loader in a fresh process. A failure at any later step restores all manifests and registries and removes the newly copied asset. Existing package versions are never edited.

If the base study already has an asset, the plan says `REPLACE`. Replacement still requires an unused package version and a new `assetId` (normally by incrementing `--asset-version`); old bytes and provenance remain registered and historical package hashes remain unchanged. Study title, report, delay, modality, workflow, and patient binding are cloned without changes.

Inspect an already registered asset without changing files:

```sh
npm run imaging:preview -- --asset-id demo.head-ct.image01.v1
```

This lightweight preview verifies the full asset manifest, resolves the normal `BUNDLED_LOCAL` registry entry, and reports dimensions, orientation-relevant width/height, media type, package target, and resolver key. It does not edit or render the image.
