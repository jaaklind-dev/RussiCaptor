import { restoreExerciseSession, resetExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { createPatientMaterializationPlan } from "@/services/exercise/PackagePatientMaterializationService";
import { observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics } from
  "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { handleEndotrachealIntubationCommand, resetEndotrachealIntubationCommands,
  submitEndotrachealIntubationCommand } from
  "@/services/runtime/instructor/EndotrachealIntubationCommandService";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { RuntimePatientCommandSubmission } from "@/models/RuntimePatientCommand";
import { InMemoryRuntimePatientCommandGateway, type RuntimeCommandActor } from
  "../InMemoryRuntimePatientCommandGateway";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { RuntimePatientCommandConsumer, setRuntimePatientCommandGateway } from
  "../RuntimePatientCommandService";
import { resetRuntimePatientCommandCursor, restoreRuntimePatientCommandCursor } from
  "../RuntimePatientCommandCursor";
import { resetRuntimeReaderConvergence, setRuntimeCommandAuthorityWriter } from
  "@/services/runtime/persistence/RuntimeReaderConvergenceService";

const exerciseId = "EX-DURABLE-ETT";
const patientId = "PT-PELVIC-001";
const lease: RuntimeWriterLease = Object.freeze({ leaseId: "LEASE-ETT", exerciseId,
  writerInstanceId: "WRITER-ETT", userId: "WRITER", expiresAt: "2099-01-01T00:00:00.000Z" });
let actor: RuntimeCommandActor;

const request = (commandId = "ETT-DURABLE-1"): RuntimePatientCommandSubmission => Object.freeze({
  exerciseId, patientId, commandId, commandType: "ENDOTRACHEAL_INTUBATION",
  patientBaseRevision: 0, simulationTimeSec: 120, payload: Object.freeze({
    tubeResourceId: "ETT-PELVIC-1", laryngoscopeResourceId: "DL-PELVIC-1",
    device: "DIRECT", tubeSize: 7.5, cuff: true, confirmation: true,
  }),
});

function setupEngine(): ClinicalScenarioEngine {
  const fixture = createPatientMaterializationPlan(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE,
    packagePatientDatasetRegistry).patients.find(item => item.patient.id === patientId)!.runtimeFixture!;
  const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture)); engine.advanceTo(120);
  registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
  return engine;
}

