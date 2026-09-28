import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ingest, verifyManifest } = require("./lib/imaging-asset-ingest-core.cjs");
const rootDir = path.resolve(import.meta.dirname, "..");
const values = new Map(); const flags = new Set();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
  if (["--dry-run", "--verify"].includes(item)) { flags.add(item); continue; }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
  values.set(item, value); index += 1;
}
if (flags.has("--verify")) {
  const result = verifyManifest(rootDir);
  console.log(`Imaging asset manifest verified: ${result.assetCount} asset(s)`);
  process.exit(0);
}
const required = ["--source", "--package-id", "--package-version", "--patient-id", "--definition-id", "--logical-name"];
for (const key of required) if (!values.has(key)) throw new Error(`Missing required argument: ${key}`);
const result = ingest(rootDir, {
  sourcePath: values.get("--source"), packageId: values.get("--package-id"), packageVersion: values.get("--package-version"),
  patientId: values.get("--patient-id"), definitionId: values.get("--definition-id"), logicalName: values.get("--logical-name"),
  assetVersion: values.get("--asset-version") ?? "1", role: values.get("--role"), sourceUrl: values.get("--source-url"),
  attribution: values.get("--attribution"), licenseId: values.get("--license-id"), licenseUrl: values.get("--license-url"),
  contributor: values.get("--contributor"), modificationNote: values.get("--modification-note"),
}, { dryRun: flags.has("--dry-run") });
console.log(`Imaging asset ${flags.has("--dry-run") ? "dry-run" : result.status.toLowerCase()}`);
console.log(`assetId: ${result.asset.assetId}`);
console.log(`SHA-256: ${result.asset.sha256}`);
console.log(`media: ${result.asset.mediaType} ${result.asset.width}x${result.asset.height} (${result.asset.byteLength} bytes)`);
console.log(`resolverKey: ${result.asset.resolverKey}`);
console.log(`destination: ${path.relative(rootDir, result.destinationPath)}`);
