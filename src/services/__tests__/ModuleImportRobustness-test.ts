import type {
  ModuleImportManifest,
  ModuleRegistryEntry,
  StagedModule,
} from "@/models/ModuleImport";
import {
  evaluateExactActiveNoOp,
  validateStagedPackage,
} from "@/services/ModuleImportService";

function registry(
  loadOrder: number,
  moduleId: string,
  moduleType: string,
  loadForExercise = true
): ModuleRegistryEntry {
  return {
    loadOrder,
    moduleId,
    moduleVersion: "1.0",
    moduleType,
    sourceFile: `${moduleId}.xlsx`,
    requiredForExercise: loadForExercise,
    loadForExercise,
    active: true,
    importMode: "RUNTIME_CONFIG",
    duplicatePolicy: "REJECT",
    failurePolicy: "ABORT_IMPORT",
  };
}

function stagedPackage(): { modules: StagedModule[]; manifest: ModuleImportManifest } {
  const registries = [
    registry(10, "CORE_ENGINE", "ENGINE_CORE"),
    registry(20, "HYPOVENTILATION_HYPERCAPNIA_V1", "CLINICAL_MODULE"),
    registry(30, "HYPOXIA_V1", "CLINICAL_MODULE"),
    registry(40, "BOTULISM_V1", "CLINICAL_MODULE"),
    registry(50, "HEMORRHAGE_V1", "CLINICAL_MODULE", false),
    registry(60, "BOT_EXERCISE", "EXERCISE_INSTANCE"),
  ];
  const patients = Array.from({ length: 12 }, (_, index) => ({
    PatientID: `PT-${String(index + 1).padStart(3, "0")}`,
    ArrivalClock: index === 11 ? "13:35" : "13:00",
    SourceStatus: "READY",
  }));
  const processes = patients.flatMap((patient, patientIndex) =>
    Array.from({ length: 5 }, (_, processIndex) => ({
      PatientProcessID: `PP-${patientIndex + 1}-${processIndex + 1}`,
      PatientID: patient.PatientID,
      ParentProcessID: "",
      TemplateID: "TMP-BASE",
      TriggerRuleID: "TRG-HYP",
    }))
  );
  const sheetsByModule: Record<string, StagedModule["payload"]["sheets"]> = {
    CORE_ENGINE: {},
    HYPOVENTILATION_HYPERCAPNIA_V1: {
      ProcessTemplates: { columns: ["TemplateID"], rows: [{ TemplateID: "TMP-BASE" }] },
      TriggerRules: {
        columns: ["TriggerRuleID"],
        rows: [
          {
            TriggerRuleID: "TRG-SEV",
            ChildTemplateID: "HV_NM_SEV",
            ParentTransition: "RESOLVE_AND_REPLACE",
            Repeatable: "FALSE",
          },
          {
            TriggerRuleID: "TRG-HYP",
            ChildTemplateID: "HYP_HYPOVENT_MOD",
            Repeatable: "FALSE",
          },
        ],
      },
    },
    HYPOXIA_V1: {},
    BOTULISM_V1: {},
    HEMORRHAGE_V1: {},
    BOT_EXERCISE: {
      ScenarioSettings: {
        columns: ["SettingID", "Value"],
        rows: [
          { SettingID: "PatientCountExpected", Value: 12 },
          { SettingID: "ProcessesPerPatientExpected", Value: 5 },
        ],
      },
      PatientRoster: { columns: ["PatientID"], rows: patients },
      PatientProcessAssignments: { columns: ["PatientProcessID"], rows: processes },
      ExerciseEvents: { columns: ["EventID"], rows: [{ EventID: "EV-001" }] },
    },
  };
  const modules = registries.map((entry) => ({
    registry: entry,
    contentHash: entry.moduleId.toLowerCase().padEnd(64, "0").slice(0, 64),
    payload: {
      schemaVersion: 1 as const,
      moduleId: entry.moduleId,
      moduleVersion: entry.moduleVersion,
      moduleType: entry.moduleType,
      sourceFile: entry.sourceFile,
      sheets: sheetsByModule[entry.moduleId],
    },
  }));
  const sheetRules = Object.entries(sheetsByModule).flatMap(([moduleId, sheets]) =>
    Object.keys(sheets).map((sheetName) => ({
      moduleId,
      sourceFile: `${moduleId}.xlsx`,
      sheetName,
      importClass: moduleId === "BOT_EXERCISE" ? "EXERCISE_DATA" : "RUNTIME_CONFIG",
      importAtRuntime: true,
      requiredSheet: true,
      onMissing: "ABORT_IMPORT",
    }))
  );
  return {
    modules,
    manifest: {
      manifestId: "WP-3A",
      manifestVersion: "1.0",
      modules: registries,
      dependencies: [],
      sheetRules,
      importUnits: [],
      deprecatedInputs: [],
      ownershipRules: [],
      bindings: registries.slice(0, 5).map((entry) => ({
        exerciseId: "BOT-FOODBORNE-2026-01",
        exerciseModuleId: "BOT_EXERCISE",
        requiredModuleId: entry.moduleId,
        requiredVersion: entry.moduleVersion,
        bindingType: entry.moduleId === "HEMORRHAGE_V1" ? "EXCLUDED" : "RUNTIME",
      })),
    },
  };
}

