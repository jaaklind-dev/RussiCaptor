import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { setCurrentCaseManager } from "@/services/CurrentUserService";
import { assignPatient, clearAssignments, getPatientAssignment, releasePatientConflictSafe } from "@/services/AssignmentRepository";
import { resetPatients } from "@/repositories/PatientRepository";
import { getSharedWorkflowOperationalState, observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics, setSharedWorkflowConnectivity, setSharedWorkflowGateway, setSharedWorkflowRealtimeLifecycle } from "../SharedWorkflowMutationService";
import { InMemorySharedWorkflowGateway } from "../InMemorySharedWorkflowGateway";
import { prepareSameBaseMutableMutation, submitPreparedPhysicalValidationMutation } from "../PhysicalValidationHarnessService";

describe("physical shared-workflow validation harness", () => {
  beforeEach(() => {
    resetPatients(); clearAssignments(); resetSharedWorkflowConflictMetrics(); setSharedWorkflowConnectivity(true);
    setCurrentCaseManager({ id: "CM-001", name: "Jaak" });
    assignPatient("PT-001", { id: "CM-001", name: "Jaak" });
    const gateway = new InMemorySharedWorkflowGateway(() => ({ userId: "CM-001", role: "CM", exerciseIds: [getCanonicalExerciseSnapshot().exerciseId] }));
    gateway.seed(getCanonicalExerciseSnapshot().exerciseId, "PT-001", { patient: { id: "PT-001" }, assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [], timelineEvents: [], interventions: [], medicationAdministrations: [], vitalSigns: [] }, "CM-001", 1);
    observeSharedWorkflowHead(getCanonicalExerciseSnapshot().exerciseId, "PT-001", 1, "CM-001");
    setSharedWorkflowGateway(gateway);
  });
  afterEach(() => setSharedWorkflowGateway(undefined));

  it("submits staged same-base proposals through normal CAS and accepts only one", async () => {
    const first = prepareSameBaseMutableMutation("PT-001")!;
    const second = prepareSameBaseMutableMutation("PT-001")!;
    expect(first.commandId).not.toBe(second.commandId);
    const outcomes = await Promise.all([submitPreparedPhysicalValidationMutation(first), submitPreparedPhysicalValidationMutation(second)]);
    expect(outcomes.map(item => item.result.status).sort()).toEqual(["APPLIED", "STALE_VERSION"]);
  });

  it("persists RELEASE through the authoritative path and prepares an unowned claim base", async () => {
    const outcome = await releasePatientConflictSafe("PT-001");

    expect(outcome.result).toMatchObject({ status: "APPLIED", revision: 2, ownerUserId: undefined });
    expect(getPatientAssignment("PT-001")?.endedAt).toBeDefined();
    expect(prepareSameBaseMutableMutation("PT-001")).toBeUndefined();
  });

  it("keeps workflow unavailable until the subscribed channel has hydrated patient heads", () => {
    setSharedWorkflowConnectivity(false);
    setSharedWorkflowRealtimeLifecycle("SUBSCRIBED");
    expect(getSharedWorkflowOperationalState()).toMatchObject({ realtimeLifecycle: "SUBSCRIBED", online: false });
    setSharedWorkflowConnectivity(true);
    expect(getSharedWorkflowOperationalState()).toMatchObject({ realtimeLifecycle: "SUBSCRIBED", online: true });
  });
});