describe("PROC-G13..G22 durable endotracheal intubation", () => {
  beforeAll(() => exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE));
  beforeEach(() => {
    actor = { userId: "CM-A", role: "CM", exerciseIds: [exerciseId] };
    clearInstructorRuntimeOwners(); resetEndotrachealIntubationCommands(); resetRuntimePatientCommandCursor();
    resetSharedWorkflowConflictMetrics(); setRuntimeWriterAuthorityState("WRITER");
    setRuntimePatientCommandGateway(undefined); resetRuntimeReaderConvergence();
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 120,
      speed: 1, version: 1, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
  });
  afterEach(() => {
    clearInstructorRuntimeOwners(); resetEndotrachealIntubationCommands(); resetRuntimePatientCommandCursor();
    resetSharedWorkflowConflictMetrics(); setRuntimeWriterAuthorityState("UNRESOLVED"); resetExerciseSession();
    setRuntimePatientCommandGateway(undefined); resetRuntimeReaderConvergence();
  });

  test("submission facade emits only the narrow durable ETT payload", async () => {
    const submit = jest.fn(async () => ({ status: "APPLIED" as const, commandSequence: 9,
      patientRevision: 1, ownerUserId: "CM-A" }));
    setRuntimePatientCommandGateway({ submit, loadAfter: async () => [], record: async () => undefined });
    observeSharedWorkflowHead(exerciseId, patientId, 0, "CM-A");
    setRuntimeCommandAuthorityWriter(exerciseId);
    const result = await submitEndotrachealIntubationCommand({ commandId: "ETT-FACADE", exerciseId,
      patientId, tubeResourceId: "ETT-PELVIC-1", laryngoscopeResourceId: "DL-PELVIC-1",
      device: "DIRECT", tubeSize: 7.5, cuff: true, confirmation: true, issuedBy: "CM-A" });
    expect(result).toMatchObject({ ok: true, runtimeEventId: "QUEUED-9" });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ commandType: "ENDOTRACHEAL_INTUBATION",
      patientBaseRevision: 0, payload: { tubeResourceId: "ETT-PELVIC-1",
        laryngoscopeResourceId: "DL-PELVIC-1", device: "DIRECT", tubeSize: 7.5,
        cuff: true, confirmation: true } }));
  });

  test("reader acceptance does not mutate locally and writer materializes one canonical ETT", async () => {
    const engine = setupEngine(); const gateway = new InMemoryRuntimePatientCommandGateway(() => actor);
    gateway.seed(exerciseId, patientId, "CM-A");
    const first = await gateway.submit(request());
    expect(first.status).toBe("APPLIED");
    expect(engine.getAirwayState(patientId).activeAirway).toBe("NONE");

    const consumer = new RuntimePatientCommandConsumer(gateway, materializeRuntimePatientCommand,
      () => engine.getSimulationTimeSec());
    await expect(consumer.drain(exerciseId, lease)).resolves.toBe(1);
    expect(gateway.materialized(1)).toMatchObject({ status: "MATERIALIZED", result: { ok: true } });
    expect(engine.getAirwayState(patientId)).toMatchObject({ activeAirway: "ENDOTRACHEAL", confirmed: true });
    expect(engine.getInterventionInstances().filter(item => item.definitionId === "ENDOTRACHEAL_INTUBATION"))
      .toHaveLength(1);
  });

  test("same durable envelope and replay after cursor restore never duplicate ETT", async () => {
    const engine = setupEngine(); const gateway = new InMemoryRuntimePatientCommandGateway(() => actor);
    gateway.seed(exerciseId, patientId, "CM-A");
    expect((await gateway.submit(request())).status).toBe("APPLIED");
    expect((await gateway.submit(request())).status).toBe("IDEMPOTENT");
    const consumer = new RuntimePatientCommandConsumer(gateway, materializeRuntimePatientCommand,
      () => engine.getSimulationTimeSec());
    await consumer.drain(exerciseId, lease);
    restoreRuntimePatientCommandCursor(exerciseId, 0);
    await consumer.drain(exerciseId, lease);
    expect(engine.getInterventionInstances().filter(item => item.definitionId === "ENDOTRACHEAL_INTUBATION"))
      .toHaveLength(1);
  });

  test("accepted command survives writer absence and a takeover consumes it once", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed(exerciseId, patientId, "CM-A");
    expect((await gateway.submit(request("ETT-TAKEOVER"))).status).toBe("APPLIED");
    expect(gateway.materialized(1)).toBeUndefined();
    const engine = setupEngine(); const consumer = new RuntimePatientCommandConsumer(gateway,
      materializeRuntimePatientCommand, () => engine.getSimulationTimeSec());
    await consumer.drain(exerciseId, { ...lease, writerInstanceId: "TAKEOVER-WRITER" });
    expect(engine.getInterventionInstances().filter(item => item.definitionId === "ENDOTRACHEAL_INTUBATION"))
      .toHaveLength(1);
  });

  test("terminal fence rejects ETT before it enters the inbox", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed(exerciseId, patientId, "CM-A");
    gateway.fence(exerciseId);
    expect((await gateway.submit(request("ETT-TERMINAL"))).status).toBe("COMPLETION_FENCED");
    expect(gateway.accepted()).toHaveLength(0);
  });

  test("package/patient availability rejects an unauthorized ETT before owner lookup", () => {
    expect(handleEndotrachealIntubationCommand({ commandId: "ETT-UNAUTHORIZED", exerciseId,
      patientId: "PT-NOT-IN-PACKAGE", tubeResourceId: "ETT-X", laryngoscopeResourceId: "DL-X",
      device: "DIRECT", tubeSize: 7.5, cuff: true, confirmation: true, issuedBy: "CM-A" }))
      .toMatchObject({ ok: false, errorCode: "INTERVENTION_REJECTED" });
  });

  test("checkpoint restore keeps the active ETT and ventilation prerequisite unchanged", () => {
    const engine = setupEngine();
    const accepted = Object.freeze({ ...request("ETT-PERSIST"), commandSequence: 1,
      patientResultingRevision: 1, actorUserId: "CM-A" });
    expect(materializeRuntimePatientCommand(accepted).status).toBe("MATERIALIZED");
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(engine.captureRuntimePayload());
    const airway = restored.getInterventionInstances().find(item => item.definitionId === "ENDOTRACHEAL_INTUBATION")!;
    expect(restored.getAirwayState(patientId)).toMatchObject({ activeAirway: "ENDOTRACHEAL", confirmed: true });
    expect(restored.executeMechanicalVentilationCommand({ commandId: "VENT-AFTER-ETT", action: "START",
      supportId: "VENT-PELVIC-1", patientId, simulationTimeSec: 120, securedAirwayId: airway.instanceId,
      settings: { mode: "VOLUME_CONTROL", respiratoryRate: 14, respiratoryRateUnit: "BREATHS_MIN",
        tidalVolumeMl: 500, tidalVolumeUnit: "ML", fio2: 0.6, peepCmH2O: 5,
        peepUnit: "CM_H2O" } }).status).toBe("APPLIED");
  });
});
