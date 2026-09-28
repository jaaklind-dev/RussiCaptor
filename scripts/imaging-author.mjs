import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { authorPackage } = require("./lib/imaging-author-core.cjs");
const { loadAuthoringContext } = require("./lib/load-russicaptor-typescript.cjs");
const rootDir = path.resolve(import.meta.dirname, "..");
const valueFlags = new Set(["--source", "--package-id", "--base-version", "--new-version", "--patient-id",
  "--definition-id", "--logical-name", "--asset-version", "--role", "--source-url", "--contributor",
  "--license-id", "--license-url", "--attribution", "--modification-note"]);
const booleanFlags = new Set(["--dry-run", "--json"]);
const values = new Map(); const flags = new Set();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (booleanFlags.has(item)) { flags.add(item); continue; }
  if (!valueFlags.has(item)) throw new Error(`Unexpected argument: ${item}`);
  const value = process.argv[++index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
  values.set(item, value);
}
const required = ["--source", "--package-id", "--base-version", "--new-version", "--patient-id",
  "--definition-id", "--logical-name"];
for (const key of required) if (!values.has(key)) throw new Error(`Missing required argument: ${key}`);
const context = loadAuthoringContext(rootDir);
const result = authorPackage(rootDir, {
  sourcePath: values.get("--source"), packageId: values.get("--package-id"),
  baseVersion: values.get("--base-version"), newVersion: values.get("--new-version"),
  patientId: values.get("--patient-id"), definitionId: values.get("--definition-id"),
  logicalName: values.get("--logical-name"), assetVersion: values.get("--asset-version") ?? "1",
  role: values.get("--role"), sourceUrl: values.get("--source-url"), contributor: values.get("--contributor"),
  licenseId: values.get("--license-id"), licenseUrl: values.get("--license-url"),
  attribution: values.get("--attribution"), modificationNote: values.get("--modification-note"),
}, context, { dryRun: flags.has("--dry-run"), onValidated: plan => {
  if (!flags.has("--dry-run") && !flags.has("--json")) {
    console.log(`Confirmed exact authoring target: ${plan.packageId}@${plan.baseVersion} -> ${plan.newVersion}; ${plan.patientId} / ${plan.definitionId}; ${plan.operation}`);
  }
}, validateAfterWrite: authored => {
  const validation = spawnSync(process.execPath, [path.join(rootDir, "scripts/imaging-author-validate.mjs"),
    authored.packageId, authored.packageVersion], { cwd: rootDir, encoding: "utf8" });
  if (validation.status !== 0) throw new Error("IMAGING_AUTHOR_POST_WRITE_VALIDATION_FAILED");
} });

if (flags.has("--json")) console.log(JSON.stringify(result));
else {
  console.log(`Imaging package authoring ${result.status.toLowerCase()}: ${result.operation}`);
  console.log(`package: ${result.packageId}@${result.baseVersion} -> ${result.newVersion}`);
  console.log(`target: ${result.patientId} / ${result.definitionId}`);
  console.log(`existing asset: ${result.studyHadAsset ? result.previousAssetId : "NO"}`);
  console.log(`assetId: ${result.assetId}`);
  console.log(`resolverKey: ${result.resolverKey}`);
  console.log(`SHA-256: ${result.sha256}`);
  console.log(`media: ${result.mediaType} ${result.width}x${result.height} (${result.byteLength} bytes)`);
  console.log(`package hash: ${result.packageHash}`);
  console.log(`provenance: ${result.provenancePresent ? "YES" : "NO"}; license metadata: ${result.licenseMetadataPresent ? "YES" : "NO"}`);
  console.log(`${flags.has("--dry-run") ? "would change" : "changed"}: ${result.files.join(", ")}`);
}
