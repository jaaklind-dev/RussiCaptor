import type {
  DeprecatedInput,
  ExerciseModuleBinding,
  ImportCellValue,
  ImportSheetData,
  ImportUnit,
  ModuleDependency,
  ModuleImportIssue,
  ModuleImportManifest,
  ModuleRegistryEntry,
  OwnershipRule,
  SheetImportRule,
} from "@/models/ModuleImport";

export const manifestSheetNames = [
  "README",
  "ModuleRegistry",
  "DependencyEdges",
  "SheetImportRules",
  "ImportUnits",
  "OwnershipMap",
  "DuplicatePolicies",
  "DeprecatedInputs",
  "ExerciseBinding",
] as const;

export type ManifestSheets = Record<string, ImportSheetData>;

type TableRow = Record<string, ImportCellValue>;

function text(value: ImportCellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function bool(value: ImportCellValue | undefined): boolean {
  return value === true || text(value).toUpperCase() === "TRUE";
}

function number(value: ImportCellValue | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function tableRows(
  sheets: ManifestSheets,
  sheetName: string,
  requiredHeaders: string[]
): TableRow[] {
  const sheet = sheets[sheetName];
  if (!sheet) throw new Error(`Manifesti leht ${sheetName} puudub.`);
  const headerIndex = sheet.findIndex((row) =>
    requiredHeaders.every((header) => row.some((cell) => text(cell) === header))
  );
  if (headerIndex < 0) {
    throw new Error(`${sheetName}: nõutud veerupäiseid ei leitud.`);
  }
  const headers = sheet[headerIndex].map(text);
  return sheet.slice(headerIndex + 1).flatMap((values) => {
    if (values.every((value) => text(value) === "")) return [];
    const row: TableRow = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] ?? null;
    });
    return [row];
  });
}

function readMetadata(sheets: ManifestSheets): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of sheets.README ?? []) {
    const key = text(row[0]);
    const value = text(row[1]);
    if (key && value) result[key] = value;
  }
  return result;
}

export function parseModuleManifest(sheets: ManifestSheets): ModuleImportManifest {
  const metadata = readMetadata(sheets);
  const modules: ModuleRegistryEntry[] = tableRows(
    sheets,
    "ModuleRegistry",
    ["LoadOrder", "ModuleID", "ModuleVersion", "SourceFile", "LoadForExercise"]
  ).map((row) => ({
    loadOrder: number(row.LoadOrder),
    moduleId: text(row.ModuleID),
    moduleVersion: text(row.ModuleVersion),
    moduleType: text(row.ModuleType),
    sourceFile: text(row.SourceFile),
    requiredForExercise: bool(row.RequiredForExercise),
    loadForExercise: bool(row.LoadForExercise),
    active: bool(row.Active),
    importMode: text(row.ImportMode),
    duplicatePolicy: text(row.DuplicatePolicy),
    failurePolicy: text(row.FailurePolicy),
  }));

  const dependencies: ModuleDependency[] = tableRows(
    sheets,
    "DependencyEdges",
    ["ParentModuleID", "DependsOnModuleID", "Required", "MinimumVersion"]
  ).map((row) => ({
    parentModuleId: text(row.ParentModuleID),
    dependsOnModuleId: text(row.DependsOnModuleID),
    required: bool(row.Required),
    minimumVersion: text(row.MinimumVersion),
  }));

  const sheetRules: SheetImportRule[] = tableRows(
    sheets,
    "SheetImportRules",
    ["ModuleID", "SourceFile", "SheetName", "ImportClass", "ImportAtRuntime"]
  ).map((row) => ({
    moduleId: text(row.ModuleID),
    sourceFile: text(row.SourceFile),
    sheetName: text(row.SheetName),
    importClass: text(row.ImportClass),
    importAtRuntime: bool(row.ImportAtRuntime),
    requiredSheet: bool(row.RequiredSheet),
    onMissing: text(row.OnMissing),
  }));

  const importUnits: ImportUnit[] = tableRows(
    sheets,
    "ImportUnits",
    ["ImportOrder", "ImportUnitID", "ModuleID", "SheetName", "ImportClass"]
  ).map((row) => ({
    importOrder: number(row.ImportOrder),
    importUnitId: text(row.ImportUnitID),
    moduleId: text(row.ModuleID),
    sourceFile: text(row.SourceFile),
    sheetName: text(row.SheetName),
    importClass: text(row.ImportClass),
    enabledForExercise: bool(row.EnabledForExercise),
  }));

  const ownershipRules: OwnershipRule[] = tableRows(
    sheets,
    "OwnershipMap",
    ["ObjectType", "ObjectOrField", "CanonicalOwner"]
  ).map((row) => ({
    objectType: text(row.ObjectType),
    objectOrField: text(row.ObjectOrField),
    canonicalOwner: text(row.CanonicalOwner),
  }));

  // Parsing this sheet is deliberate: its presence and schema are part of the
  // canonical contract even though concrete duplicate checks are performed on payloads.
  tableRows(sheets, "DuplicatePolicies", ["ObjectNamespace", "Key", "Policy", "Severity"]);

  const deprecatedInputs: DeprecatedInput[] = tableRows(
    sheets,
    "DeprecatedInputs",
    ["DeprecatedInput", "SourceFile", "ImporterAction"]
  ).map((row) => ({
    deprecatedInput: text(row.DeprecatedInput),
    sourceFile: text(row.SourceFile),
    importerAction: text(row.ImporterAction),
  }));

  const bindings: ExerciseModuleBinding[] = tableRows(
    sheets,
    "ExerciseBinding",
    ["ExerciseID", "ExerciseModuleID", "RequiredModuleID", "RequiredVersion", "BindingType"]
  ).map((row) => ({
    exerciseId: text(row.ExerciseID),
    exerciseModuleId: text(row.ExerciseModuleID),
    requiredModuleId: text(row.RequiredModuleID),
    requiredVersion: text(row.RequiredVersion),
    bindingType: text(row.BindingType) as ExerciseModuleBinding["bindingType"],
  }));

  return {
    manifestId: metadata.ManifestID ?? "",
    manifestVersion: metadata.ManifestVersion ?? "",
    modules,
    dependencies,
    sheetRules,
    importUnits,
    bindings,
    deprecatedInputs,
    ownershipRules,
  };
}