function clonePackage() {
  return structuredClone(stagedPackage());
}

function codes(value: ReturnType<typeof stagedPackage>): string[] {
  return validateStagedPackage(value.modules, value.manifest).map((item) => item.code);
}

function exercise(value: ReturnType<typeof stagedPackage>): StagedModule {
  return value.modules.find((module) => module.registry.moduleId === "BOT_EXERCISE")!;
}

describe("WP-3A package robustness", () => {
  test("accepts the canonical six-module package", () => {
    expect(codes(stagedPackage())).toEqual([]);
  });

  test("rejects a missing required runtime sheet", () => {
    const value = clonePackage();
    delete exercise(value).payload.sheets.PatientRoster;
    expect(codes(value)).toContain("REQUIRED_SHEET");
  });

  test.each([
    ["PatientID", "PatientRoster", "DUPLICATE_PATIENT"],
    ["PatientProcessID", "PatientProcessAssignments", "DUPLICATE_PROCESS"],
    ["EventID", "ExerciseEvents", "DUPLICATE_EVENT"],
  ])("rejects duplicate %s", (column, sheetName, expectedCode) => {
    const value = clonePackage();
    const rows = exercise(value).payload.sheets[sheetName].rows;
    if (rows.length === 1) rows.push({ ...rows[0] });
    else rows[1][column] = rows[0][column];
    expect(codes(value)).toContain(expectedCode);
  });

  test("rejects duplicate TemplateID and TriggerRuleID", () => {
    const templateValue = clonePackage();
    const clinical = templateValue.modules[1];
    clinical.payload.sheets.ProcessTemplates.rows.push({ TemplateID: "TMP-BASE" });
    expect(codes(templateValue)).toContain("DUPLICATE_TEMPLATE");

    const triggerValue = clonePackage();
    triggerValue.modules[1].payload.sheets.TriggerRules.rows.push({ TriggerRuleID: "TRG-HYP" });
    expect(codes(triggerValue)).toContain("DUPLICATE_TRIGGER");
  });

  test("applies Botulism trigger invariants only through its package validator", () => {
    const value = clonePackage();
    value.modules[1].payload.sheets.TriggerRules.rows = [];
    expect(codes(value)).toEqual(expect.arrayContaining(["HV_CHILD_REPLACEMENT", "HYPOXIA_CHILD_IDEMPOTENCY"]));
  });

  test("rejects patient, process and per-patient count violations", () => {
    const patientValue = clonePackage();
    exercise(patientValue).payload.sheets.PatientRoster.rows.pop();
    expect(codes(patientValue)).toContain("PATIENT_COUNT");

    const processValue = clonePackage();
    exercise(processValue).payload.sheets.PatientProcessAssignments.rows.pop();
    expect(codes(processValue)).toEqual(
      expect.arrayContaining(["PROCESS_COUNT", "PROCESSES_PER_PATIENT"])
    );
  });

  test("rejects a patient that is not READY", () => {
    const value = clonePackage();
    exercise(value).payload.sheets.PatientRoster.rows[0].SourceStatus = "DRAFT";
    expect(codes(value)).toContain("PATIENT_READY");
  });

  test("keeps HEMORRHAGE_V1 excluded from this exercise runtime", () => {
    const value = clonePackage();
    value.modules[4].payload.sheets.ProcessTemplates = {
      columns: ["TemplateID"],
      rows: [{ TemplateID: "HEM-TMP" }],
    };
    expect(codes(value)).toContain("EXCLUDED_RUNTIME");
  });

  test("rejects deprecated active payload references", () => {
    const value = clonePackage();
    exercise(value).payload.sheets.ExerciseEvents.rows[0].LegacyInput = "TRG-RESP-01";
    expect(codes(value)).toContain("DEPRECATED_REFERENCE");
  });

  test("treats the same hashes as a no-op regardless of file order", () => {
    const value = stagedPackage();
    const existing = value.modules.map((module) => ({
      module_id: module.registry.moduleId,
      module_version: module.registry.moduleVersion,
      content_hash: module.contentHash,
    }));
    const exerciseModule = exercise(value);
    const evaluate = (modules: StagedModule[]) => evaluateExactActiveNoOp(
      modules,
      existing,
      { content_hash: exerciseModule.contentHash, is_active: true },
      exerciseModule,
      "BOT-FOODBORNE-2026-01",
      "1.0"
    );
    expect(evaluate(value.modules)).toBe(true);
    expect(evaluate([...value.modules].reverse())).toBe(true);
  });

  test("rejects the same ModuleID and version with different content", () => {
    const value = stagedPackage();
    const existing = value.modules.map((module) => ({
      module_id: module.registry.moduleId,
      module_version: module.registry.moduleVersion,
      content_hash: module.contentHash,
    }));
    existing[1].content_hash = "different";
    expect(() => evaluateExactActiveNoOp(
      value.modules,
      existing,
      { content_hash: exercise(value).contentHash, is_active: true },
      exercise(value),
      "BOT-FOODBORNE-2026-01",
      "1.0"
    )).toThrow("FATAL module version content conflict");
  });
});
