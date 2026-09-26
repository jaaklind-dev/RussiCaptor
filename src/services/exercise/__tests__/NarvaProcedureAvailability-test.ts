import { restoreExerciseSession, resetExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { handleResourceInterventionCommand, resetResourceInterventionCommands } from
  "@/services/runtime/instructor/ResourceInterventionCommandService";
import { materializeRuntimePatientCommand } from
  "@/services/runtime/commands/RuntimePatientCommandMaterializer";
import { clearExerciseClockTargets, registerExerciseClockTarget } from
  "@/services/runtime/exercise/ExerciseClockTargetRegistry";
import { createScenarioEngineExerciseClockTarget } from
  "@/services/runtime/exercise/ScenarioEngineExerciseClockTarget";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { exercisePackageLoader } from "../ExercisePackageService";
import { NARVA_IRO_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE,
  NARVA_TRAUMA_TREATMENT_PALETTE } from "../NarvaExercisePackages";
import { createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { isResourceInterventionAllowed, projectPatientInterventionAvailability } from
  "../PackageInterventionAvailabilityService";

const exerciseId = "EX-PROC-NARVA";
const fixture = (patientId: string) => createPatientMaterializationPlan(exerciseId,
  NARVA_TRAUMA_EXERCISE_PACKAGE, packagePatientDatasetRegistry).patients
  .find(item => item.patient.id === patientId)!.runtimeFixture!;

describe("PROC-G01..G12 Narva package-owned patient procedure availability", () => {
  beforeEach(() => {
    clearInstructorRuntimeOwners(); clearExerciseClockTargets(); resetResourceInterventionCommands(); resetExerciseSession();
    exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0,
      speed: 1, version: 1, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
  });
  afterEach(() => { clearInstructorRuntimeOwners(); clearExerciseClockTargets(); resetResourceInterventionCommands(); resetExerciseSession(); });

  test("pelvic patient owns binder but not chest drain despite receiving both resources", () => {
    const projection = projectPatientInterventionAvailability(NARVA_TRAUMA_EXERCISE_PACKAGE, "PT-PELVIC-001")!;
    expect(projection.resourceInterventionDefinitionIds).toContain("PELVIC_BINDER_APPLICATION");
    expect(projection.resourceInterventionDefinitionIds).not.toContain("CHEST_DRAIN_INSERTION");
    const resources = (fixture("PT-PELVIC-001").activeResources as any).resources.map((item: any) => item.type);
    expect(resources).toEqual(expect.arrayContaining(["pelvicBinder", "chestDrain"]));
    expect(isResourceInterventionAllowed(exerciseId, "PT-PELVIC-001", "CHEST_DRAIN_INSERTION")).toBe(false);
  });

  test("chest patient owns chest drain but not pelvic binder despite receiving both resources", () => {
    const projection = projectPatientInterventionAvailability(NARVA_TRAUMA_EXERCISE_PACKAGE, "PT-CHEST-001")!;
    expect(projection.resourceInterventionDefinitionIds).toContain("CHEST_DRAIN_INSERTION");
    expect(projection.resourceInterventionDefinitionIds).not.toContain("PELVIC_BINDER_APPLICATION");
    const resources = (fixture("PT-CHEST-001").activeResources as any).resources.map((item: any) => item.type);
    expect(resources).toEqual(expect.arrayContaining(["pelvicBinder", "chestDrain"]));
    expect(isResourceInterventionAllowed(exerciseId, "PT-CHEST-001", "PELVIC_BINDER_APPLICATION")).toBe(false);
  });

  test("preserves package-wide procedures, specialized actions, treatments and MTP", () => {
    for (const patientId of ["PT-PELVIC-001", "PT-CHEST-001"]) {
      const projection = projectPatientInterventionAvailability(NARVA_TRAUMA_EXERCISE_PACKAGE, patientId)!;
      expect(projection.resourceInterventionDefinitionIds).toEqual(expect.arrayContaining([
        "PERIPHERAL_IV_ACCESS", "CENTRAL_VENOUS_ACCESS", "ENDOTRACHEAL_INTUBATION",
      ]));
      expect(projection.specializedActions).toEqual(["CLINICAL_TREATMENT", "MTP", "TRANSPORT_START"]);
      expect((fixture(patientId).initialState as any).massiveTransfusion).toBeDefined();
    }
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE.availableClinicalTreatments)
      .toEqual([...NARVA_TRAUMA_TREATMENT_PALETTE].sort());
  });

  test("allows the source-backed patient procedure through the direct service boundary", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture("PT-PELVIC-001")));
    registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, "PT-PELVIC-001"));
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, "PT-PELVIC-001"));
    const result = handleResourceInterventionCommand({ commandId: "BINDER-OK", exerciseId,
      patientId: "PT-PELVIC-001", resourceId: "PB-PELVIC-1", issuedBy: "CM" });
    expect(result.ok).toBe(true);
    expect(engine.getInterventionInstances()).toEqual(expect.arrayContaining([
      expect.objectContaining({ definitionId: "PELVIC_BINDER_APPLICATION", status: "RUNNING" }),
    ]));
  });

  test("rejects forced unauthorized procedure at direct service and durable materializer boundaries", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture("PT-PELVIC-001")));
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, "PT-PELVIC-001"));
    const direct = handleResourceInterventionCommand({ commandId: "DRAIN-DIRECT", exerciseId,
      patientId: "PT-PELVIC-001", resourceId: "DRAIN-PELVIC-1", issuedBy: "CM" });
    expect(direct).toMatchObject({ ok: false, errorCode: "UNAVAILABLE" });
    const durable = materializeRuntimePatientCommand({ exerciseId, patientId: "PT-PELVIC-001",
      commandId: "DRAIN-DURABLE", commandType: "RESOURCE_APPLY", patientBaseRevision: 1,
      patientResultingRevision: 2, simulationTimeSec: 0, payload: { resourceId: "DRAIN-PELVIC-1" },
      commandSequence: 1, actorUserId: "CM" });
    expect(durable).toMatchObject({ status: "REJECTED",
      result: { message: "Intervention is not available for this package patient" } });
    expect(engine.getInterventionInstances().some(item => item.definitionId === "CHEST_DRAIN_INSERTION")).toBe(false);
  });

  test("derives identical availability after canonical runtime restore without persisting it", () => {
    const before = projectPatientInterventionAvailability(NARVA_TRAUMA_EXERCISE_PACKAGE, "PT-CHEST-001");
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture("PT-CHEST-001")));
    const payload = engine.captureRuntimePayload(); const restored = new ClinicalScenarioEngine();
    restored.reset(structuredClone(fixture("PT-CHEST-001"))); restored.rehydrateRuntimePayload(payload);
    expect(projectPatientInterventionAvailability(NARVA_TRAUMA_EXERCISE_PACKAGE, "PT-CHEST-001")).toEqual(before);
    expect(JSON.stringify(payload)).not.toContain("interventionAvailability");
  });

  test("does not inject Narva availability into unrelated or IRO packages", () => {
    expect(projectPatientInterventionAvailability(NARVA_IRO_EXERCISE_PACKAGE, "PT-IRO-001")).toBeUndefined();
    const iroExercise = "EX-PROC-IRO"; exercisePackageLoader.bind(iroExercise, NARVA_IRO_EXERCISE_PACKAGE);
    expect(isResourceInterventionAllowed(iroExercise, "PT-IRO-001", "ENDOTRACHEAL_INTUBATION")).toBe(true);
  });
});