function duplicateValues(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => value && values.indexOf(value) !== index))];
}

function versionAtLeast(actual: string, minimum: string): boolean {
  if (minimum === "repo") return actual === "repo";
  const actualParts = actual.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  if ([...actualParts, ...minimumParts].some((part) => !Number.isFinite(part))) {
    return actual === minimum;
  }
  const length = Math.max(actualParts.length, minimumParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (actualParts[index] ?? 0) - (minimumParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function validateModuleManifest(
  manifest: ModuleImportManifest,
  selectedFileNames: string[]
): ModuleImportIssue[] {
  const issues: ModuleImportIssue[] = [];
  const fatal = (code: string, message: string) =>
    issues.push({ severity: "FATAL", code, message });

  if (!manifest.manifestId || !manifest.manifestVersion) {
    fatal("MANIFEST_METADATA", "ManifestID või ManifestVersion puudub.");
  }

  for (const duplicate of duplicateValues(manifest.modules.map((item) => item.moduleId))) {
    fatal("DUPLICATE_MODULE", `ModuleID ${duplicate} esineb mitu korda.`);
  }
  for (const duplicate of duplicateValues(manifest.modules.map((item) => String(item.loadOrder)))) {
    fatal("DUPLICATE_LOAD_ORDER", `LoadOrder ${duplicate} esineb mitu korda.`);
  }

  const byId = new Map(manifest.modules.map((module) => [module.moduleId, module]));
  for (const dependency of manifest.dependencies) {
    if (
      !dependency.parentModuleId || !dependency.dependsOnModuleId ||
      !dependency.minimumVersion || dependency.parentModuleId === dependency.dependsOnModuleId
    ) {
      fatal("INVALID_DEPENDENCY", "DependencyEdges sisaldab tühja või iseendale viitavat sõltuvust.");
      continue;
    }
    const parent = byId.get(dependency.parentModuleId);
    const required = byId.get(dependency.dependsOnModuleId);
    if (!parent || !required) {
      fatal("UNKNOWN_DEPENDENCY", `${dependency.parentModuleId} sõltuvus viitab tundmatule moodulile.`);
    } else if (
      dependency.required && parent.loadForExercise &&
      (!required.active || !required.loadForExercise || required.loadOrder >= parent.loadOrder)
    ) {
      fatal("DEPENDENCY_ORDER", `${parent.moduleId} vajalik sõltuvus ${required.moduleId} ei ole varem laaditav.`);
    } else if (
      dependency.required && parent.loadForExercise &&
      !versionAtLeast(required.moduleVersion, dependency.minimumVersion)
    ) {
      fatal("DEPENDENCY_VERSION", `${parent.moduleId} vajab ${required.moduleId} versiooni vähemalt ${dependency.minimumVersion}.`);
    }
  }

  const dependencyGraph = new Map<string, string[]>();
  for (const module of manifest.modules) dependencyGraph.set(module.moduleId, []);
  for (const dependency of manifest.dependencies.filter((item) => item.required)) {
    if (byId.has(dependency.parentModuleId) && byId.has(dependency.dependsOnModuleId)) {
      dependencyGraph.get(dependency.parentModuleId)!.push(dependency.dependsOnModuleId);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (moduleId: string): boolean => {
    if (visiting.has(moduleId)) return true;
    if (visited.has(moduleId)) return false;
    visiting.add(moduleId);
    const cycle = (dependencyGraph.get(moduleId) ?? []).some(hasCycle);
    visiting.delete(moduleId);
    visited.add(moduleId);
    return cycle;
  };
  if (manifest.modules.some((module) => hasCycle(module.moduleId))) {
    fatal("DEPENDENCY_CYCLE", "DependencyEdges sisaldab tsüklilist sõltuvust.");
  }

  const runtimeClasses = new Set(["RUNTIME_CONFIG", "EXERCISE_DATA"]);
  for (const unit of manifest.importUnits.filter((item) => item.enabledForExercise)) {
    const rule = manifest.sheetRules.find(
      (candidate) => candidate.moduleId === unit.moduleId && candidate.sheetName === unit.sheetName
    );
    if (!runtimeClasses.has(unit.importClass) || !rule || !rule.importAtRuntime || rule.importClass !== unit.importClass) {
      fatal("IMPORT_UNIT_CLASS", `${unit.importUnitId} ei vasta runtime sheet-reeglile.`);
    }
  }

  for (const rule of manifest.sheetRules) {
    if (rule.importAtRuntime && !runtimeClasses.has(rule.importClass)) {
      fatal("SHEET_CLASS", `${rule.moduleId}/${rule.sheetName} on runtime, kuid klass ${rule.importClass} pole lubatud.`);
    }
  }

  const ownershipKeys = manifest.ownershipRules.map(
    (rule) => `${rule.objectType}\u0000${rule.objectOrField}`
  );
  for (const duplicate of duplicateValues(ownershipKeys)) {
    const [, field] = duplicate.split("\u0000");
    fatal("OWNERSHIP_CONFLICT", `${field} omanik on määratud mitu korda.`);
  }

  const selected = new Set(selectedFileNames);
  for (const deprecated of manifest.deprecatedInputs) {
    if (selected.has(deprecated.sourceFile)) {
      fatal("DEPRECATED_INPUT", `${deprecated.sourceFile} on deprecated sisend ja seda ei impordita.`);
    }
  }

  for (const module of manifest.modules.filter((item) => item.sourceFile !== "REPOSITORY_RUNTIME")) {
    if (!selected.has(module.sourceFile)) {
      fatal("MISSING_FILE", `${module.moduleId}: fail ${module.sourceFile} puudub.`);
    }
  }


  const exerciseModules = manifest.modules.filter((module) => module.moduleType === "EXERCISE_INSTANCE");
  const exerciseIds = new Set(manifest.bindings.map((binding) => binding.exerciseId).filter(Boolean));
  for (const binding of manifest.bindings) {
    const exerciseModule = byId.get(binding.exerciseModuleId);
    const requiredModule = byId.get(binding.requiredModuleId);
    if (!binding.exerciseId || !exerciseModule || exerciseModule.moduleType !== "EXERCISE_INSTANCE") {
      fatal("INVALID_EXERCISE_BINDING", "ExerciseBinding viitab puuduvale õppusele või õppuse moodulile.");
    }
    if (!requiredModule || requiredModule.moduleVersion !== binding.requiredVersion) {
      fatal("INVALID_EXERCISE_BINDING", `${binding.requiredModuleId} bindingu moodul või versioon ei vasta registrile.`);
    }
    if (!["RUNTIME", "TEMPLATE", "EXCLUDED"].includes(binding.bindingType)) {
      fatal("INVALID_EXERCISE_BINDING", `${binding.requiredModuleId} BindingType pole lubatud.`);
    }
  }
  if (exerciseModules.length !== 1 || exerciseIds.size !== 1) {
    fatal("INVALID_EXERCISE_BINDING", "Paketis peab olema täpselt üks üheselt seotud EXERCISE_INSTANCE moodul.");
  }

  return issues;
}
