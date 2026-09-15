import type { AcceptedRuntimePatientCommand } from "@/models/RuntimePatientCommand";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";

const command = (commandType: "LAB_ORDER" | "LAB_COLLECT", payload: Record<string, unknown>): AcceptedRuntimePatientCommand => ({
  exerciseId: "EX-LAB", patientId: "PT-1", commandId: `CMD-${commandType}`, commandType,
  patientBaseRevision: 1, patientResultingRevision: 2, simulationTimeSec: 1000,
  payload, commandSequence: 4, actorUserId: "CM-A",
});

describe("laboratory durable patient-command materialization", () => {
  afterEach(() => { clearInstructorRuntimeOwners(); setRuntimeWriterAuthorityState("UNRESOLVED");
    exercisePackageLoader.unbind("EX-LAB"); });

  test("routes accepted order and collection through the sole registered Runtime owner", () => {
    const seen: unknown[] = [];
    registerInstructorRuntimeOwner({ exerciseId: "EX-LAB", patientId: "PT-1", supportedEvents: [],
      execute: () => ({ ok: false, reason: "unused" }),
      executeLaboratoryCommand: input => { seen.push(input); return { ok: true, runtimeEventId: input.commandId }; } });
    expect(materializeRuntimePatientCommand(command("LAB_ORDER", { labPackageId: "NARVA_POLYTRAUMA" })).status)
      .toBe("MATERIALIZED");
    expect(materializeRuntimePatientCommand(command("LAB_COLLECT", { orderId: "LAB-ORDER:CMD-LAB_ORDER" })).status)
      .toBe("MATERIALIZED");
    expect(seen).toHaveLength(2);
  });

  test("fails closed for malformed payload or absent authoritative writer", () => {
    expect(materializeRuntimePatientCommand(command("LAB_ORDER", {}))).toMatchObject({ status: "REJECTED" });
    expect(materializeRuntimePatientCommand(command("LAB_COLLECT", {}))).toMatchObject({ status: "REJECTED" });
    expect(materializeRuntimePatientCommand(command("LAB_ORDER", { labPackageId: "NARVA_IRO_ASTRUP" })))
      .toMatchObject({ status: "REJECTED", result: { reason: "Patient runtime is not available" } });
  });

  test("authoritative owner materializes idempotent order and collection into checkpoint state", () => {
    const record = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients[0];
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(record.runtimeFixture!)); engine.advanceTo(1000);
    exercisePackageLoader.bind("EX-LAB", NARVA_TRAUMA_EXERCISE_PACKAGE);
    setRuntimeWriterAuthorityState("WRITER");
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, "EX-LAB", record.patient.id));
    const orderCommand = { ...command("LAB_ORDER", { labPackageId: "NARVA_POLYTRAUMA" }),
      patientId: record.patient.id, commandId: "CMD-O" };
    expect(materializeRuntimePatientCommand(orderCommand)).toMatchObject({ status: "MATERIALIZED" });
    expect(materializeRuntimePatientCommand(orderCommand)).toMatchObject({ status: "MATERIALIZED" });
    const collectCommand = { ...command("LAB_COLLECT", { orderId: "LAB-ORDER:CMD-O" }),
      patientId: record.patient.id, commandId: "CMD-S" };
    const firstCollect = materializeRuntimePatientCommand(collectCommand);
    expect(firstCollect).toMatchObject({ status: "MATERIALIZED" });
    expect(materializeRuntimePatientCommand(collectCommand)).toMatchObject({ status: "MATERIALIZED" });
    expect(engine.captureRuntimePayload().laboratory).toMatchObject({
      orders: [{ orderId: "LAB-ORDER:CMD-O", status: "COLLECTED" }],
      samples: [{ sampleId: "LAB-SAMPLE:CMD-S", sampledAtSimulationTimeSec: 1000 }],
    });
  });
});
