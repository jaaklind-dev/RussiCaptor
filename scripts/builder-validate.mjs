import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(import.meta.dirname, "..");
const { install } = require("./lib/load-russicaptor-typescript.cjs");
install(rootDir);
const { compileBuilderDraft } = require(path.join(rootDir, "src/services/builder/ExerciseBuilderService.ts"));
const { getRegisteredImagingAsset } = require(path.join(rootDir, "src/services/imaging/ImagingAssetRegistry.ts"));
const bundle = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (bundle.schemaVersion !== 1 || bundle.draft?.schemaVersion !== 1) throw new Error("BUILDER_BUNDLE_VERSION");
const assets = Object.fromEntries(bundle.draft.studies.filter(study => study.image).map(study => {
  const slug = value => value.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
  const assetId = `${slug(bundle.draft.packageId)}.${slug(study.id)}.${slug(study.id)}.v1`;
  const asset = getRegisteredImagingAsset(assetId);
  if (!asset) throw new Error(`BUILDER_ASSET_MISSING:${study.id}`);
  return [study.id, asset];
}));
const result = compileBuilderDraft(bundle.draft, assets);
process.stdout.write(JSON.stringify(result));
