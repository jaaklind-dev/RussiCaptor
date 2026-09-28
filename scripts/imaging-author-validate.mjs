import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { verifyManifest } = require("./lib/imaging-asset-ingest-core.cjs");
const { loadAuthoringContext } = require("./lib/load-russicaptor-typescript.cjs");
const rootDir = path.resolve(import.meta.dirname, "..");
const [packageId, packageVersion] = process.argv.slice(2);
if (!packageId || !packageVersion) throw new Error("IMAGING_AUTHOR_VALIDATION_IDENTITY_REQUIRED");
verifyManifest(rootDir);
const context = loadAuthoringContext(rootDir);
const pkg = context.registry.get(packageId, packageVersion);
if (!pkg) throw new Error("IMAGING_AUTHOR_GENERATED_PACKAGE_NOT_LOADED");
context.validator.assertValid(pkg);
