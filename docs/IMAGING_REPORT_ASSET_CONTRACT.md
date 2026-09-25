# Imaging report and asset contract

Package definitions retain the authored report source and may bind one immutable `ImagingAssetReference`. Ordering captures that source into the durable study instance. RESULTED creates an `ImagingReleasedResult` with its own deterministic result ID, durable instance identity, patient/definition/package provenance, authored-report SHA-256, release time and optional asset reference.

`BUNDLED_LOCAL` is implemented through the closed local registry. `MANAGED_REMOTE` is a contract-only future source kind; retrieval is deliberately unsupported. Arbitrary URLs, paths and workbook attachments never become trusted assets.

The legacy `attachment` field is import-only compatibility. A known legacy demo key is adapted once at the package/runtime boundary or schema-1 restore boundary into the canonical asset reference. Unknown keys remain explicitly unresolved. New package-owned definitions must use `asset`; package validation rejects legacy attachment keys and provenance mismatches. Thus only the asset-reference model is authoritative after ordering.

Canonical checkpoints contain report and asset metadata only. They never contain binary image bytes, data URLs, signed URLs or remote credentials. Build/test validation freezes the bundled file SHA-256 and byte length; rendering resolves the already-validated stable identity without repeatedly hashing bytes.
