import type { ModuleImportManifest, ModuleRegistryEntry, StagedModule } from "@/models/ModuleImport";
import type { PackagePatientDataset } from "@/models/exercise/PackagePatientDataset";
import { PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION } from "@/modules/pelvicInjury/PelvicInjuryManifest";
import { PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION } from "@/modules/pleuralInjury/PleuralInjuryManifest";
import { TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION } from "@/modules/traumaCore/TraumaCoreManifest";
import { validateStagedPackage } from "@/services/ModuleImportService";
import { CANONICAL_EXERCISE_PACKAGES } from "@/services/exercise/CanonicalExercisePackages";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";
import { createPatientMaterializationPlan, PackagePatientDatasetRegistry } from "@/services/exercise/PackagePatientMaterializationService";
import { ExercisePackageRegistry } from "@/services/exercise/ExercisePackageRegistry";
import { ExercisePackageValidator } from "@/services/exercise/ExercisePackageValidator";
import { EXERCISE_DEFINITION_CATALOG } from "@/services/exercise/ExerciseDefinitionService";
import { ImportedExercisePackageRegistry } from "@/services/import/ImportedExercisePackageRegistry";
import { parseImportedExercisePackageArtifacts } from "@/services/import/ImportedExercisePackageParser";

const trauma = CANONICAL_EXERCISE_PACKAGES.find((pkg) => pkg.definition.profile === "TRAUMA")!;
const patient = (id: string, location: string) => ({ id, isikukood: `TEST-${id}`, name: `Patient ${id}`, triage: "P1" as const, status: "Active" as const, location, lastSeen: "T+0", mist: { mechanism: "Synthetic", injuries: "Synthetic", signs: "Synthetic", treatment: "None" } });
const registry = (loadOrder: number, moduleId: string, moduleVersion: string, moduleType: string, sourceFile = "REPOSITORY_RUNTIME"): ModuleRegistryEntry => ({ loadOrder, moduleId, moduleVersion, moduleType, sourceFile, requiredForExercise: true, loadForExercise: true, active: true, importMode: sourceFile === "REPOSITORY_RUNTIME" ? "REGISTER_ONLY" : "EXERCISE_DATA", duplicatePolicy: "REJECT", failurePolicy: "ABORT_IMPORT" });

