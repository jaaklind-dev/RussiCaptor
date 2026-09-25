export type ImagingAssetSourceKind = "BUNDLED_LOCAL" | "MANAGED_REMOTE";

export type ImagingAssetReference = Readonly<{
  assetId: string;
  sourceKind: ImagingAssetSourceKind;
  resolverKey: string;
  sha256: string;
  mediaType: string;
  byteLength?: number;
  role?: "PRIMARY_DIAGNOSTIC_IMAGE" | "SUPPORTING_IMAGE";
  packageId: string;
  definitionId: string;
}>;

export type ImagingAssetResolution<T = unknown> =
  | Readonly<{ status: "RESOLVED"; asset: ImagingAssetReference; source: T }>
  | Readonly<{ status: "MISSING_REGISTRY_KEY" | "INTEGRITY_MISMATCH" | "UNSUPPORTED_SOURCE" | "UNRESOLVED_LEGACY_ATTACHMENT"; detail: string }>;
