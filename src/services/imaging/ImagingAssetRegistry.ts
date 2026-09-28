import type { ImageSourcePropType } from "react-native";
import type { ImagingAssetReference, ImagingAssetResolution } from "@/models/ImagingAsset";
import { GENERATED_BUNDLED_IMAGING_ASSETS, GENERATED_BUNDLED_IMAGING_SOURCES } from
  "./ImagingBundledAssetRegistry.generated";

export const DEMO_HEAD_CT_ASSET = GENERATED_BUNDLED_IMAGING_ASSETS.find(item =>
  item.assetId === "demo.head-ct.image01.v1")!;

const metadata = new Map<string, ImagingAssetReference>(
  GENERATED_BUNDLED_IMAGING_ASSETS.map(item => [item.assetId, item] as const),
);
const bundledSources = GENERATED_BUNDLED_IMAGING_SOURCES;

const validSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

export function validateImagingAssetReference(asset: ImagingAssetReference): void {
  if (!asset.assetId || !asset.resolverKey || !validSha256(asset.sha256) || !asset.mediaType ||
    !asset.packageId || !asset.definitionId ||
    (asset.byteLength !== undefined && (!Number.isInteger(asset.byteLength) || asset.byteLength <= 0)) ||
    (asset.width !== undefined && (!Number.isInteger(asset.width) || asset.width <= 0)) ||
    (asset.height !== undefined && (!Number.isInteger(asset.height) || asset.height <= 0))) {
    throw new Error("IMAGING_ASSET_INVALID");
  }
  if (asset.sourceKind === "BUNDLED_LOCAL") {
    const expected = metadata.get(asset.assetId);
    if (!expected) throw new Error("IMAGING_ASSET_REGISTRY_MISSING");
    const legacyDemoReference = asset.assetId === "demo.head-ct.image01.v1" &&
      asset.packageVersion === undefined && asset.patientId === undefined &&
      asset.width === undefined && asset.height === undefined;
    const keys = legacyDemoReference
      ? ["resolverKey", "sha256", "mediaType", "byteLength", "role", "packageId", "definitionId"] as const
      : ["resolverKey", "sha256", "mediaType", "byteLength", "width", "height", "role",
        "packageId", "packageVersion", "patientId", "definitionId"] as const;
    for (const key of keys) {
      if (asset[key] !== expected[key]) throw new Error("IMAGING_ASSET_INTEGRITY_MISMATCH");
    }
    if (JSON.stringify(asset.provenance) !== JSON.stringify(expected.provenance)) {
      throw new Error("IMAGING_ASSET_INTEGRITY_MISMATCH");
    }
  }
}

export function getRegisteredImagingAsset(assetId: string): ImagingAssetReference | undefined {
  return metadata.get(assetId);
}

export function resolveImagingAsset(asset: ImagingAssetReference): ImagingAssetResolution<ImageSourcePropType> {
  if (asset.sourceKind === "MANAGED_REMOTE") return { status: "UNSUPPORTED_SOURCE", detail: asset.assetId };
  const expected = metadata.get(asset.assetId);
  if (!expected) return { status: "MISSING_REGISTRY_KEY", detail: asset.assetId };
  try { validateImagingAssetReference(asset); } catch { return { status: "INTEGRITY_MISMATCH", detail: asset.assetId }; }
  const source = bundledSources[asset.resolverKey];
  return source ? { status: "RESOLVED", asset, source } : { status: "MISSING_REGISTRY_KEY", detail: asset.resolverKey };
}

export function adaptLegacyImagingAttachment(input: Readonly<{ attachment?: string; packageId: string;
  definitionId: string }>): ImagingAssetReference | undefined {
  if (!input.attachment) return undefined;
  if (input.attachment === DEMO_HEAD_CT_ASSET.resolverKey && input.packageId === DEMO_HEAD_CT_ASSET.packageId &&
    input.definitionId === DEMO_HEAD_CT_ASSET.definitionId) return DEMO_HEAD_CT_ASSET;
  return undefined;
}

export function classifyLegacyImagingAttachment(attachment?: string): ImagingAssetResolution<ImageSourcePropType> | undefined {
  if (!attachment) return undefined;
  const asset = attachment === DEMO_HEAD_CT_ASSET.resolverKey ? DEMO_HEAD_CT_ASSET : undefined;
  return asset ? resolveImagingAsset(asset) : { status: "UNRESOLVED_LEGACY_ATTACHMENT", detail: attachment };
}