function genericPackage(patientCount = 2) {
  const packageId = `generic-trauma-import-test-${patientCount}`;
  const datasetId = `patients.generic-trauma-import-test-${patientCount}.v1`;
  const definition = Object.freeze({ ...structuredClone(trauma.definition), exerciseTypeId: `GENERIC_TRAUMA_IMPORT_TEST_${patientCount}` });
  const pkg = createExercisePackage({ packageId, packageVersion: "1.0.0", definition, patientDatasetId: datasetId,
    enabledPatientProcesses: definition.enabledPatientProcesses, enabledAnalyticsProviders: definition.enabledAnalyticsProviders,
    enabledMetricProviders: definition.enabledMetricProviders, requiredClinicalModules: [
      { moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION },
      { moduleId: PLEURAL_INJURY_MODULE_ID, version: PLEURAL_INJURY_MODULE_VERSION },
    ], metadata: { name: "Generic trauma import test", description: "Import infrastructure fixture", author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "1.0.0", exerciseType: "TRAUMA", tags: ["test"] } });
  const records = [patient("GEN-A", "Resus A"), patient("GEN-B", "Resus B")].slice(0, patientCount);
  const dataset: PackagePatientDataset = { datasetId, version: "1", patients: records.map((value, index) => ({ patient: value, initialLocationId: `LOC-${index + 1}` })) };
  const registries = [registry(10, "CORE_ENGINE", "repo", "ENGINE_CORE"), registry(20, TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION, "CLINICAL_MODULE"), registry(30, PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION, "CLINICAL_MODULE"), registry(40, PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION, "CLINICAL_MODULE"), registry(50, "GENERIC_EXERCISE", "1.0.0", "EXERCISE_INSTANCE", "Generic.xlsx")];
  const sheets: StagedModule["payload"]["sheets"] = {
    ExercisePackage: { columns: ["PackageID", "PackageVersion", "ContentHash", "PackageJSON"], rows: [{ PackageID: pkg.packageId, PackageVersion: pkg.packageVersion, ContentHash: pkg.packageHash, PackageJSON: JSON.stringify(pkg) }] },
    PackagePatientDataset: { columns: ["DatasetID", "DatasetVersion", "DatasetJSON"], rows: [{ DatasetID: dataset.datasetId, DatasetVersion: dataset.version, DatasetJSON: JSON.stringify(dataset) }] },
    PatientRuntimeFixtures: { columns: ["PatientID", "RuntimeFixtureJSON"], rows: records.map((value) => ({ PatientID: value.id, RuntimeFixtureJSON: JSON.stringify({ fixtureId: `FX-${value.id}`, fixtureType: "PROCESS", patientId: value.id, seed: 45, clockState: "RUNNING", ownershipVersion: 1, initialState: {}, activeResources: { resources: [] }, loadedModules: value.id === "GEN-A" ? [PELVIC_INJURY_MODULE_ID] : [PLEURAL_INJURY_MODULE_ID] }) })) },
    PatientProcessBindings: { columns: ["BindingID", "PatientID", "ProcessType", "ProviderModuleID", "ProviderVersion"], rows: records.map((value) => value.id === "GEN-A" ? { BindingID: "PB-A", PatientID: value.id, ProcessType: "HEMORRHAGE", ProviderModuleID: "CORE_ENGINE", ProviderVersion: "repo" } : { BindingID: "PB-B", PatientID: value.id, ProcessType: "PLEURAL_INJURY", ProviderModuleID: PLEURAL_INJURY_MODULE_ID, ProviderVersion: PLEURAL_INJURY_MODULE_VERSION }) },
    CanonicalActionBindings: { columns: ["ActionID", "DefinitionID", "ProviderModuleID", "ProviderVersion", "Scope", "PatientID", "ProcessType", "OwnerModuleID"], rows: records.map((value) => value.id === "GEN-A" ? { ActionID: "ACTION-A-IV", DefinitionID: "PERIPHERAL_IV_ACCESS", ProviderModuleID: "CORE_ENGINE", ProviderVersion: "repo", Scope: "PATIENT", PatientID: value.id, ProcessType: "", OwnerModuleID: "CORE_ENGINE" } : { ActionID: "ACTION-B-DRAIN", DefinitionID: "CHEST_DRAIN_INSERTION", ProviderModuleID: PLEURAL_INJURY_MODULE_ID, ProviderVersion: PLEURAL_INJURY_MODULE_VERSION, Scope: "PROCESS", PatientID: value.id, ProcessType: "PLEURAL_INJURY", OwnerModuleID: PLEURAL_INJURY_MODULE_ID }) },
    PackageLocations: { columns: ["LocationID", "Code", "Name"], rows: records.map((value, index) => ({ LocationID: `LOC-${index + 1}`, Code: `LOC-GEN-${index + 1}`, Name: value.location })) },
    RelationshipBindings: { columns: ["RelationshipID", "SourcePatientID", "TargetPatientID", "RelationshipType"], rows: [] },
    PatientRoster: { columns: ["PatientID", "SourceStatus"], rows: records.map((value) => ({ PatientID: value.id, SourceStatus: "READY" })) },
    PatientProcessAssignments: { columns: ["PatientProcessID", "PatientID", "ParentProcessID"], rows: records.map((value) => ({ PatientProcessID: `PP-${value.id}`, PatientID: value.id, ParentProcessID: "" })) },
  };
  const modules: StagedModule[] = registries.map((entry) => ({ registry: entry, contentHash: entry.moduleId.padEnd(64, "0").slice(0, 64), payload: { schemaVersion: 1, moduleId: entry.moduleId, moduleVersion: entry.moduleVersion, moduleType: entry.moduleType, sourceFile: entry.sourceFile, sheets: entry.moduleType === "EXERCISE_INSTANCE" ? sheets : {} } }));
  const manifest: ModuleImportManifest = { manifestId: "GENERIC-IMPORT", manifestVersion: "1.0", modules: registries, dependencies: [], sheetRules: Object.keys(sheets).map((sheetName) => ({ moduleId: "GENERIC_EXERCISE", sourceFile: "Generic.xlsx", sheetName, importClass: "EXERCISE_DATA", importAtRuntime: true, requiredSheet: true, onMissing: "ABORT_IMPORT" })), importUnits: [], deprecatedInputs: [], ownershipRules: [{ objectType: "ExercisePackage", objectOrField: packageId, canonicalOwner: "GENERIC_EXERCISE", contributionAllowedFrom: "NONE", aggregationOrWriteRule: "SINGLE_OWNER", conflictAction: "REJECT" }], bindings: registries.slice(0, -1).map((entry) => ({ exerciseId: "GENERIC-EXERCISE", exerciseModuleId: "GENERIC_EXERCISE", requiredModuleId: entry.moduleId, requiredVersion: entry.moduleVersion, bindingType: "RUNTIME" as const })) };
  return { modules, manifest, exercise: modules.at(-1)!, pkg, dataset };
}

