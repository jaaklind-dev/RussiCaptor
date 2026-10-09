import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const rootDir = path.resolve(import.meta.dirname, "..");
const { loadAuthoringContext } = require("./lib/load-russicaptor-typescript.cjs");
const context = loadAuthoringContext(rootDir);
const pkg = context.registry.require(process.argv[2], process.argv[3]);
context.validator.assertValid(pkg);
context.datasets.resolve(pkg.patientDatasetId);
