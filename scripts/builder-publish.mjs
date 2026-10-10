import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { COMPILED_MANIFEST, COMPILED_REGISTRY, PUBLISHED_INDEX, identityPath, readCompiled, sha256 } from "./lib/builder-publication.mjs";

const require = createRequire(import.meta.url);
const ingest = require("./lib/imaging-asset-ingest-core.cjs");
const root = path.resolve(import.meta.dirname, "..");
const sourcePath = process.argv[2] && path.resolve(process.argv[2]);
if (!sourcePath || process.argv.length !== 3) throw new Error("Usage: npm run builder:publish -- <validated-source.json>");
const sourceBytes = fs.readFileSync(sourcePath);
const bundle = JSON.parse(sourceBytes.toString("utf8"));
if (bundle.schemaVersion !== 1 || bundle.draft?.schemaVersion !== 1 || !Array.isArray(bundle.images)) throw new Error("BUILDER_BUNDLE_VERSION");
const packageId = bundle.draft.packageId;
const version = bundle.draft.packageVersion;
const destination = identityPath(root, packageId, version);
const identity = `${packageId}@${version}`;
const existingPublication = path.join(destination, "publication.json");
const existingSource = path.join(destination, "source.json");
const indexPath = path.join(root, PUBLISHED_INDEX);
const indexSnapshot = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : undefined;
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : { schemaVersion: 1, packages: [] };
if (index.schemaVersion !== 1 || !Array.isArray(index.packages)) throw new Error("BUILDER_PUBLISH_INDEX_INVALID");
if (fs.existsSync(destination)) {
  if (!fs.existsSync(existingPublication) || !fs.existsSync(existingSource) ||
    sha256(fs.readFileSync(existingSource)) !== sha256(sourceBytes)) throw new Error("BUILDER_PUBLISH_IMMUTABLE_VERSION_CONFLICT");
  const check = spawnSync(process.execPath, [path.join(root, "scripts/builder-verify-published.mjs"), "--require", identity],
    { cwd: root, encoding: "utf8" });
  if (check.status !== 0) throw new Error(`BUILDER_PUBLISH_EXISTING_INVALID:${check.stderr.trim().slice(0, 300)}`);
  process.stdout.write(`${identity} IDEMPOTENT\n`);
  process.exit(0);
}
if (readCompiled(root).packages.some(item => item.exercisePackage.packageId === packageId &&
  item.exercisePackage.packageVersion === version)) throw new Error("BUILDER_PUBLISH_IMMUTABLE_VERSION_CONFLICT");
const files = [COMPILED_MANIFEST, COMPILED_REGISTRY, ingest.MANIFEST_RELATIVE_PATH, ingest.REGISTRY_RELATIVE_PATH];
const snapshots = new Map(files.map(file => [file, fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : undefined]));
const previousAssets = new Set(ingest.readManifest(root).assets.map(item => item.resolverKey));
try {
  const compiled = spawnSync(process.execPath, [path.join(root, "scripts/builder-compile.mjs"), sourcePath],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (compiled.status !== 0) throw new Error(`BUILDER_PUBLISH_COMPILE_FAILED:${compiled.stderr.trim().slice(0, 300)}`);
  const entry = readCompiled(root).packages.find(item => item.exercisePackage.packageId === packageId &&
    item.exercisePackage.packageVersion === version);
  if (!entry) throw new Error("BUILDER_PUBLISH_PACKAGE_MISSING");
  const assets = ingest.readManifest(root).assets.filter(item => item.packageId === packageId && item.packageVersion === version)
    .map(item => ({ assetId: item.assetId, resolverKey: item.resolverKey, sha256: item.sha256 }))
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
  const publication = { schemaVersion: 1, publicationTool: "builder-publish-v1", validation: "PASS", packageId,
    packageVersion: version, packageHash: entry.exercisePackage.packageHash, datasetHash: entry.datasetHash,
    sourceSha256: sha256(sourceBytes), assets };
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(existingSource, sourceBytes, { flag: "wx" });
  fs.writeFileSync(existingPublication, `${JSON.stringify(publication, null, 2)}\n`, { flag: "wx" });
  const nextIndex = { schemaVersion: 1, packages: [...index.packages,
    { packageId, packageVersion: version, packageHash: publication.packageHash, sourceSha256: publication.sourceSha256 }]
    .sort((a, b) => a.packageId.localeCompare(b.packageId) || a.packageVersion.localeCompare(b.packageVersion)) };
  fs.writeFileSync(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
  const check = spawnSync(process.execPath, [path.join(root, "scripts/builder-verify-published.mjs"), "--require", identity],
    { cwd: root, encoding: "utf8" });
  if (check.status !== 0) throw new Error(`BUILDER_PUBLISH_VERIFY_FAILED:${check.stderr.trim().slice(0, 300)}`);
  process.stdout.write(`${identity} packageHash=${publication.packageHash} sourceSha256=${publication.sourceSha256} assets=${assets.length}\n`);
} catch (error) {
  const addedAssets = ingest.readManifest(root).assets.filter(item => !previousAssets.has(item.resolverKey));
  for (const [file, bytes] of snapshots) {
    const target = path.join(root, file);
    if (bytes === undefined) { if (fs.existsSync(target)) fs.unlinkSync(target); }
    else fs.writeFileSync(target, bytes);
  }
  for (const asset of addedAssets) {
    const target = path.join(root, "assets/imaging", asset.resolverKey);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  if (indexSnapshot === undefined) { if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath); }
  else fs.writeFileSync(indexPath, indexSnapshot);
  throw error;
}
