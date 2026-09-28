const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

let installedRoot;

function install(rootDir) {
  const root = path.resolve(rootDir);
  if (installedRoot && installedRoot !== root) throw new Error("TYPESCRIPT_PROJECT_ROOT_ALREADY_INSTALLED");
  if (installedRoot) return;
  installedRoot = root;
  const originalResolve = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    const mapped = request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request;
    return originalResolve.call(this, mapped, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === "expo-crypto") return Object.freeze({});
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions[".ts"] = (module, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    module._compile(output, filename);
  };
  for (const extension of [".jpg", ".jpeg", ".png"]) {
    require.extensions[extension] = (module, filename) => { module.exports = filename; };
  }
}

function loadAuthoringContext(rootDir) {
  install(rootDir);
  const service = require(path.join(rootDir, "src/services/exercise/ExercisePackageService.ts"));
  const datasets = require(path.join(rootDir, "src/services/exercise/CanonicalPatientDatasets.ts"));
  const authoring = require(path.join(rootDir, "src/services/imaging/ImagingAuthoredPackageLoader.ts"));
  const assets = require(path.join(rootDir, "src/services/imaging/ImagingAssetRegistry.ts"));
  return {
    registry: service.exercisePackageRegistry,
    validator: service.exercisePackageValidator,
    datasets: datasets.packagePatientDatasetRegistry,
    createImagingAuthoredPackage: authoring.createImagingAuthoredPackage,
    getRegisteredImagingAsset: assets.getRegisteredImagingAsset,
    resolveImagingAsset: assets.resolveImagingAsset,
  };
}

module.exports = { install, loadAuthoringContext };
