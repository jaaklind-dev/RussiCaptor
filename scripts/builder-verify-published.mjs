import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { COMPILED_REGISTRY, PUBLISHED_INDEX, identityPath, listPublications, readCompiled, renderBuilderRegistry, sha256 } from "./lib/builder-publication.mjs";

const require = createRequire(import.meta.url);
const ingest = require("./lib/imaging-asset-ingest-core.cjs");
const root = path.resolve(import.meta.dirname, "..");
const required = process.argv.length === 4 && process.argv[2] === "--require" ? process.argv[3] : undefined;
if (process.argv.length !== 2 && !required) throw new Error("Usage: npm run builder:verify-published -- [--require package-id@version]");
const manifest = readCompiled(root);
const indexPath = path.join(root, PUBLISHED_INDEX);
if (!fs.existsSync(indexPath)) throw new Error("BUILDER_PUBLISHED_INDEX_MISSING");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
if (index.schemaVersion !== 1 || !Array.isArray(index.packages)) throw new Error("BUILDER_PUBLISHED_INDEX_INVALID");
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) throw new Error("BUILDER_PUBLISHED_MANIFEST_INVALID");
const directories = listPublications(root);
if (directories.length !== manifest.packages.length || directories.length !== index.packages.length) throw new Error("BUILDER_PUBLISHED_SET_MISMATCH");
const assets = ingest.readManifest(root).assets;
const seen = new Set();
for (const directory of directories) {
  const publication = JSON.parse(fs.readFileSync(path.join(directory, "publication.json"), "utf8"));
  const { packageId, packageVersion } = publication;
  if (directory !== identityPath(root, packageId, packageVersion) || publication.schemaVersion !== 1 ||
    publication.publicationTool !== "builder-publish-v1" || publication.validation !== "PASS") {
    throw new Error("BUILDER_PUBLICATION_METADATA_INVALID");
  }
  const identity = `${packageId}@${packageVersion}`;
  const indexed = index.packages.find(item => item.packageId === packageId && item.packageVersion === packageVersion);
  if (!indexed || indexed.packageHash !== publication.packageHash || indexed.sourceSha256 !== publication.sourceSha256) {
    throw new Error(`BUILDER_PUBLISHED_INDEX_DRIFT:${identity}`);
  }
  if (seen.has(identity)) throw new Error("BUILDER_PUBLISHED_DUPLICATE_IDENTITY");
  seen.add(identity);
  const sourcePath = path.join(directory, "source.json");
  const sourceBytes = fs.readFileSync(sourcePath);
  if (sha256(sourceBytes) !== publication.sourceSha256) throw new Error(`BUILDER_PUBLISHED_SOURCE_DRIFT:${identity}`);
  const bundle = JSON.parse(sourceBytes.toString("utf8"));
  if (bundle.draft?.packageId !== packageId || bundle.draft?.packageVersion !== packageVersion) {
    throw new Error(`BUILDER_PUBLISHED_SOURCE_IDENTITY_DRIFT:${identity}`);
  }
  const entry = manifest.packages.find(item => item.exercisePackage.packageId === packageId &&
    item.exercisePackage.packageVersion === packageVersion);
  if (!entry || entry.exercisePackage.packageHash !== publication.packageHash || entry.datasetHash !== publication.datasetHash) {
    throw new Error(`BUILDER_PUBLISHED_PACKAGE_DRIFT:${identity}`);
  }
  const expectedAssets = assets.filter(item => item.packageId === packageId && item.packageVersion === packageVersion)
    .map(item => ({ assetId: item.assetId, resolverKey: item.resolverKey, sha256: item.sha256 }))
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
  if (JSON.stringify(expectedAssets) !== JSON.stringify(publication.assets) || expectedAssets.length !== bundle.images.length) {
    throw new Error(`BUILDER_PUBLISHED_ASSET_DRIFT:${identity}`);
  }
  for (const image of bundle.images) {
    const study = bundle.draft.studies.find(item => item.id === image.studyId);
    if (!study?.image || study.image.fileName !== image.fileName) throw new Error(`BUILDER_PUBLISHED_IMAGE_IDENTITY_DRIFT:${identity}`);
    const bytes = Buffer.from(image.base64, "base64");
    if (!bytes.length || bytes.toString("base64") !== image.base64) throw new Error(`BUILDER_PUBLISHED_IMAGE_BYTES_INVALID:${identity}`);
    const inspected = ingest.inspectImageBytes(bytes, image.fileName);
    const expected = ingest.buildIdentity({ packageId, packageVersion, patientId: study.patientId, definitionId: study.id,
      logicalName: study.id, role: "PRIMARY_DIAGNOSTIC_IMAGE", sourceUrl: study.image.source,
      contributor: study.image.contributor, licenseId: study.image.licenseId, attribution: study.image.attribution }, inspected);
    const actual = assets.find(item => item.assetId === expected.assetId);
    if (!actual || JSON.stringify(actual) !== JSON.stringify(expected) ||
      sha256(fs.readFileSync(path.join(root, "assets/imaging", expected.resolverKey))) !== expected.sha256) {
      throw new Error(`BUILDER_PUBLISHED_IMAGE_DRIFT:${identity}`);
    }
  }
  const validated = spawnSync(process.execPath, [path.join(root, "scripts/builder-validate.mjs"), sourcePath],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (validated.status !== 0 || JSON.stringify(JSON.parse(validated.stdout)) !== JSON.stringify(entry)) {
    throw new Error(`BUILDER_PUBLISHED_VALIDATION_DRIFT:${identity}`);
  }
}
if (required && !seen.has(required)) throw new Error(`BUILDER_REQUIRED_PUBLICATION_MISSING:${required}`);
if (manifest.packages.length && fs.readFileSync(path.join(root, COMPILED_REGISTRY), "utf8") !== renderBuilderRegistry(manifest.packages)) {
  throw new Error("BUILDER_PUBLISHED_REGISTRY_DRIFT");
}
ingest.verifyManifest(root);
process.stdout.write(`BUILDER_PUBLISHED_VERIFIED packages=${directories.length} assets=${assets.length}\n`);
