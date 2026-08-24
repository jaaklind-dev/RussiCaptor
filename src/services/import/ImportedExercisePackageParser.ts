import type { ImportCellValue, ModuleImportIssue, StagedModule } from "@/models/ModuleImport";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { GoldenFixture } from "@/models/GoldenTest";
import type { PackagePatientDataset, PackagePatientRecord } from "@/models/exercise/PackagePatientDataset";
import type { ImportedActionBinding, ImportedExercisePackageArtifacts, ImportedLocationBinding, ImportedPatientProcessBinding, ImportedRelationshipBinding } from "@/models/import/ImportedExercisePackage";
import { ExercisePackageValidator } from "@/services/exercise/ExercisePackageValidator";
import { EXERCISE_DEFINITION_CATALOG } from "@/services/exercise/ExerciseDefinitionService";
import { canonicalImportBindingCatalog } from "./CanonicalImportBindingCatalog";

const requiredGenericSheets = ["ExercisePackage", "PackagePatientDataset", "PatientRuntimeFixtures", "PatientProcessBindings", "CanonicalActionBindings", "PackageLocations"] as const;
const text = (value: ImportCellValue | undefined) => value === null || value === undefined ? "" : String(value).trim();
const fatal = (code: string, message: string): ModuleImportIssue => ({ severity: "FATAL", code, message });
const rows = (exercise: StagedModule, sheet: string) => exercise.payload.sheets[sheet]?.rows ?? [];

function json<T>(value: ImportCellValue | undefined, label: string): T {
  try { return JSON.parse(text(value)) as T; } catch { throw new Error(`${label} JSON pole loetav.`); }
}

export function hasGenericPackageContract(exercise: StagedModule): boolean {
  return Boolean(exercise.payload.sheets.ExercisePackage);
}

export function validateGenericPackageContract(modules: readonly StagedModule[], exercise: StagedModule): ModuleImportIssue[] {
  if (!hasGenericPackageContract(exercise)) return [];
  const issues: ModuleImportIssue[] = [];
  for (const sheet of requiredGenericSheets) if (!exercise.payload.sheets[sheet]) issues.push(fatal("GENERIC_PACKAGE_SHEET", `Generic package sheet ${sheet} puudub.`));
  if (issues.length) return issues;
  try {
    parseImportedExercisePackageArtifacts(modules, exercise);
  } catch (error) {
    issues.push(fatal("GENERIC_PACKAGE_CONTRACT", error instanceof Error ? error.message : String(error)));
  }
  return issues;
}

