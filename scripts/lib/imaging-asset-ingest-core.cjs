const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_RELATIVE_PATH = "assets/imaging/manifest.json";
const REGISTRY_RELATIVE_PATH = "src/services/imaging/ImagingBundledAssetRegistry.generated.ts";
const MAX_DIMENSION = 32_768;
const MAX_PIXELS = 268_435_456;
const ROLES = new Set(["PRIMARY_DIAGNOSTIC_IMAGE", "SUPPORTING_IMAGE"]);

function fail(code) { throw new Error(code); }
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function cleanIdentity(value, field) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("..") ||
    /[\\/\0]/.test(value)) fail(`INVALID_${field}`);
  return value;
}
function slug(value, field) {
  cleanIdentity(value, field);
  const normalized = value.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "")
    .replace(/\.{2,}/g, ".");
  if (!normalized || normalized.includes("..")) fail(`INVALID_${field}`);
  return normalized;
}
function saneDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
    width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) fail("IMAGE_DIMENSIONS_UNSAFE");
  return { width, height };
}
function inspectPng(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== signature ||
    bytes.toString("ascii", 12, 16) !== "IHDR" || !bytes.includes(Buffer.from("IEND"))) fail("CORRUPT_PNG");
  return { mediaType: "image/png", extension: "png", ...saneDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) };
}
function inspectJpeg(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) fail("CORRUPT_JPEG");
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length - 2) {
    if (bytes[offset] !== 0xff) fail("CORRUPT_JPEG");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) fail("CORRUPT_JPEG");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail("CORRUPT_JPEG");
    if (sof.has(marker)) {
      if (length < 7) fail("CORRUPT_JPEG");
      return { mediaType: "image/jpeg", extension: "jpg",
        ...saneDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)) };
    }
    offset += length;
  }
  fail("JPEG_DIMENSIONS_MISSING");
}
function inspectImageBytes(bytes, sourcePath) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail("IMAGE_EMPTY");
  const detected = bytes[0] === 0x89 ? inspectPng(bytes) : bytes[0] === 0xff ? inspectJpeg(bytes) : fail("UNSUPPORTED_IMAGE_TYPE");
  const extension = path.extname(sourcePath).toLowerCase();
  const declared = extension === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : undefined;
  if (!declared) fail("UNSUPPORTED_IMAGE_TYPE");
  if (declared !== detected.mediaType) fail("IMAGE_MEDIA_TYPE_MISMATCH");
  return { ...detected, byteLength: bytes.length, sha256: sha256(bytes) };
}
function optionalText(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("\0")) fail(`INVALID_${field}`);
  return value;
}
function optionalContributor(value) {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.includes("\0")) fail("INVALID_CONTRIBUTOR");
  return value.trim() || undefined;
}
function buildProvenance(input) {
  const provenance = {
    sourceUrl: optionalText(input.sourceUrl, "SOURCE_URL"), attribution: optionalText(input.attribution, "ATTRIBUTION"),
    licenseId: optionalText(input.licenseId, "LICENSE_ID"), licenseUrl: optionalText(input.licenseUrl, "LICENSE_URL"),
    contributor: optionalContributor(input.contributor), modificationNote: optionalText(input.modificationNote, "MODIFICATION_NOTE"),
  };
  const defined = Object.fromEntries(Object.entries(provenance).filter(([, value]) => value !== undefined));
  return Object.keys(defined).length ? defined : undefined;
}
function buildIdentity(input, inspected) {
  const packageId = cleanIdentity(input.packageId, "PACKAGE_ID");
  const packageVersion = cleanIdentity(input.packageVersion, "PACKAGE_VERSION");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) fail("INVALID_PACKAGE_VERSION");
  const patientId = cleanIdentity(input.patientId, "PATIENT_ID");
  const definitionId = cleanIdentity(input.definitionId, "DEFINITION_ID");
  const logicalName = cleanIdentity(input.logicalName, "LOGICAL_NAME");
  const assetVersion = Number(input.assetVersion ?? 1);
  if (!Number.isInteger(assetVersion) || assetVersion < 1) fail("INVALID_ASSET_VERSION");
  if (input.role !== undefined && !ROLES.has(input.role)) fail("INVALID_ASSET_ROLE");
  const packageScope = slug(packageId, "PACKAGE_ID");
  const definitionScope = slug(definitionId, "DEFINITION_ID");
  const logicalScope = slug(logicalName, "LOGICAL_NAME");
  const assetId = `${packageScope}.${definitionScope}.${logicalScope}.v${assetVersion}`;
  const resolverKey = `packages/${packageScope}/${packageVersion}/${definitionScope}/${logicalScope}.v${assetVersion}.${inspected.extension}`;
  const provenance = buildProvenance(input);
  return { assetId, sourceKind: "BUNDLED_LOCAL", resolverKey, sha256: inspected.sha256,
    mediaType: inspected.mediaType, byteLength: inspected.byteLength, width: inspected.width, height: inspected.height,
    ...(input.role ? { role: input.role } : {}), packageId, packageVersion, patientId, definitionId,
    ...(provenance ? { provenance } : {}) };
}
function readManifest(rootDir) {
  const manifestPath = path.join(rootDir, MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) return { schemaVersion: 1, assets: [] };
  const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (value.schemaVersion !== 1 || !Array.isArray(value.assets)) fail("INVALID_IMAGING_ASSET_MANIFEST");
  return value;
}
function stableManifest(manifest) {
  return { schemaVersion: 1, assets: [...manifest.assets].sort((a, b) => a.assetId.localeCompare(b.assetId)) };
}
function literal(value) { return JSON.stringify(value); }
function generateRegistrySource(manifest) {
  const assets = stableManifest(manifest).assets;
  const lines = ["/* Generated by scripts/imaging-asset-ingest.mjs. Do not edit by hand. */",
    'import type { ImageSourcePropType } from "react-native";',
    'import type { ImagingAssetReference } from "@/models/ImagingAsset";',
    'import { deepFreeze } from "@/utils/immutable";', "", "export const GENERATED_BUNDLED_IMAGING_ASSETS = deepFreeze(["];
  for (const asset of assets) {
    lines.push("  {", `    assetId: ${literal(asset.assetId)},`, '    sourceKind: "BUNDLED_LOCAL" as const,',
      `    resolverKey: ${literal(asset.resolverKey)},`, `    sha256: ${literal(asset.sha256)},`,
      `    mediaType: ${literal(asset.mediaType)},`, `    byteLength: ${asset.byteLength},`, `    width: ${asset.width},`,
      `    height: ${asset.height},`, ...(asset.role ? [`    role: ${literal(asset.role)} as const,`] : []),
      `    packageId: ${literal(asset.packageId)},`, `    packageVersion: ${literal(asset.packageVersion)},`,
      `    patientId: ${literal(asset.patientId)},`, `    definitionId: ${literal(asset.definitionId)},`,
      ...(asset.provenance ? [`    provenance: ${literal(asset.provenance)},`] : []), "  },");
  }
  lines.push("] satisfies readonly ImagingAssetReference[]);", "",
    "export const GENERATED_BUNDLED_IMAGING_SOURCES: Readonly<Record<string, ImageSourcePropType>> = Object.freeze({");
  for (const asset of assets) lines.push(`  ${literal(asset.resolverKey)}: require(${literal(`../../../assets/imaging/${asset.resolverKey}`)}),`);
  lines.push("});", "");
  return lines.join("\n");
}
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? (entry.name === "__tests__" ? [] : walk(target)) : entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}
function isPublishedPackageIdentity(rootDir, packageId, packageVersion) {
  const idLiteral = JSON.stringify(packageId); const versionLiteral = JSON.stringify(packageVersion);
  return walk(path.join(rootDir, "src/services/exercise")).some(file => {
    const source = fs.readFileSync(file, "utf8"); return source.includes(idLiteral) && source.includes(versionLiteral);
  });
}
function assertDestination(rootDir, resolverKey) {
  const imagingRoot = path.resolve(rootDir, "assets/imaging");
  const destination = path.resolve(imagingRoot, resolverKey);
  if (!destination.startsWith(`${imagingRoot}${path.sep}`)) fail("ASSET_PATH_TRAVERSAL");
  return destination;
}
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function inspectSource(sourcePath) {
  let stat;
  try { stat = fs.statSync(sourcePath); } catch { fail("IMAGE_SOURCE_MISSING"); }
  if (!stat.isFile()) fail("IMAGE_SOURCE_NOT_FILE");
  let bytes;
  try { bytes = fs.readFileSync(sourcePath); } catch { fail("IMAGE_SOURCE_UNREADABLE"); }
  return { bytes, inspected: inspectImageBytes(bytes, sourcePath) };
}
function planIngest(rootDir, input) {
  const sourcePath = path.resolve(input.sourcePath);
  const { bytes, inspected } = inspectSource(sourcePath);
  const asset = buildIdentity(input, inspected);
  const manifest = readManifest(rootDir);
  const byId = manifest.assets.find(item => item.assetId === asset.assetId);
  const byResolver = manifest.assets.find(item => item.resolverKey === asset.resolverKey);
  const destinationPath = assertDestination(rootDir, asset.resolverKey);
  if (byId || byResolver) {
    if (!byId || !byResolver || byId !== byResolver || !sameJson(byId, asset)) fail("IMMUTABLE_ASSET_COLLISION");
    if (!fs.existsSync(destinationPath) || sha256(fs.readFileSync(destinationPath)) !== asset.sha256) fail("IMMUTABLE_ASSET_BYTES_MISMATCH");
    return { status: "IDEMPOTENT", asset, destinationPath, manifest: stableManifest(manifest), bytes };
  }
  if (isPublishedPackageIdentity(rootDir, asset.packageId, asset.packageVersion)) fail("PUBLISHED_PACKAGE_VERSION_IMMUTABLE");
  return { status: "PLANNED", asset, destinationPath,
    manifest: stableManifest({ schemaVersion: 1, assets: [...manifest.assets, asset] }), bytes };
}
function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content); fs.renameSync(temporary, filePath);
}
function ingest(rootDir, input, options = {}) {
  const plan = planIngest(rootDir, input);
  if (options.dryRun || plan.status === "IDEMPOTENT") return { ...plan, wrote: false };
  fs.mkdirSync(path.dirname(plan.destinationPath), { recursive: true });
  fs.writeFileSync(plan.destinationPath, plan.bytes, { flag: "wx" });
  writeAtomic(path.join(rootDir, MANIFEST_RELATIVE_PATH), `${JSON.stringify(plan.manifest, null, 2)}\n`);
  writeAtomic(path.join(rootDir, REGISTRY_RELATIVE_PATH), generateRegistrySource(plan.manifest));
  return { ...plan, status: "INGESTED", wrote: true };
}
function verifyManifest(rootDir) {
  const manifest = stableManifest(readManifest(rootDir));
  const assetIds = new Set(); const resolverKeys = new Set();
  for (const asset of manifest.assets) {
    if (assetIds.has(asset.assetId)) fail("DUPLICATE_ASSET_ID"); assetIds.add(asset.assetId);
    if (resolverKeys.has(asset.resolverKey)) fail("DUPLICATE_RESOLVER_KEY"); resolverKeys.add(asset.resolverKey);
    const destination = assertDestination(rootDir, asset.resolverKey);
    const { inspected } = inspectSource(destination);
    const comparable = { sha256: inspected.sha256, mediaType: inspected.mediaType, byteLength: inspected.byteLength,
      width: inspected.width, height: inspected.height };
    for (const [key, value] of Object.entries(comparable)) if (asset[key] !== value) fail(`ASSET_INTEGRITY_MISMATCH:${asset.assetId}:${key}`);
  }
  const expectedRegistry = generateRegistrySource(manifest);
  const actualRegistry = fs.readFileSync(path.join(rootDir, REGISTRY_RELATIVE_PATH), "utf8");
  if (actualRegistry !== expectedRegistry) fail("GENERATED_REGISTRY_STALE");
  return { assetCount: manifest.assets.length };
}

module.exports = { MANIFEST_RELATIVE_PATH, REGISTRY_RELATIVE_PATH, buildIdentity, generateRegistrySource,
  ingest, inspectImageBytes, isPublishedPackageIdentity, planIngest, readManifest, sha256, verifyManifest };
