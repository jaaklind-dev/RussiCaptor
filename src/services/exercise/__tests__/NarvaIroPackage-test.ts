import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { NARVA_IRO_EXERCISE_PACKAGE } from "../NarvaExercisePackages";
import { NARVA_IRO_REQUIRED_CAPABILITY_GAPS } from "../NarvaPatientDatasets";
import { createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { exercisePackageRegistry, exercisePackageValidator } from "../ExercisePackageService";

describe("WP-NARVA-02 IRO full package readiness", () => {
  const record = () => packagePatientDatasetRegistry.resolve("patients.narva-iro-evacuation.v1").patients[0];
  const fixture = () => record().runtimeFixture!;
  const initial = () => fixture().initialState as Record<string, any>;

  test("registers the ready immutable package and one 70 kg P1 patient", () => {
    expect(exercisePackageValidator.validate(NARVA_IRO_EXERCISE_PACKAGE)).toEqual([]);
    expect(exercisePackageRegistry.require("russicaptor.narva-iro-evacuation", "1.0.0"))
      .toMatchObject({ patientDatasetId: "patients.narva-iro-evacuation.v1" });
    expect(NARVA_IRO_EXERCISE_PACKAGE.metadata.tags).toContain("full-scenario-ready");
    expect(createPatientMaterializationPlan("EX-NARVA-IRO", NARVA_IRO_EXERCISE_PACKAGE,
      packagePatientDatasetRegistry).patients).toHaveLength(1);
    expect(initial()).toMatchObject({ patientWeightKg: 70, scenarioReadiness: "READY_FOR_PHYSICAL_REHEARSAL",
      narvaIroScenario: true, narvaIroInitialTreatments: true });
    expect(NARVA_IRO_REQUIRED_CAPABILITY_GAPS).toEqual([]);
  });

  test("offers the real alternative treatment palette rather than a golden path", () => {
    expect(NARVA_IRO_EXERCISE_PACKAGE.availableClinicalTreatments).toEqual(expect.arrayContaining([
      "PROPOFOL", "MIDAZOLAM", "ROCURONIUM", "REMIFENTANIL", "FENTANYL", "KETAMINE", "ESKETAMINE",
      "NOREPINEPHRINE", "RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN", "MECHANICAL_VENTILATION",
      "ADRENALINE",
    ]));
  });

  test("materializes canonical active airway, ventilation, access and infusions without replay", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture()));
    expect(engine.getAirwayState("PT-IRO-001")).toMatchObject({ activeAirway: "ENDOTRACHEAL",
      currentVentilation: "MECHANICAL", confirmed: true });
    expect(engine.getCirculationState("PT-IRO-001").vascularAccess).toHaveLength(2);
    expect(engine.getMechanicalVentilationState("PT-IRO-001")[0]).toMatchObject({ mode: "VOLUME_CONTROL",
      respiratoryRate: 14, tidalVolumeMl: 420, fio2: 0.4, peepCmH2O: 8, externalSupportActive: true });
    expect(engine.getNorepinephrineState("PT-IRO-001")[0]).toMatchObject({ doseMicrogramsPerKgMin: 0.08,
      status: "RUNNING" });
    expect(engine.getAnalgesicState("PT-IRO-001")).toEqual(expect.arrayContaining([
      expect.objectContaining({ drugId: "PROPOFOL", currentRate: 140 }),
      expect.objectContaining({ drugId: "REMIFENTANIL", currentRate: 7 }),
      expect.objectContaining({ drugId: "ROCURONIUM", currentRate: 21 }),
    ]));
    expect(engine.getAnalgesicState("PT-IRO-001").find(item => item.drugId === "PROPOFOL"))
      .toMatchObject({ rass: -5, bis: 40 });
    expect(engine.getAnalgesicState("PT-IRO-001").find(item => item.drugId === "ROCURONIUM")!.trainOfFour)
      .toBeLessThanOrEqual(2);
  });

  test("round-trips the complete active fixture deterministically", () => {
    const source = new ClinicalScenarioEngine(); source.reset(structuredClone(fixture()));
    const payload = source.captureRuntimePayload(); const restored = new ClinicalScenarioEngine();
    restored.rehydrateRuntimePayload(payload);
    expect(restored.captureRuntimePayload()).toEqual(payload);
    expect(restored.getNarvaIroScenarioState()).toEqual(source.getNarvaIroScenarioState());
  });

  test("materializes PEA in the accepted cardiac-arrest Runtime and grants ROSC only after CPR and cause correction", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture()));
    engine.triggerNarvaIroVasopressorFault(); engine.advanceTo(181);
    expect(engine.getPatientProcesses().find(item => item.processType === "CARDIAC_ARREST"))
      .toMatchObject({ processType: "CARDIAC_ARREST", clinicalState: {
        cardiacState: "ARREST", rhythm: "PEA", rhythmClassification: "NON_SHOCKABLE",
      } });
    expect(engine.attemptNarvaIroRosc().status).toBe("REJECTED");
    engine.setNarvaIroCprQuality(true); engine.correctNarvaIroVasopressorFault();
    expect(engine.attemptNarvaIroRosc().status).toBe("APPLIED");
    expect(engine.getPatientProcesses().find(item => item.processType === "CARDIAC_ARREST"))
      .toMatchObject({ processType: "CARDIAC_ARREST", clinicalState: {
        cardiacState: "ROSC", rhythm: "PERFUSING",
      } });
    expect(engine.getNarvaIroScenarioState()).toMatchObject({ rosc: true, goNoGoRequired: true });
  });
});
