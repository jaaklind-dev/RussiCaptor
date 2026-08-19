import { clearTimelineEvents, getTimelineEvents } from "@/repositories/TimelineRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { MASSIVE_TRANSFUSION_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { createPatientMaterializationPlan } from "@/services/exercise/PackagePatientMaterializationService";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from "../InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "../ScenarioEngineInstructorRuntimeOwner";
import { advancePatientRuntime, createManualRuntimeAdvanceCommandId, handleResourceInterventionCommand, resetResourceInterventionCommands } from "../ResourceInterventionCommandService";
import { getCanonicalExerciseSnapshot, resetExerciseSession, restoreExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { clearExerciseClockTargets, registerExerciseClockTarget } from "@/services/runtime/exercise/ExerciseClockTargetRegistry";
import { createScenarioEngineExerciseClockTarget } from "@/services/runtime/exercise/ScenarioEngineExerciseClockTarget";
import { assertRuntimeCheckpointClockConsistency } from "@/services/StatePersistenceService";
import { canonicalRuntimePersistenceService } from "@/services/runtime/persistence/CanonicalRuntimePersistenceService";
import { publishRuntimeSnapshot } from "@/services/RuntimeSnapshotService";

describe("generic resource intervention command boundary", () => {
  const exerciseId = "EX-RESOURCE-UI"; const patientId = "PT-PELVIC-001";
  beforeEach(() => { clearInstructorRuntimeOwners(); clearExerciseClockTargets(); resetExerciseSession(); resetResourceInterventionCommands(); clearTimelineEvents(); });
  afterEach(() => { clearInstructorRuntimeOwners(); clearExerciseClockTargets(); resetExerciseSession(); resetResourceInterventionCommands(); clearTimelineEvents(); });

  test("applies the package fixture resource deterministically and remains idempotent", () => {
    const fixture = createPatientMaterializationPlan(exerciseId, PELVIC_INJURY_EXERCISE_PACKAGE, packagePatientDatasetRegistry).patients[0].runtimeFixture!;
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture));
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
    const command = { commandId: "RESOURCE-1", exerciseId, patientId, resourceId: "PB-1", issuedBy: "Exercise Controller" };
    const first = handleResourceInterventionCommand(command); const second = handleResourceInterventionCommand(command);
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    expect(engine.getAssignedResources(patientId).map(item => item.resourceId)).toEqual(["PB-1"]);
    expect(engine.getPatientProcesses().find(item => item.processType === "HEMORRHAGE")?.outputs.runtimeContributions?.bleedingRateMlMin).toBe(56);
    expect(getTimelineEvents(patientId).map(item => item.title)).toEqual(["Resource intervention applied"]);
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 60, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, patientId));
    expect(advancePatientRuntime({ commandId: "ADVANCE-1", exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" }).ok).toBe(true);
    expect(engine.getRuntimeState().exerciseTimeSec).toBe(120);
    expect(engine.getPatientProcesses().find(item => item.processType === "HEMORRHAGE")?.outputs.runtimeContributions?.cumulativeBloodLossMl).toBe(112);
  });

  test("keeps the authoritative exercise clock and registered patient runtime aligned", () => {
    const fixture = createPatientMaterializationPlan(exerciseId, PELVIC_INJURY_EXERCISE_PACKAGE, packagePatientDatasetRegistry).patients[0].runtimeFixture!;
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture));
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, patientId));
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));

    const result = handleResourceInterventionCommand({ commandId: "RESOURCE-CLOCK", exerciseId, patientId, resourceId: "PB-1", issuedBy: "Exercise Controller" });

    if (!result.ok) throw new Error(result.message);
    expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(60);
    expect(engine.getRuntimeState().exerciseTimeSec).toBe(60);
    expect(engine.getAssignedResources(patientId).map(item => item.resourceId)).toEqual(["PB-1"]);
  });

  test("advances every registered patient through the canonical exercise clock", () => {
    const plan = createPatientMaterializationPlan(exerciseId, PELVIC_INJURY_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    const pelvic = new ClinicalScenarioEngine(); pelvic.reset(structuredClone(plan.patients[0].runtimeFixture!));
    const second = new ClinicalScenarioEngine(); second.reset(structuredClone(plan.patients[0].runtimeFixture!));
    const secondPatientId = "PT-SECOND-001";
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(pelvic, patientId));
    registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(second, secondPatientId));
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(pelvic, exerciseId, patientId));

    const result = advancePatientRuntime({ commandId: "ADVANCE-CANONICAL", exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" });

    expect(result.ok).toBe(true);
    expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(60);
    expect(pelvic.getRuntimeState().exerciseTimeSec).toBe(60);
    expect(second.getRuntimeState().exerciseTimeSec).toBe(60);
    const persistedRuntimeStates = [
      canonicalRuntimePersistenceService.capture(pelvic, { exerciseId, patientId, packageId: "TEST", packageVersion: "1", packageHash: "a", definitionHash: "b", moduleCompositionHash: "c" }),
      canonicalRuntimePersistenceService.capture(second, { exerciseId, patientId: secondPatientId, packageId: "TEST", packageVersion: "1", packageHash: "a", definitionHash: "b", moduleCompositionHash: "c" }),
    ];
    expect(() => assertRuntimeCheckpointClockConsistency({ exerciseSession: getCanonicalExerciseSnapshot(), persistedRuntimeStates } as never)).not.toThrow();
  });

  test("advances hemorrhage through the canonical clock while configured MTP remains inactive and neutral", () => {
    const plan = createPatientMaterializationPlan(exerciseId, MASSIVE_TRANSFUSION_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(plan.patients[0].runtimeFixture!));
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, patientId));
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));

    const beforeMtp = engine.getPatientProcesses().find(item => item.processType === "MASSIVE_TRANSFUSION");
    const beforeHemorrhage = engine.getPatientProcesses().find(item => item.processType === "HEMORRHAGE");
    expect(beforeMtp?.outputs.runtimeContributions).toMatchObject({ mtpActivated: false, transfusedVolumeMl: 0 });
    expect(beforeHemorrhage?.outputs.runtimeContributions?.cumulativeBloodLossMl).toBe(0);

    const first = advancePatientRuntime({ commandId: "ADVANCE-MTP-INACTIVE-1", exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" });
    const second = advancePatientRuntime({ commandId: "ADVANCE-MTP-INACTIVE-2", exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" });

    expect(first.ok).toBe(true); expect(second.ok).toBe(true);
    expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(120);
    expect(engine.getRuntimeState().exerciseTimeSec).toBe(120);
    expect(engine.getPatientProcesses().find(item => item.processType === "HEMORRHAGE")?.outputs.runtimeContributions?.cumulativeBloodLossMl).toBe(280);
    expect(engine.getPatientProcesses().find(item => item.processType === "MASSIVE_TRANSFUSION")?.outputs.runtimeContributions).toMatchObject({
      mtpActivated: false, transfusedVolumeMl: 0, bloodProductInventory: { RBC: 6, PLASMA: 6, PLATELETS: 1 },
    });
    expect(getTimelineEvents(patientId).some(item => item.title.includes("failure"))).toBe(false);
  });

  test("fails closed instead of reporting success when the canonical clock target is missing", () => {
    const plan = createPatientMaterializationPlan(exerciseId, MASSIVE_TRANSFUSION_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(plan.patients[0].runtimeFixture!));
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));

    const result = advancePatientRuntime({ commandId: "ADVANCE-NO-TARGET", exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" });

    expect(result).toMatchObject({ ok: false, errorCode: "RUNTIME_FAILURE", message: "Patsiendi Runtime ei ole canonical kellaga seotud" });
    expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(0);
    expect(engine.getRuntimeState().exerciseTimeSec).toBe(0);
  });

  test("fails closed for a stale exercise binding", () => {
    const plan = createPatientMaterializationPlan(exerciseId, MASSIVE_TRANSFUSION_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(plan.patients[0].runtimeFixture!));
    restoreExerciseSession({ exerciseId: "EX-NEW", lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, patientId));
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));

    const result = advancePatientRuntime({ commandId: "ADVANCE-STALE", exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" });

    expect(result).toMatchObject({ ok: false, errorCode: "RUNTIME_FAILURE", message: "Õppuse canonical kell ei vasta aktiivsele käimasolevale õppusele" });
    expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(0);
  });

  test("issues a distinct command id for each manual advance intent even while a displayed snapshot is stale", () => {
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 82, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });

    const first = createManualRuntimeAdvanceCommandId(exerciseId, patientId);
    const second = createManualRuntimeAdvanceCommandId(exerciseId, patientId);

    expect(first).toBe(`RUNTIME-${exerciseId}-${patientId}-82-1`);
    expect(second).toBe(`RUNTIME-${exerciseId}-${patientId}-82-2`);
  });

  test("does not accept a global snapshot version change when the commanded patient snapshot stays stale", () => {
    const plan = createPatientMaterializationPlan(exerciseId, MASSIVE_TRANSFUSION_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(plan.patients[0].runtimeFixture!));
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    registerExerciseClockTarget({ targetId: patientId, advance: () => {
      publishRuntimeSnapshot({ ...engine.getRuntimeState(), encounterId: "PT-UNRELATED", exerciseTimeSec: 60 });
    } });
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));

    const result = advancePatientRuntime({ commandId: "ADVANCE-STALE-PATIENT-SNAPSHOT", exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" });

    expect(result).toMatchObject({ ok: false, errorCode: "RUNTIME_FAILURE", message: "Canonical kliiniline aeg ei liikunud" });
    expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(60);
    expect(engine.getRuntimeState().exerciseTimeSec).toBe(0);
  });
});
