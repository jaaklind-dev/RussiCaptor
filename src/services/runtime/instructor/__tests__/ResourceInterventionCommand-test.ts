import { clearTimelineEvents, getTimelineEvents } from "@/repositories/TimelineRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { PELVIC_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { createPatientMaterializationPlan } from "@/services/exercise/PackagePatientMaterializationService";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from "../InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "../ScenarioEngineInstructorRuntimeOwner";
import { advancePatientRuntime, handleResourceInterventionCommand, resetResourceInterventionCommands } from "../ResourceInterventionCommandService";
import { getCanonicalExerciseSnapshot, resetExerciseSession, restoreExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { clearExerciseClockTargets, registerExerciseClockTarget } from "@/services/runtime/exercise/ExerciseClockTargetRegistry";
import { createScenarioEngineExerciseClockTarget } from "@/services/runtime/exercise/ScenarioEngineExerciseClockTarget";

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
});
