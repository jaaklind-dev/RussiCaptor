import type { ImageSourcePropType } from "react-native";
import type { ImagingAssetReference, ImagingAssetResolution } from "@/models/ImagingAsset";
import { deepFreeze } from "@/utils/immutable";

export const DEMO_HEAD_CT_ASSET = deepFreeze({
  assetId: "demo.head-ct.image01.v1",
  sourceKind: "BUNDLED_LOCAL" as const,
  resolverKey: "image01.jpg",
  sha256: "ae38226a9d0d803fcdfcc4b3bbcc3003a9e3b5ac7ffacc5378d6d18a7ef072b4",
  mediaType: "image/jpeg",
  byteLength: 71145,
  role: "PRIMARY_DIAGNOSTIC_IMAGE" as const,
  packageId: "russicaptor.demo",
  definitionId: "IMG-001",
});

const metadata = new Map([[DEMO_HEAD_CT_ASSET.assetId, DEMO_HEAD_CT_ASSET] as const]);
const bundledSources: Readonly<Record<string, ImageSourcePropType>> = Object.freeze({
  "image01.jpg": require("../../../assets/imaging/image01.jpg"),
});

const validSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

export function validateImagingAssetReference(asset: ImagingAssetReference): void {
  if (!asset.assetId || !asset.resolverKey || !validSha256(asset.sha256) || !asset.mediaType ||
    !asset.packageId || !asset.definitionId || (asset.byteLength !== undefined &&
      (!Number.isInteger(asset.byteLength) || asset.byteLength < 0))) throw new Error("IMAGING_ASSET_INVALID");
  if (asset.sourceKind === "BUNDLED_LOCAL") {
    const expected = metadata.get(asset.assetId);
    if (!expected) throw new Error("IMAGING_ASSET_REGISTRY_MISSING");
    for (const key of ["resolverKey", "sha256", "mediaType", "byteLength", "packageId", "definitionId"] as const) {
      if (asset[key] !== expected[key]) throw new Error("IMAGING_ASSET_INTEGRITY_MISMATCH");
    }
  }
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