export function parseImportedExercisePackageArtifacts(modules: readonly StagedModule[], exercise: StagedModule): ImportedExercisePackageArtifacts {
  const packageRows = rows(exercise, "ExercisePackage");
  if (packageRows.length !== 1) throw new Error("ExercisePackage peab sisaldama täpselt ühe paketi rida.");
  const packageRow = packageRows[0];
  const exercisePackage = json<ExercisePackage>(packageRow.PackageJSON, "ExercisePackage.PackageJSON");
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(exercisePackage.packageId)) throw new Error("ExercisePackage PackageID formaat on vigane.");
  if (text(packageRow.PackageID) !== exercisePackage.packageId || text(packageRow.PackageVersion) !== exercisePackage.packageVersion || text(packageRow.ContentHash) !== exercisePackage.packageHash) {
    throw new Error("ExercisePackage identity/contentHash ei vasta kanoonilisele paketile.");
  }
  new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG).assertValid(exercisePackage);

  const datasetRows = rows(exercise, "PackagePatientDataset");
  if (datasetRows.length !== 1) throw new Error("PackagePatientDataset peab sisaldama täpselt ühe andmestiku rida.");
  const datasetRow = datasetRows[0];
  const sourceDataset = json<PackagePatientDataset>(datasetRow.DatasetJSON, "PackagePatientDataset.DatasetJSON");
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.v[0-9A-Za-z.-]+$/.test(sourceDataset.datasetId)) throw new Error("PackagePatientDataset DatasetID formaat on vigane.");
  if (text(datasetRow.DatasetID) !== sourceDataset.datasetId || text(datasetRow.DatasetVersion) !== sourceDataset.version || exercisePackage.patientDatasetId !== sourceDataset.datasetId) {
    throw new Error("PackagePatientDataset identity ei vasta paketi dataset bindingule.");
  }
  const patientIds = sourceDataset.patients.map((record) => record.patient.id);
  if (!patientIds.length || new Set(patientIds).size !== patientIds.length) throw new Error("Patient dataset on tühi või sisaldab korduvat PatientID väärtust.");

  const fixtureByPatient = new Map<string, GoldenFixture>();
  for (const row of rows(exercise, "PatientRuntimeFixtures")) {
    const patientId = text(row.PatientID); const fixture = json<GoldenFixture>(row.RuntimeFixtureJSON, `RuntimeFixture ${patientId}`);
    if (!patientIds.includes(patientId) || fixture.patientId !== patientId || fixtureByPatient.has(patientId)) throw new Error(`PatientRuntimeFixture ${patientId} viide või identiteet on vigane.`);
    fixtureByPatient.set(patientId, fixture);
  }
  const patientDataset: PackagePatientDataset = Object.freeze({ ...structuredClone(sourceDataset), patients: Object.freeze(sourceDataset.patients.map((record): PackagePatientRecord => Object.freeze({ ...record, patient: record.patient, ...(fixtureByPatient.has(record.patient.id) ? { runtimeFixture: fixtureByPatient.get(record.patient.id)! } : {}) }))) });

  const boundModules = new Set(modules.map((module) => `${module.registry.moduleId}@${module.registry.moduleVersion}`));
  const processBindings: ImportedPatientProcessBinding[] = rows(exercise, "PatientProcessBindings").map((row) => ({ bindingId: text(row.BindingID), patientId: text(row.PatientID), processType: text(row.ProcessType), providerModuleId: text(row.ProviderModuleID), providerVersion: text(row.ProviderVersion) }));
  const processIds = new Set<string>();
  for (const binding of processBindings) {
    if (!binding.bindingId || processIds.has(binding.bindingId)) throw new Error(`PatientProcessBinding ${binding.bindingId || "UNKNOWN"} on korduv või tühi.`); processIds.add(binding.bindingId);
    if (!patientIds.includes(binding.patientId)) throw new Error(`PatientProcessBinding ${binding.bindingId} viitab tundmatule patsiendile.`);
    const provider = canonicalImportBindingCatalog.modules.get(`${binding.providerModuleId}@${binding.providerVersion}`);
    const repositoryProcess = binding.providerModuleId === "CORE_ENGINE" && binding.providerVersion === "repo" && exercisePackage.enabledPatientProcesses.includes(binding.processType);
    if (!boundModules.has(`${binding.providerModuleId}@${binding.providerVersion}`) || (!repositoryProcess && (!provider || !provider.registrations.patientProcesses.includes(binding.processType)))) {
      throw new Error(`PatientProcessBinding ${binding.bindingId} process/provider ei lahendu.`);
    }
  }

  const actionBindings: ImportedActionBinding[] = rows(exercise, "CanonicalActionBindings").map((row) => ({ actionId: text(row.ActionID), definitionId: text(row.DefinitionID), providerModuleId: text(row.ProviderModuleID), providerVersion: text(row.ProviderVersion), scope: text(row.Scope) as ImportedActionBinding["scope"], ...(text(row.PatientID) ? { patientId: text(row.PatientID) } : {}), ...(text(row.ProcessType) ? { processType: text(row.ProcessType) } : {}), ownerModuleId: text(row.OwnerModuleID) }));
  const actionIds = new Set<string>();
  for (const binding of actionBindings) {
    if (!binding.actionId || actionIds.has(binding.actionId)) throw new Error(`ActionBinding ${binding.actionId || "UNKNOWN"} on korduv või tühi.`); actionIds.add(binding.actionId);
    if (!boundModules.has(`${binding.providerModuleId}@${binding.providerVersion}`)) throw new Error(`ActionBinding ${binding.actionId} provider ei ole paketiga seotud.`);
    const provider = canonicalImportBindingCatalog.modules.get(`${binding.providerModuleId}@${binding.providerVersion}`);
    const registered = provider?.registrations.interventions.includes(binding.definitionId) ||
      (binding.providerModuleId === "CORE_ENGINE" && binding.providerVersion === "repo" && canonicalImportBindingCatalog.actionDefinitions.has(binding.definitionId));
    if (!registered) throw new Error(`ActionBinding ${binding.actionId} definition ${binding.definitionId} ei lahendu.`);
    if (!["EXERCISE", "PATIENT", "PROCESS"].includes(binding.scope) || (binding.patientId && !patientIds.includes(binding.patientId)) || (binding.processType && !processBindings.some((item) => item.processType === binding.processType))) throw new Error(`ActionBinding ${binding.actionId} scope viide on vigane.`);
    if (binding.ownerModuleId !== binding.providerModuleId) throw new Error(`ActionBinding ${binding.actionId} ownership on vastuoluline.`);
  }

  for (const [patientId, fixture] of fixtureByPatient) {
    const initialState = fixture.initialState && typeof fixture.initialState === "object" && !Array.isArray(fixture.initialState)
      ? fixture.initialState as Record<string, unknown>
      : {};
    const pleural = initialState.pleuralInjury && typeof initialState.pleuralInjury === "object" && !Array.isArray(initialState.pleuralInjury)
      ? initialState.pleuralInjury as Record<string, unknown>
      : undefined;
    const configuration = pleural?.configuration && typeof pleural.configuration === "object" && !Array.isArray(pleural.configuration)
      ? pleural.configuration as Record<string, unknown>
      : undefined;
    if (!configuration || (configuration.initialDrainageVolumeMl === undefined && configuration.ongoingDrainOutputRateMlMin === undefined)) continue;
    for (const field of ["initialDrainageVolumeMl", "ongoingDrainOutputRateMlMin"] as const) {
      const value = configuration[field];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`Pleural configuration ${patientId}/${field} peab olema mittenegatiivne lõplik arv.`);
    }
    if (!processBindings.some((binding) => binding.patientId === patientId && binding.processType === "PLEURAL_INJURY") ||
      !processBindings.some((binding) => binding.patientId === patientId && binding.processType === "HEMORRHAGE") ||
      !actionBindings.some((binding) => binding.patientId === patientId && binding.definitionId === "CHEST_DRAIN_INSERTION")) {
      throw new Error(`Pleural configuration ${patientId} process/action bindingud ei lahendu.`);
    }
  }

  const locations: ImportedLocationBinding[] = rows(exercise, "PackageLocations").map((row) => ({ locationId: text(row.LocationID), code: text(row.Code), name: text(row.Name) }));
  if (new Set(locations.map((item) => item.locationId)).size !== locations.length || locations.some((item) => !item.locationId || !item.code || !item.name)) throw new Error("PackageLocations sisaldab korduvat või puudulikku asukohta.");
  const locationNames = new Set(locations.map((item) => item.name));
  const locationIds = new Set(locations.map((item) => item.locationId));
  if (sourceDataset.patients.some((record) => !record.initialLocationId || !locationIds.has(record.initialLocationId) || !locationNames.has(record.patient.location))) throw new Error("Patsiendi initial location ID/nimi ei lahendu PackageLocations lehel.");
  const transport = exercisePackage.transportConfiguration;
  if (transport && (!locationIds.has(transport.vehicleLocationId) || transport.resources.some((resource) => !locationIds.has(resource.homeLocationId)) || transport.destinations.some((destination) => !locationIds.has(destination.destinationId)))) {
    throw new Error("Transport configuration location binding ei lahendu PackageLocations lehel.");
  }

  const relationships: ImportedRelationshipBinding[] = rows(exercise, "RelationshipBindings").map((row) => ({ relationshipId: text(row.RelationshipID), sourcePatientId: text(row.SourcePatientID), targetPatientId: text(row.TargetPatientID), relationshipType: text(row.RelationshipType) }));
  if (new Set(relationships.map((item) => item.relationshipId)).size !== relationships.length || relationships.some((item) => !item.relationshipId || !patientIds.includes(item.sourcePatientId) || !patientIds.includes(item.targetPatientId) || !item.relationshipType)) throw new Error("RelationshipBindings sisaldab korduvat või lahendamata viidet.");
  return Object.freeze({ exercisePackage, patientDataset, processBindings: Object.freeze(processBindings), actionBindings: Object.freeze(actionBindings), locations: Object.freeze(locations), relationships: Object.freeze(relationships) });
}
