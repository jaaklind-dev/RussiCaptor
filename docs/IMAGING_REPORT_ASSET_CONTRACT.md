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

The generated asset can then be bound once in a new package version with `getRegisteredImagingAsset(assetId)` as the Imaging definition's `study.asset`. Package validation checks package ID/version, patient ID and definition ID. The ingest command refuses a new binding for a package ID/version already present in the published package source. Intentional image replacement requires a new asset version; binding it to a published package also requires a new package version.

Optional provenance flags are `--source-url`, `--attribution`, `--license-id`, `--license-url`, `--contributor`, and `--modification-note`. They are immutable package provenance only and never control clinical state. Externally sourced content still requires separate license approval. No Radiopaedia-specific behavior exists in this pipeline.
