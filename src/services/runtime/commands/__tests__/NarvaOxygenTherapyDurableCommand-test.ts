import { restoreExerciseSession, resetExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE_V101 } from
  "@/services/exercise/NarvaExercisePackages";
import { createPatientMaterializationPlan } from "@/services/exercise/PackagePatientMaterializationService";
import { clearExerciseClockTargets, registerExerciseClockTarget } from
  "@/services/runtime/exercise/ExerciseClockTargetRegistry";
import { createScenarioEngineExerciseClockTarget } from
  "@/services/runtime/exercise/ScenarioEngineExerciseClockTarget";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { resetResourceInterventionCommands, submitResourceInterventionCommand } from
  "@/services/runtime/instructor/ResourceInterventionCommandService";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { resetRuntimeReaderConvergence, setRuntimeCommandAuthorityWriter,
  beginRuntimeReaderConvergence } from "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import { observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics } from
  "@/services/sharedWorkflow/SharedWorkflowMutationService";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { RuntimePatientCommandSubmission } from "@/models/RuntimePatientCommand";
import { InMemoryRuntimePatientCommandGateway, type RuntimeCommandActor } from
  "../InMemoryRuntimePatientCommandGateway";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { RuntimePatientCommandConsumer, setRuntimePatientCommandGateway } from
  "../RuntimePatientCommandService";
import { resetRuntimePatientCommandCursor, restoreRuntimePatientCommandCursor } from
  "../RuntimePatientCommandCursor";

const exerciseId = "EX-NARVA-OXYGEN";
const patientId = "PT-CHEST-001";
const resourceId = "O2-MASK-CHEST-1";
const lease: RuntimeWriterLease = Object.freeze({ leaseId: "LEASE-O2", exerciseId,
  writerInstanceId: "WRITER-O2", userId: "WRITER", expiresAt: "2099-01-01T00:00:00.000Z" });
let actor: RuntimeCommandActor;

const request = (commandId = "O2-START-1"): RuntimePatientCommandSubmission => Object.freeze({
  exerciseId, patientId, commandId, commandType: "RESOURCE_APPLY", patientBaseRevision: 0,
  simulationTimeSec: 0, payload: Object.freeze({ resourceId }),
});

function setupEngine(): ClinicalScenarioEngine {
  const fixture = createPatientMaterializationPlan(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE,
    packagePatientDatasetRegistry).patients.find(item => item.patient.id === patientId)!.runtimeFixture!;
  const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture));
  registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
  registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, patientId));
  return engine;
}