const codes = (value: ReturnType<typeof genericPackage>) => validateStagedPackage(value.modules, value.manifest).map((issue) => issue.code);

describe("WP-45A generic exercise package import", () => {
  test.each([1, 2])("accepts a generic %i-patient package without Botulism invariants", (count) => expect(codes(genericPackage(count))).toEqual([]));
  test("rejects duplicate patients", () => { const value = genericPackage(); value.exercise.payload.sheets.PatientRoster.rows[1].PatientID = "GEN-A"; expect(codes(value)).toContain("DUPLICATE_PATIENT"); });
  test("rejects an unknown fixture process", () => { const value = genericPackage(); value.exercise.payload.sheets.PatientProcessBindings.rows[0].ProcessType = "UNKNOWN_PROCESS"; expect(codes(value)).toContain("GENERIC_PACKAGE_CONTRACT"); });
  test("rejects an unknown canonical action", () => { const value = genericPackage(); value.exercise.payload.sheets.CanonicalActionBindings.rows[0].DefinitionID = "UNKNOWN_ACTION"; expect(codes(value)).toContain("GENERIC_PACKAGE_CONTRACT"); });
  test("parses separate package, dataset, fixture and binding artifacts", () => { const value = genericPackage(); const artifacts = parseImportedExercisePackageArtifacts(value.modules, value.exercise); expect(artifacts.patientDataset.patients).toHaveLength(2); expect(artifacts.patientDataset.patients.every((record) => record.runtimeFixture)).toBe(true); expect(artifacts.processBindings.map((item) => item.processType)).toEqual(["HEMORRHAGE", "PLEURAL_INJURY"]); });
  test("materializes exactly the imported patients and fixtures", () => { const value = genericPackage(); const artifacts = parseImportedExercisePackageArtifacts(value.modules, value.exercise); const datasets = new PackagePatientDatasetRegistry(); datasets.register(artifacts.patientDataset); const plan = createPatientMaterializationPlan("EX-GENERIC", artifacts.exercisePackage, datasets); expect(plan.patients.map((record) => record.patient.id)).toEqual(["GEN-A", "GEN-B"]); expect(plan.patients.map((record) => record.runtimeFixture?.patientId)).toEqual(["GEN-A", "GEN-B"]); });
  test("registers and discovers an imported package generically", () => { const value = genericPackage(); const artifacts = parseImportedExercisePackageArtifacts(value.modules, value.exercise); const registry = new ImportedExercisePackageRegistry(); const published = registry.register(artifacts); expect(registry.get(published.exercisePackage.packageId, published.exercisePackage.packageVersion)?.patientDataset.patients).toHaveLength(2); });
  test("package and dataset registries accept identical re-registration and reject changed content", () => { const value = genericPackage(); const artifacts = parseImportedExercisePackageArtifacts(value.modules, value.exercise); const datasets = new PackagePatientDatasetRegistry(); datasets.register(artifacts.patientDataset); expect(() => datasets.register(structuredClone(artifacts.patientDataset))).not.toThrow(); const changed = structuredClone(artifacts.patientDataset) as unknown as { datasetId: string; version: string; patients: { patient: { name: string } }[] }; changed.patients[0].patient.name = "Changed"; expect(() => datasets.register(changed as unknown as PackagePatientDataset)).toThrow("version content conflict"); const packages = new ExercisePackageRegistry(new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG)); packages.register(artifacts.exercisePackage); expect(() => packages.register(structuredClone(artifacts.exercisePackage))).not.toThrow(); const changedPackage = createExercisePackage({ ...artifacts.exercisePackage, metadata: { ...artifacts.exercisePackage.metadata, description: "Changed" } }); expect(() => packages.register(changedPackage)).toThrow("EXERCISE_PACKAGE_VERSION_CONFLICT"); const registry = new ImportedExercisePackageRegistry(); expect(registry.get("missing", "1.0.0")).toBeUndefined(); });
});
