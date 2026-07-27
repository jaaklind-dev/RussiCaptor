export type ImportCellValue = string | number | boolean | null;
export type ImportSheetData = ImportCellValue[][];

export type ModuleRegistryEntry = {
  loadOrder: number;
  moduleId: string;
  moduleVersion: string;
  moduleType: string;
  sourceFile: string;
  requiredForExercise: boolean;
  loadForExercise: boolean;
  active: boolean;
  importMode: string;
  duplicatePolicy: string;
  failurePolicy: string;
};

export type ModuleDependency = {
  parentModuleId: string;
  dependsOnModuleId: string;
  required: boolean;
  minimumVersion: string;
};

export type SheetImportRule = {
  moduleId: string;
  sourceFile: string;
  sheetName: string;
  importClass: string;
  importAtRuntime: boolean;
  requiredSheet: boolean;
  onMissing: string;
};

export type ImportUnit = {
  importOrder: number;
  importUnitId: string;
  moduleId: string;
  sourceFile: string;
  sheetName: string;
  importClass: string;
  enabledForExercise: boolean;
};

export type ExerciseModuleBinding = {
  exerciseId: string;
  exerciseModuleId: string;
  requiredModuleId: string;
  requiredVersion: string;
  bindingType: "RUNTIME" | "TEMPLATE" | "EXCLUDED";
};

export type DeprecatedInput = {
  deprecatedInput: string;
  sourceFile: string;
  importerAction: string;
};

export type OwnershipRule = {
  objectType: string;
  objectOrField: string;
  canonicalOwner: string;
};

export type ModuleImportManifest = {
  manifestId: string;
  manifestVersion: string;
  modules: ModuleRegistryEntry[];
  dependencies: ModuleDependency[];
  sheetRules: SheetImportRule[];
  importUnits: ImportUnit[];
  bindings: ExerciseModuleBinding[];
  deprecatedInputs: DeprecatedInput[];
  ownershipRules: OwnershipRule[];
};

export type CanonicalSheet = {
  columns: string[];
  rows: Record<string, ImportCellValue>[];
};

export type CanonicalModulePayload = {
  schemaVersion: 1;
  moduleId: string;
  moduleVersion: string;
  moduleType: string;
  sourceFile: string;
  sheets: Record<string, CanonicalSheet>;
};

export type StagedModule = {
  registry: ModuleRegistryEntry;
  contentHash: string;
  payload: CanonicalModulePayload;
};

export type ModuleImportIssue = {
  severity: "FATAL" | "WARNING";
  code: string;
  message: string;
};

export type ModulePackageImportResult =
  | {
      ok: true;
      importRunId?: string;
      exerciseId: string;
      exerciseVersion: string;
      moduleCount: number;
      noOp: boolean;
      warnings: ModuleImportIssue[];
    }
  | { ok: false; issues: ModuleImportIssue[] };

