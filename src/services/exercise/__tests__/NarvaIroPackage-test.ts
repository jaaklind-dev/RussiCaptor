import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { NARVA_IRO_EXERCISE_PACKAGE } from "../NarvaExercisePackages";
import { NARVA_IRO_REQUIRED_CAPABILITY_GAPS } from "../NarvaPatientDatasets";
import { createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { exercisePackageRegistry, exercisePackageValidator } from "../ExercisePackageService";

describe("WP-NARVA-01 IRO package supported subset and capability gate", () => {
  const record = () => packagePatientDatasetRegistry.resolve("patients.narva-iro-evacuation.v1").patients[0];
  const initial = () => record().runtimeFixture!.initialState as Record<string, any>;

  test("registers a valid versioned package without claiming full scenario readiness", () => {
    expect(exercisePackageValidator.validate(NARVA_IRO_EXERCISE_PACKAGE)).toEqual([]);
    expect(exercisePackageRegistry.require("russicaptor.narva-iro-evacuation", "1.0.0"))
      .toMatchObject({ packageId: "russicaptor.narva-iro-evacuation", packageVersion: "1.0.0",
        patientDatasetId: "patients.narva-iro-evacuation.v1" });
    expect(NARVA_IRO_EXERCISE_PACKAGE.metadata.tags).toContain("not-full-scenario-ready");
  });

  test("materializes one 70 kg P1 IRO patient", () => {
    const plan = createPatientMaterializationPlan("EX-NARVA-IRO", NARVA_IRO_EXERCISE_PACKAGE,
      packagePatientDatasetRegistry);
    expect(plan.patients).toHaveLength(1);
    expect(plan.patients[0]).toMatchObject({ patient: { id: "PT-IRO-001", triage: "P1", location: "IRO" },
      runtimeFixture: { fixtureId: "FX-NARVA-IRO-EVACUATION-1.0.0" } });
    expect(initial().patientWeightKg).toBe(70);
  });

  test("captures the approved baseline and ventilation reference without inventing active bootstrap", () => {
    expect(initial().baselineVitals).toEqual({ hr: 92, sbp: 105, dbp: 62, rr: 14, spo2: 96, etco2: 4.8, gcs: 3 });
    expect(initial().requiredInitialSupport.ventilation).toEqual({ mode: "VOLUME_CONTROL", tidalVolumeMl: 420,
      respiratoryRate: 14, fio2: 0.4, peepCmH2O: 8 });
  });

  test("captures supported norepinephrine and remifentanil requirements", () => {
    expect(initial().requiredInitialSupport).toMatchObject({ norepinephrineMicrogramsPerKgMin: 0.08,
      remifentanil: "CONTINUOUS_INFUSION", vascularAccessCount: 2 });
    expect(NARVA_IRO_EXERCISE_PACKAGE.availableClinicalTreatments)
      .toEqual(expect.arrayContaining(["REMIFENTANIL", "NOREPINEPHRINE", "MECHANICAL_VENTILATION"]));
  });

  test("configures the supported access, airway, ventilation and monitoring resources", () => {
    const resources = (record().runtimeFixture!.activeResources as any).resources;
    expect(resources.map((item: any) => item.type)).toEqual(expect.arrayContaining([
      "endotrachealTube", "ventilator", "peripheralIV", "centralVenousCatheter", "infusionPump",
      "monitor", "capnography", "oxygen",
    ]));
    expect(initial().requiredInitialSupport.monitoring).toEqual(["ECG", "SPO2", "NIBP", "ETCO2"]);
    expect(initial().requiredInitialSupport.nonDigitalChecklist).toEqual(["URINARY_CATHETER", "NGT_OPTIONAL"]);
  });

  test("fails the full-scenario readiness gate explicitly for real missing capabilities", () => {
    expect(initial().scenarioReadiness).toBe("INCOMPLETE_REQUIRED_CAPABILITIES");
    expect(initial().missingCapabilities).toEqual(NARVA_IRO_REQUIRED_CAPABILITY_GAPS);
    expect(NARVA_IRO_REQUIRED_CAPABILITY_GAPS).toEqual(expect.arrayContaining([
      "PROPOFOL", "ROCURONIUM_NEUROMUSCULAR_BLOCKADE", "TOF_RASS_BIS",
      "PACKAGE_BOUND_VASOPRESSOR_FAULT_STATE_MACHINE", "PACKAGE_BOUND_VENTILATION_FAULT_STATE_MACHINE",
      "CAUSE_GATED_PEA_ROSC", "ACTIVE_TREATMENT_FIXTURE_BOOTSTRAP",
    ]));
  });

  test("does not substitute unsupported drugs or fabricate scenario fault timings", () => {
    const treatments = NARVA_IRO_EXERCISE_PACKAGE.availableClinicalTreatments!.map(String);
    expect(treatments).not.toEqual(expect.arrayContaining(["PROPOFOL", "ROCURONIUM", "MIDAZOLAM"]));
    expect(initial()).not.toHaveProperty("vasopressorFaultStateMachine");
    expect(initial()).not.toHaveProperty("ventilationFaultStateMachine");
  });
});
