import type { MedicationAdministration, MedicationDefinition } from "@/models/MedicationRuntime";
import type { CirculationState } from "@/models/CirculationState";
import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION } from "@/modules/airway/AirwayManifest";
import { medicationCoreClinicalModule } from "@/modules/medicationCore/MedicationCoreClinicalModule";
import { MEDICATION_CORE_MODULE_ID, MEDICATION_CORE_MODULE_VERSION } from "@/modules/medicationCore/MedicationCoreManifest";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { getAnalyticsReport } from "@/services/AnalyticsService";
import { ALS_EXERCISE_PACKAGE, CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { hashExerciseDefinition } from "@/services/exercise/ExerciseDefinitionRegistry";
import { clinicalModuleRegistry, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { circulationInterventionDefinitions } from "@/services/runtime/clinical/CirculationInterventionDefinitions";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { alsClinicalModule } from "../AlsClinicalModule";
import { ALS_CAPABILITY_STATUS, ALS_CARDIAC_ARREST_RHYTHM_AUDIT } from "../AlsCapabilityStatus";
import { ALS_MODULE_ID, ALS_MODULE_VERSION, alsManifest } from "../AlsManifest";
import { cardiacArrestClinicalModule } from "@/modules/cardiacArrest/CardiacArrestClinicalModule";
import { CARDIAC_ARREST_MODULE_ID, CARDIAC_ARREST_MODULE_VERSION } from "@/modules/cardiacArrest/CardiacArrestManifest";

const registry = (order: "FORWARD" | "REVERSE" = "FORWARD") => {
  const result = new ClinicalModuleRegistry();
  const modules = [airwayClinicalModule, cardiacArrestClinicalModule, medicationCoreClinicalModule, alsClinicalModule];
  (order === "FORWARD" ? modules : [...modules].reverse()).forEach(module => result.register(module));
  return result;
};

const compose = (order: "FORWARD" | "REVERSE" = "FORWARD") => new ClinicalModuleComposer(registry(order)).compose(
  ALS_EXERCISE_PACKAGE.definition,
  ALS_EXERCISE_PACKAGE.requiredClinicalModules!,
);

describe("WP-35 ALS_V1 Clinical Module", () => {
  test("publishes an immutable manifest with exact Airway, Cardiac Arrest and Medication Core dependencies", () => {
    expect(alsManifest).toEqual({
      moduleId: ALS_MODULE_ID,
      version: ALS_MODULE_VERSION,
      description: expect.any(String),
      dependencies: [
        { moduleId: AIRWAY_MODULE_ID, version: AIRWAY_MODULE_VERSION },
        { moduleId: CARDIAC_ARREST_MODULE_ID, version: CARDIAC_ARREST_MODULE_VERSION },
        { moduleId: MEDICATION_CORE_MODULE_ID, version: MEDICATION_CORE_MODULE_VERSION },
      ],
      compatibilityVersion: 1,
    });
    expect(Object.isFrozen(alsManifest)).toBe(true);
    expect(Object.isFrozen(alsManifest.dependencies)).toBe(true);
    expect(Object.isFrozen(alsClinicalModule)).toBe(true);
    expect(alsClinicalModule.moduleHash).toHaveLength(64);
  });

  test("owns no dependency registrations and exposes an evidence-based capability audit", () => {
    Object.values(alsClinicalModule.registrations).forEach(value => expect(value).toEqual([]));
    expect(ALS_CARDIAC_ARREST_RHYTHM_AUDIT).toEqual([
      expect.objectContaining({ capabilityId: "CARDIAC_ARREST", classification: "EXISTING_CANONICAL" }),
      expect.objectContaining({ capabilityId: "CPR", classification: "EXISTING_CANONICAL" }),
      expect.objectContaining({ capabilityId: "DEFIBRILLATION", classification: "EXISTING_CANONICAL" }),
      expect.objectContaining({ capabilityId: "RHYTHM_STATE", classification: "EXISTING_CANONICAL" }),
      expect.objectContaining({ capabilityId: "ROSC", classification: "EXISTING_CANONICAL" }),
    ]);
    expect(ALS_CAPABILITY_STATUS.filter(item => item.status === "UNAVAILABLE")).toEqual([]);
    expect(ALS_CAPABILITY_STATUS.find(item => item.capabilityId === "VASCULAR_ACCESS")).toMatchObject({ status: "AVAILABLE", sourceModuleId: "CORE_RUNTIME" });
    expect(circulationInterventionDefinitions.map(item => item.definitionId)).toEqual(expect.arrayContaining(["PERIPHERAL_IV_ACCESS", "INTRAOSSEOUS_ACCESS"]));
  });

  test("resolves transitively in stable order independent of registration order", () => {
    const first = compose("FORWARD"); const second = compose("REVERSE");
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.composition.modules.map(item => `${item.moduleId}@${item.version}`)).toEqual([
      `${AIRWAY_MODULE_ID}@${AIRWAY_MODULE_VERSION}`,
      `${CARDIAC_ARREST_MODULE_ID}@${CARDIAC_ARREST_MODULE_VERSION}`,
      `${MEDICATION_CORE_MODULE_ID}@${MEDICATION_CORE_MODULE_VERSION}`,
      `${ALS_MODULE_ID}@${ALS_MODULE_VERSION}`,
    ]);
    expect(first.composition.registrations.interventions).toEqual([
      ...airwayClinicalModule.registrations.interventions, "DEFIBRILLATION", "START_CPR", "STOP_CPR",
    ].sort());
    expect(first.composition.registrations.patientProcesses).toEqual(["CARDIAC_ARREST", "MEDICATION"]);
  });

  test("fails closed for missing and wrong dependency versions", () => {
    const missingAirway = new ClinicalModuleRegistry(); missingAirway.register(cardiacArrestClinicalModule); missingAirway.register(medicationCoreClinicalModule); missingAirway.register(alsClinicalModule);
    const missingMedication = new ClinicalModuleRegistry(); missingMedication.register(airwayClinicalModule); missingMedication.register(cardiacArrestClinicalModule); missingMedication.register(alsClinicalModule);
    const missingCardiac = new ClinicalModuleRegistry(); missingCardiac.register(airwayClinicalModule); missingCardiac.register(medicationCoreClinicalModule); missingCardiac.register(alsClinicalModule);
    for (const candidate of [missingAirway, missingMedication, missingCardiac]) {
      const result = new ClinicalModuleComposer(candidate).compose(ALS_EXERCISE_PACKAGE.definition, ALS_EXERCISE_PACKAGE.requiredClinicalModules!);
      expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "MISSING_DEPENDENCY" })] });
    }
    const wrong = new ClinicalModuleComposer(clinicalModuleRegistry).compose(ALS_EXERCISE_PACKAGE.definition, [{ moduleId: ALS_MODULE_ID, version: "2.0.0" }]);
    expect(wrong).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "VERSION_MISMATCH" })] });
  });

  test("publishes one reduced-capability reference Package with canonical provenance", () => {
    expect(clinicalModuleRegistry.require(ALS_MODULE_ID, ALS_MODULE_VERSION)).toEqual(alsClinicalModule);
    const published = exercisePackageRegistry.require(ALS_EXERCISE_PACKAGE.packageId, ALS_EXERCISE_PACKAGE.packageVersion);
    expect(published.requiredClinicalModules).toEqual([{ moduleId: ALS_MODULE_ID, version: ALS_MODULE_VERSION }]);
    expect(published.definition.clinicalModuleComposition?.modules.map(item => item.moduleId)).toEqual([
      AIRWAY_MODULE_ID, CARDIAC_ARREST_MODULE_ID, MEDICATION_CORE_MODULE_ID, ALS_MODULE_ID,
    ]);
    expect(published.definition.enabledPatientProcesses).toEqual([
      ...DEFAULT_EXERCISE_PACKAGE.definition.enabledPatientProcesses, "CARDIAC_ARREST",
    ].sort());
    expect(published.definition.enabledAnalyticsProviders).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledAnalyticsProviders);
    expect(published.manifest.definitionHash).toBe(hashExerciseDefinition(published.definition));
    expect(published.metadata.tags).toContain("canonical");
    expect({ moduleHash: alsClinicalModule.moduleHash, definitionHash: published.manifest.definitionHash,
      packageHash: published.packageHash }).toEqual({
      moduleHash: "dc64806aec39f25307549a09e9e2dcb4fdbbb04b4ef942fba97448b0976365b2",
      definitionHash: "de253926a8b4f823140826f4915c367eb142c27a07482c40c0ce8504347078d7",
      packageHash: "793a638154cfcf42d92d8910f2fe9e8f71d91c3ed059f4ce6279cd25a7dc7f2f",
    });
  });

  test("preserves Airway and Medication behaviour and deterministic replay content", () => {
    const definition: MedicationDefinition = {
      medicationId: "ALS-CONFIGURED", name: "Configured medication", routes: ["IV"], category: "other", durationSec: 60,
      supportedEffects: [{ effectType: "SUPPORT_CIRCULATION", parameters: { strength: 1 } }], metadata: {},
    };
    const circulation: CirculationState = { patientId: "PT-ALS", vascularAccess: [{ interventionInstanceId: "IV-1", type: "PERIPHERAL_IV", resourceIds: ["IV"], establishedAt: 0 }], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 };
    const administration: MedicationAdministration = { administrationId: "A-1", medicationId: definition.medicationId, patientId: circulation.patientId, route: "IV", dose: 1, unit: "configured-unit", timestamp: 10, administrator: "CM-1", vascularAccessId: "IV-1" };
    const replay = () => {
      const composition = compose(); if (!composition.ok) throw new Error("ALS composition failed");
      const medication = new MedicationEngine(); medication.installDefinitions([definition]);
      const medicationResult = medication.administer(administration, circulation);
      const content = { composition: composition.composition, airwayDefinitions: airwayInterventionDefinitions, medicationResult, medicationState: medication.snapshot() };
      return { content, replayHash: sha256Text(stableJson(content)) };
    };
    const first = replay(); const second = replay();
    expect(first).toEqual(second); expect(first.replayHash).toBe(second.replayHash);
    expect(first.content.medicationResult.events.map(event => event.eventType)).toEqual(["MedicationOrdered", "MedicationStarted"]);
  });

  test("keeps historical hashes and Analytics unchanged within the composition budget", () => {
    const analytics = getAnalyticsReport(); const started = Date.now();
    for (let index = 0; index < 100; index += 1) expect(compose(index % 2 ? "FORWARD" : "REVERSE").ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(getAnalyticsReport()).toEqual(analytics);
    expect(CANONICAL_EXERCISE_PACKAGES.every(pkg => !pkg.requiredClinicalModules)).toBe(true);
    expect(DEFAULT_EXERCISE_PACKAGE).toMatchObject({
      packageHash: "a32f63f6730596a8491279213bd4ac0c7806efe96b157992beeb3183edb266ae",
      manifest: { definitionHash: "b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b" },
    });
  });
});