describe("PROC-G33..G42 Narva P02 durable oxygen therapy", () => {
  beforeEach(() => {
    actor = { userId: "CM-A", role: "CM", exerciseIds: [exerciseId] };
    clearInstructorRuntimeOwners(); clearExerciseClockTargets(); resetResourceInterventionCommands();
    resetRuntimePatientCommandCursor(); resetSharedWorkflowConflictMetrics(); resetRuntimeReaderConvergence();
    setRuntimeWriterAuthorityState("WRITER"); setRuntimePatientCommandGateway(undefined);
    exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0,
      speed: 1, version: 1, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
  });
  afterEach(() => {
    clearInstructorRuntimeOwners(); clearExerciseClockTargets(); resetResourceInterventionCommands();
    resetRuntimePatientCommandCursor(); resetSharedWorkflowConflictMetrics(); resetRuntimeReaderConvergence();
    setRuntimeWriterAuthorityState("UNRESOLVED"); setRuntimePatientCommandGateway(undefined); resetExerciseSession();
  });

  test("current package owns P02 oxygen while immutable 1.0.1 and unrelated patients do not", () => {
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE.interventionAvailability?.patients.find(item =>
      item.patientId === patientId)?.allowedResourceInterventionDefinitionIds).toContain("OXYGEN_THERAPY");
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE.interventionAvailability?.patients.find(item =>
      item.patientId === "PT-PELVIC-001")?.allowedResourceInterventionDefinitionIds).not.toContain("OXYGEN_THERAPY");
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE_V101.interventionAvailability?.patients.flatMap(item =>
      item.allowedResourceInterventionDefinitionIds)).not.toContain("OXYGEN_THERAPY");
  });

  test("submission uses the durable RESOURCE_APPLY facade and stale readiness fails closed", async () => {
    const submit = jest.fn(async () => ({ status: "APPLIED" as const, commandSequence: 7,
      patientRevision: 1, ownerUserId: "CM-A" }));
    setRuntimePatientCommandGateway({ submit, loadAfter: async () => [], record: async () => undefined });
    observeSharedWorkflowHead(exerciseId, patientId, 0, "CM-A"); setRuntimeCommandAuthorityWriter(exerciseId);
    await expect(submitResourceInterventionCommand({ commandId: "O2-FACADE", exerciseId,
      patientId, resourceId, issuedBy: "CM-A" })).resolves.toMatchObject({ ok: true });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ commandType: "RESOURCE_APPLY",
      payload: { resourceId } }));
    beginRuntimeReaderConvergence(exerciseId);
    await expect(submitResourceInterventionCommand({ commandId: "O2-STALE", exerciseId,
      patientId, resourceId, issuedBy: "CM-A" })).resolves.toMatchObject({ ok: false });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  test("reader acceptance causes no local change and the writer materializes oxygen exactly once", async () => {
    const engine = setupEngine(); const gateway = new InMemoryRuntimePatientCommandGateway(() => actor);
    gateway.seed(exerciseId, patientId, "CM-A");
    expect((await gateway.submit(request())).status).toBe("APPLIED");
    expect((await gateway.submit(request())).status).toBe("IDEMPOTENT");
    expect(engine.getInterventionInstances()).toHaveLength(0);
    const consumer = new RuntimePatientCommandConsumer(gateway, materializeRuntimePatientCommand,
      () => engine.getSimulationTimeSec());
    await consumer.drain(exerciseId, lease); restoreRuntimePatientCommandCursor(exerciseId, 0);
    await consumer.drain(exerciseId, lease);
    expect(engine.getInterventionInstances().filter(item => item.definitionId === "OXYGEN_THERAPY"))
      .toHaveLength(1);
    expect(engine.getAirwayState(patientId).activeOxygenDelivery).toBe("oxygenMask");
  });

  test("accepted intent survives writer absence and takeover without duplication", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed(exerciseId, patientId, "CM-A");
    expect((await gateway.submit(request("O2-TAKEOVER"))).status).toBe("APPLIED");
    const engine = setupEngine(); const consumer = new RuntimePatientCommandConsumer(gateway,
      materializeRuntimePatientCommand, () => engine.getSimulationTimeSec());
    await consumer.drain(exerciseId, { ...lease, writerInstanceId: "TAKEOVER-O2" });
    expect(engine.getInterventionInstances().filter(item => item.definitionId === "OXYGEN_THERAPY"))
      .toHaveLength(1);
  });

  test("checkpoint restore preserves oxygen state and existing directional physiology", () => {
    const engine = setupEngine();
    const spo2Before = engine.getRuntimeState().targetVitals.spo2!;
    expect(materializeRuntimePatientCommand({ ...request("O2-PERSIST"), commandSequence: 1,
      patientResultingRevision: 1, actorUserId: "CM-A" })).toMatchObject({ status: "MATERIALIZED" });
    const hypoxia = engine.getPatientProcesses().find(item => item.processType === "HYPOXIA")!;
    expect(hypoxia.clinicalState).toMatchObject({ oxygenTherapyActive: true });
    expect(engine.getRuntimeState().targetVitals.spo2).toBeGreaterThan(spo2Before);
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(engine.captureRuntimePayload());
    expect(restored.getAirwayState(patientId).activeOxygenDelivery).toBe("oxygenMask");
    expect(restored.getPatientProcesses().find(item => item.processType === "HYPOXIA")?.clinicalState)
      .toMatchObject({ oxygenTherapyActive: true });
  });

  test("generic RESOURCE_STOP deterministically removes the existing oxygen effect", () => {
    const engine = setupEngine();
    materializeRuntimePatientCommand({ ...request("O2-STOP-SOURCE"), commandSequence: 1,
      patientResultingRevision: 1, actorUserId: "CM-A" });
    const instance = engine.getInterventionInstances().find(item => item.definitionId === "OXYGEN_THERAPY")!;
    expect(materializeRuntimePatientCommand({ exerciseId, patientId, commandId: "O2-STOP", commandType: "RESOURCE_STOP",
      patientBaseRevision: 1, patientResultingRevision: 2, simulationTimeSec: 60,
      payload: { sourceInterventionId: instance.sourceInterventionId }, commandSequence: 2,
      actorUserId: "CM-A" })).toMatchObject({ status: "MATERIALIZED" });
    expect(engine.getInterventionInstances().find(item => item.instanceId === instance.instanceId)?.status)
      .toBe("CANCELLED");
    expect(engine.getAirwayState(patientId).activeOxygenDelivery).toBeUndefined();
  });
});
