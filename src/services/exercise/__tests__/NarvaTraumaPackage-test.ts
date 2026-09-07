import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { activateMassiveTransfusion, bootstrapMassiveTransfusionPatientProcess,
  reconcileMtpVascularAccess, startBloodProductAdministration,
  tickMassiveTransfusionPatientProcess } from "@/services/runtime/MassiveTransfusionPatientProcess";
import { canonicalRuntimePersistenceService, moduleCompositionHash } from
  "@/services/runtime/persistence/CanonicalRuntimePersistenceService";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { NARVA_TRAUMA_EXERCISE_PACKAGE, NARVA_TRAUMA_TREATMENT_PALETTE } from "../NarvaExercisePackages";
import { NARVA_CHEST_BLEEDING_RATE_ML_MIN, NARVA_CHEST_INJURY_TIME_SEC,
  NARVA_PELVIC_INJURY_TIME_SEC, NARVA_TRAUMA_MTP_CONFIGURATION } from "../NarvaPatientDatasets";
import { createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { exercisePackageRegistry, exercisePackageValidator } from "../ExercisePackageService";

const dataset = () => packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1");
const fixture = (patientId: string) => dataset().patients.find(item => item.patient.id === patientId)!.runtimeFixture!;
const initial = (patientId: string) => fixture(patientId).initialState as Record<string, any>;

describe("WP-NARVA-01 trauma package", () => {
  test("registers a valid immutable versioned package", () => {
    expect(exercisePackageValidator.validate(NARVA_TRAUMA_EXERCISE_PACKAGE)).toEqual([]);
    expect(exercisePackageRegistry.require("russicaptor.narva-trauma", "1.0.1"))
      .toMatchObject({ packageId: "russicaptor.narva-trauma", packageVersion: "1.0.1",
        patientDatasetId: "patients.narva-trauma.v1" });
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE.packageHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("materializes exactly the two canonical P1 trauma patients", () => {
    const plan = createPatientMaterializationPlan("EX-NARVA-TRAUMA", NARVA_TRAUMA_EXERCISE_PACKAGE,
      packagePatientDatasetRegistry);
    expect(plan.patients.map(item => item.patient.id)).toEqual(["PT-CHEST-001", "PT-PELVIC-001"]);
    expect(plan.patients.every(item => item.patient.triage === "P1")).toBe(true);
  });

  test("persists authoritative simulation-relative injury times", () => {
    expect(initial("PT-PELVIC-001")).toMatchObject({ injuryTimeSec: NARVA_PELVIC_INJURY_TIME_SEC,
      injuryTimeAuthority: "EXERCISE_SIMULATION_TIME" });
    expect(initial("PT-CHEST-001")).toMatchObject({ injuryTimeSec: NARVA_CHEST_INJURY_TIME_SEC,
      injuryTimeAuthority: "EXERCISE_SIMULATION_TIME" });
    expect(NARVA_PELVIC_INJURY_TIME_SEC).toBe(-300); expect(NARVA_CHEST_INJURY_TIME_SEC).toBe(-1800);
  });

  test("configures the approved pelvic baseline and 140 to 56 ml-min binder response", () => {
    const value = initial("PT-PELVIC-001");
    expect(value.baselineVitals).toEqual({ hr: 118, sbp: 110, dbp: 70, rr: 24, spo2: 97, gcs: 15 });
    const config = value.hemorrhageSources[0].configuration;
    expect(config).toMatchObject({ baselineBleedingRateMlMin: 140, binderEfficiency: 0.6 });
    expect(config.baselineBleedingRateMlMin * (1 - config.binderEfficiency)).toBeCloseTo(56, 8);
  });

  test("configures the approved chest baseline, initial drainage and persistent 200 ml-h bleeding", () => {
    const value = initial("PT-CHEST-001");
    expect(value.baselineVitals).toEqual({ hr: 125, sbp: 103, dbp: 65, rr: 34, spo2: 85, gcs: 15 });
    expect(value.pleuralInjury.configuration).toMatchObject({ initialBloodBurdenMl: 1450,
      initialDrainageVolumeMl: 1450, ongoingDrainOutputRateMlMin: NARVA_CHEST_BLEEDING_RATE_ML_MIN });
    expect(value.hemorrhageSources[0].configuration).toMatchObject({
      baselineBleedingRateMlMin: NARVA_CHEST_BLEEDING_RATE_ML_MIN,
      bleedingRateAfterPleuralDrainageMlMin: NARVA_CHEST_BLEEDING_RATE_ML_MIN });
    expect(NARVA_CHEST_BLEEDING_RATE_ML_MIN * 60).toBeCloseTo(200, 8);
  });

  test("exposes the approved real treatment palette without aliases or duplicates", () => {
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE.availableClinicalTreatments)
      .toEqual([...NARVA_TRAUMA_TREATMENT_PALETTE].sort());
    expect(new Set(NARVA_TRAUMA_TREATMENT_PALETTE).size).toBe(NARVA_TRAUMA_TREATMENT_PALETTE.length);
    expect(NARVA_TRAUMA_TREATMENT_PALETTE).toEqual(expect.arrayContaining([
      "RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN", "TRANEXAMIC_ACID", "FENTANYL",
      "REMIFENTANIL", "DEXKETOPROFEN", "NOREPINEPHRINE", "MECHANICAL_VENTILATION",
      "ADRENALINE", "AMIODARONE", "SODIUM_BICARBONATE",
    ]));
  });

  test("uses sufficient supported blood products, zero platelets and canonical calcium", () => {
    expect(NARVA_TRAUMA_MTP_CONFIGURATION.initialInventory).toEqual({ RBC: { mode: "UNLIMITED" },
      PLASMA: { mode: "UNLIMITED" }, PLATELETS: 0 });
    expect(NARVA_TRAUMA_MTP_CONFIGURATION.calciumReplacement).toMatchObject({ calciumEnabled: true,
      rbcUnitsPerCalcium: 3, calciumProduct: "Kaltsiumkloriid", calciumDose: "1 g", calciumRoute: "IV" });
  });

  test("provides the supported two-patient resource set with finalized inventory assumptions", () => {
    for (const patientId of ["PT-PELVIC-001", "PT-CHEST-001"]) {
      const resources = (fixture(patientId).activeResources as any).resources;
      expect(resources.map((item: any) => item.type)).toEqual(expect.arrayContaining([
        "pelvicBinder", "peripheralIV", "centralVenousCatheter", "intraosseousAccess", "infusionPump",
        "endotrachealTube", "directLaryngoscope", "videoLaryngoscope", "ventilator", "chestDrain",
      ]));
      expect(initial(patientId).configurationAssumptions).toBeUndefined();
    }
  });

  test("configures exactly one reanimobile and the 30/120-minute selectable destinations", () => {
    const transport = NARVA_TRAUMA_EXERCISE_PACKAGE.transportConfiguration!;
    expect(transport.resources).toHaveLength(1);
    expect(transport.resources[0]).toMatchObject({ resourceId: "NARVA-REANIMOBILE-01", capacity: 1,
      homeLocationId: "NARVA_ED" });
    expect(transport.destinations).toEqual([
      expect.objectContaining({ destinationId: "IVKH", travelDurationSec: 1800, handoverDurationSec: 600 }),
      expect.objectContaining({ destinationId: "PERH", travelDurationSec: 7200, handoverDurationSec: 600 }),
    ]);
  });

  test("does not encode a forced transport order", () => {
    const transport = NARVA_TRAUMA_EXERCISE_PACKAGE.transportConfiguration!;
    expect(transport.destinations.every(destination => !(destination as any).requiredPatientId &&
      !(destination as any).sequence)).toBe(true);
  });

  test("bootstraps both accepted canonical injury processes with baseline vitals", () => {
    const pelvic = new ClinicalScenarioEngine(); pelvic.reset(structuredClone(fixture("PT-PELVIC-001")));
    const chest = new ClinicalScenarioEngine(); chest.reset(structuredClone(fixture("PT-CHEST-001")));
    expect(pelvic.getRuntimeState().targetVitals).toMatchObject({ hr: 118, sbp: 110, dbp: 70, rr: 24, spo2: 97 });
    expect(pelvic.getPatientProcesses().map(item => item.processType)).toEqual(expect.arrayContaining(["HEMORRHAGE", "MASSIVE_TRANSFUSION"]));
    expect(chest.getRuntimeState().targetVitals).toMatchObject({ hr: 125, sbp: 103, dbp: 65, rr: 34, spo2: 85 });
    expect(chest.getPatientProcesses().map(item => item.processType)).toEqual(expect.arrayContaining(["PLEURAL_INJURY", "RESPIRATORY_FAILURE", "HYPOXIA", "HEMORRHAGE"]));
  });

  test.each(["PT-PELVIC-001", "PT-CHEST-001"])("round-trips %s deterministically", patientId => {
    const source = new ClinicalScenarioEngine(); source.reset(structuredClone(fixture(patientId)));
    const identity = { exerciseId: "EX-NARVA-TRAUMA", patientId,
      packageId: NARVA_TRAUMA_EXERCISE_PACKAGE.packageId, packageVersion: "1.0.1",
      packageHash: NARVA_TRAUMA_EXERCISE_PACKAGE.packageHash,
      definitionHash: NARVA_TRAUMA_EXERCISE_PACKAGE.manifest.definitionHash,
      moduleCompositionHash: moduleCompositionHash(NARVA_TRAUMA_EXERCISE_PACKAGE.definition.clinicalModuleComposition?.modules ?? []) };
    const artifact = canonicalRuntimePersistenceService.capture(source, identity);
    const restored = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(restored, artifact, identity);
    expect(restored.getRuntimeState()).toEqual(source.getRuntimeState());
    expect(restored.getPatientProcesses()).toEqual(source.getPatientProcesses());
  });

  test("keeps Narva RBC and plasma non-constraining while platelets remain unavailable", () => {
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-PELVIC-001", {
      configuration: NARVA_TRAUMA_MTP_CONFIGURATION }), "ACT");
    process = reconcileMtpVascularAccess(process, [{ interventionInstanceId: "PIV-1", type: "PERIPHERAL_IV",
      resourceIds: ["PIV"], establishedAt: 0 }]);
    expect(process.clinicalState.administrations).toEqual([]);
    for (const product of ["RBC", "PLASMA"] as const) {
      for (let index = 0; index < 8; index += 1) {
        process = startBloodProductAdministration(process, `${product}-${index}`, product, 1);
        process = tickMassiveTransfusionPatientProcess(process, 720);
      }
    }
    expect(process.clinicalState.inventory).toEqual({ RBC: { mode: "UNLIMITED" },
      PLASMA: { mode: "UNLIMITED" }, PLATELETS: 0 });
    expect(process.clinicalState.administeredUnits).toMatchObject({ RBC: 8, PLASMA: 8, PLATELETS: 0 });
    expect(() => startBloodProductAdministration(process, "PLATELETS", "PLATELETS", 1))
      .toThrow("BLOOD_PRODUCT_UNAVAILABLE");
    expect(NARVA_TRAUMA_TREATMENT_PALETTE).toContain("FIBRINOGEN_CONCENTRATE");
    expect(NARVA_TRAUMA_MTP_CONFIGURATION.calciumReplacement?.calciumEnabled).toBe(true);
  });
});
