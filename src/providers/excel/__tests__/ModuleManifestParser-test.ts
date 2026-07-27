import type { ImportSheetData } from "@/models/ModuleImport";
import {
  parseModuleManifest,
  validateModuleManifest,
  type ManifestSheets,
} from "@/providers/excel/ModuleManifestParser";
import { sha256Text } from "@/utils/sha256";

function sheet(headers: string[], rows: (string | number | null)[][]): ImportSheetData {
  return [["Title"], [], headers, ...rows];
}

function createManifestSheets(): ManifestSheets {
  return {
    README: [["Title"], [], ["ManifestID", "TEST-MANIFEST"], ["ManifestVersion", "1.0"]],
    ModuleRegistry: sheet([
      "LoadOrder", "ModuleID", "ModuleVersion", "ModuleType", "SourceFile",
      "RequiredForExercise", "LoadForExercise", "Active", "ImportMode",
      "DuplicatePolicy", "FailurePolicy",
    ], [
      [10, "CORE_ENGINE", "repo", "ENGINE_CORE", "REPOSITORY_RUNTIME", "TRUE", "TRUE", "TRUE", "REGISTER_ONLY", "SINGLETON", "ABORT_IMPORT"],
      [20, "TEST_EXERCISE", "1.0", "EXERCISE_INSTANCE", "Exercise.xlsx", "TRUE", "TRUE", "TRUE", "EXERCISE_DATA", "ONE_ACTIVE_VERSION_PER_EXERCISE_ID", "ABORT_IMPORT"],
    ]),
    DependencyEdges: sheet([
      "ParentModuleID", "DependsOnModuleID", "Required", "MinimumVersion",
    ], [["TEST_EXERCISE", "CORE_ENGINE", "TRUE", "repo"]]),
    SheetImportRules: sheet([
      "ModuleID", "SourceFile", "SheetName", "ImportClass", "ImportAtRuntime",
      "RequiredSheet", "OnMissing",
    ], [["TEST_EXERCISE", "Exercise.xlsx", "PatientRoster", "EXERCISE_DATA", "TRUE", "TRUE", "ABORT_IMPORT"]]),
    ImportUnits: sheet([
      "ImportOrder", "ImportUnitID", "ModuleID", "SourceFile", "SheetName",
      "ImportClass", "EnabledForExercise",
    ], [[100, "IU-PATIENTS", "TEST_EXERCISE", "Exercise.xlsx", "PatientRoster", "EXERCISE_DATA", "TRUE"]]),
    OwnershipMap: sheet([
      "ObjectType", "ObjectOrField", "CanonicalOwner",
    ], [["ExerciseObject", "Patient", "TEST_EXERCISE"]]),
    DuplicatePolicies: sheet([
      "ObjectNamespace", "Key", "Policy", "Severity",
    ], [["Patient", "ExerciseID + PatientID", "REJECT", "FATAL"]]),
    DeprecatedInputs: sheet([
      "DeprecatedInput", "SourceFile", "ImporterAction",
    ], [["Old exercise", "Old.xlsx", "DO_NOT_ACTIVATE"]]),
    ExerciseBinding: sheet([
      "ExerciseID", "ExerciseModuleID", "RequiredModuleID", "RequiredVersion", "BindingType",
    ], [["EX-001", "TEST_EXERCISE", "CORE_ENGINE", "repo", "RUNTIME"]]),
  };
}

describe("module manifest parser", () => {
  test("parses and validates the canonical manifest tables", () => {
    const manifest = parseModuleManifest(createManifestSheets());
    expect(manifest.manifestId).toBe("TEST-MANIFEST");
    expect(manifest.modules.map((module) => module.moduleId)).toEqual([
      "CORE_ENGINE", "TEST_EXERCISE",
    ]);
    expect(validateModuleManifest(manifest, ["Exercise.xlsx"])).toEqual([]);
  });

  test("rejects deprecated inputs and a dependency loaded in the wrong order", () => {
    const sheets = createManifestSheets();
    sheets.ModuleRegistry[4][0] = 5;
    const issues = validateModuleManifest(
      parseModuleManifest(sheets),
      ["Exercise.xlsx", "Old.xlsx"]
    );
    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["DEPENDENCY_ORDER", "DEPRECATED_INPUT"])
    );
  });

  test("rejects a missing mandatory manifest sheet", () => {
    const sheets = createManifestSheets();
    delete sheets.ExerciseBinding;
    expect(() => parseModuleManifest(sheets)).toThrow("ExerciseBinding");
  });

  test("rejects malformed, missing and cyclic dependencies", () => {
    const malformed = createManifestSheets();
    malformed.DependencyEdges[3][1] = "";
    expect(validateModuleManifest(parseModuleManifest(malformed), ["Exercise.xlsx"])
      .map((item) => item.code)).toContain("INVALID_DEPENDENCY");

    const missing = createManifestSheets();
    missing.DependencyEdges[3][1] = "MISSING_MODULE";
    expect(validateModuleManifest(parseModuleManifest(missing), ["Exercise.xlsx"])
      .map((item) => item.code)).toContain("UNKNOWN_DEPENDENCY");

    const cyclic = createManifestSheets();
    cyclic.DependencyEdges.push(["CORE_ENGINE", "TEST_EXERCISE", "TRUE", "1.0"]);
    expect(validateModuleManifest(parseModuleManifest(cyclic), ["Exercise.xlsx"])
      .map((item) => item.code)).toContain("DEPENDENCY_CYCLE");
  });

  test("rejects an ExerciseBinding with the wrong required version", () => {
    const sheets = createManifestSheets();
    sheets.ExerciseBinding[3][3] = "wrong";
    expect(validateModuleManifest(parseModuleManifest(sheets), ["Exercise.xlsx"])
      .map((item) => item.code)).toContain("INVALID_EXERCISE_BINDING");
  });

  test("file selection order does not change validation", () => {
    const manifest = parseModuleManifest(createManifestSheets());
    expect(validateModuleManifest(manifest, ["Exercise.xlsx", "Old.xlsx"]))
      .toEqual(validateModuleManifest(manifest, ["Old.xlsx", "Exercise.xlsx"]));
  });

  test("computes standard SHA-256 values without a platform dependency", () => {
    expect(sha256Text("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});
