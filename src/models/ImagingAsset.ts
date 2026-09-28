export type ImagingAssetSourceKind = "BUNDLED_LOCAL" | "MANAGED_REMOTE";

export type ImagingAssetProvenance = Readonly<{
  sourceUrl?: string;
  attribution?: string;
  licenseId?: string;
  licenseUrl?: string;
  contributor?: string;
  modificationNote?: string;
}>;

export type ImagingAssetReference = Readonly<{
  assetId: string;
  sourceKind: ImagingAssetSourceKind;
  resolverKey: string;
  sha256: string;
  mediaType: string;
  byteLength?: number;
  width?: number;
  height?: number;
  role?: "PRIMARY_DIAGNOSTIC_IMAGE" | "SUPPORTING_IMAGE";
  packageId: string;
  /** Present on assets produced by the package ingest pipeline; optional only for legacy checkpoint compatibility. */
  packageVersion?: string;
  /** Present on assets produced by the package ingest pipeline; optional only for legacy checkpoint compatibility. */
  patientId?: string;
  definitionId: string;
  provenance?: ImagingAssetProvenance;
}>;

export type ImagingAssetResolution<T = unknown> =
  | Readonly<{ status: "RESOLVED"; asset: ImagingAssetReference; source: T }>
  | Readonly<{ status: "MISSING_REGISTRY_KEY" | "INTEGRITY_MISMATCH" | "UNSUPPORTED_SOURCE" | "UNRESOLVED_LEGACY_ATTACHMENT"; detail: string }>;
