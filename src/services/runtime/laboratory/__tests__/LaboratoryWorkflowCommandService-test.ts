import { replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_IRO_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE } from
  "@/services/exercise/NarvaExercisePackages";
import { submitPatientRuntimeCommand } from "@/services/runtime/commands/RuntimePatientCommandService";
import type { LaboratoryWorkflowSnapshot } from "@/models/LaboratoryWorkflow";
import { createLaboratoryCollectCommandId, createLaboratoryOrderCommandId,
  laboratoryPackageForActiveExercise, submitLaboratoryCollection, submitLaboratoryOrder } from
  "../LaboratoryWorkflowCommandService";

jest.mock("@/services/runtime/commands/RuntimePatientCommandService", () => ({
  submitPatientRuntimeCommand: jest.fn(),
}));

const submit = submitPatientRuntimeCommand as jest.MockedFunction<typeof submitPatientRuntimeCommand>;
const emptyWorkflow: LaboratoryWorkflowSnapshot = Object.freeze({ schemaVersion: 1, orders: [], samples: [],
  resultGroups: [], patientBloodIdentities: {} });

describe("minimal supported laboratory command surface", () => {
  afterEach(() => { exercisePackageLoader.unbind("EX-LAB-UI"); jest.clearAllMocks(); });

  test("enforces IRO Astrup-only and trauma POLÜTRAUMA package scope", () => {
    exercisePackageLoader.bind("EX-LAB-UI", NARVA_IRO_EXERCISE_PACKAGE);
    expect(laboratoryPackageForActiveExercise("EX-LAB-UI")).toBe("NARVA_IRO_ASTRUP");
    exercisePackageLoader.unbind("EX-LAB-UI");
    exercisePackageLoader.bind("EX-LAB-UI", NARVA_TRAUMA_EXERCISE_PACKAGE);
    expect(laboratoryPackageForActiveExercise("EX-LAB-UI")).toBe("NARVA_POLYTRAUMA");
  });

  test("submits LAB_ORDER and LAB_COLLECT only through the durable patient-command path", async () => {
    exercisePackageLoader.bind("EX-LAB-UI", NARVA_IRO_EXERCISE_PACKAGE);
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-LAB-UI", lifecycleState: "RUNNING",
      simulationTimeSec: 123, speed: 1, version: 1 });
    submit.mockResolvedValue({ status: "APPLIED", patientRevision: 3, commandSequence: 8 });
    const ordered = await submitLaboratoryOrder("PT-IRO-001", emptyWorkflow);
    const collected = await submitLaboratoryCollection("PT-IRO-001", "LAB-ORDER:COMMAND-1");
    expect(ordered.ok).toBe(true); expect(collected.ok).toBe(true);
    expect(submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ commandType: "LAB_ORDER",
      payload: { labPackageId: "NARVA_IRO_ASTRUP" } }));
    expect(submit).toHaveBeenNthCalledWith(2, expect.objectContaining({ commandType: "LAB_COLLECT",
      payload: { orderId: "LAB-ORDER:COMMAND-1" } }));
  });

  test("uses stable intent IDs so repeated taps remain idempotent until canonical projection advances", () => {
    const first = createLaboratoryOrderCommandId("EX", "PT", "NARVA_POLYTRAUMA", emptyWorkflow);
    expect(createLaboratoryOrderCommandId("EX", "PT", "NARVA_POLYTRAUMA", emptyWorkflow)).toBe(first);
    expect(createLaboratoryCollectCommandId("EX", "PT", "ORDER-1"))
      .toBe(createLaboratoryCollectCommandId("EX", "PT", "ORDER-1"));
  });

  test("terminal lifecycle disables order and collection before any durable submission", async () => {
    exercisePackageLoader.bind("EX-LAB-UI", NARVA_TRAUMA_EXERCISE_PACKAGE);
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-LAB-UI", lifecycleState: "COMPLETED",
      simulationTimeSec: 123, speed: 1, version: 2 });
    expect((await submitLaboratoryOrder("PT-1", emptyWorkflow)).ok).toBe(false);
    expect((await submitLaboratoryCollection("PT-1", "ORDER-1")).ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  test("classifies a missing server-side package binding without exposing its raw code", async () => {
    exercisePackageLoader.bind("EX-LAB-UI", NARVA_TRAUMA_EXERCISE_PACKAGE);
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-LAB-UI", lifecycleState: "RUNNING",
      simulationTimeSec: 123, speed: 1, version: 3 });
    submit.mockResolvedValue({ status: "LAB_PACKAGE_SCOPE_DENIED", patientRevision: 0 });
    const result = await submitLaboratoryOrder("PT-1", emptyWorkflow);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("LAB_PACKAGE_SCOPE_DENIED");
    expect(result.message).toContain("laboripakett ei ole serveris lubatud");
    expect(result.message).not.toContain("LAB_PACKAGE_SCOPE_DENIED");
  });
});
