import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { findPatientById, resetPatients } from "@/repositories/PatientRepository";
import { assignPatient, assignPatientToMeConflictSafe, clearAssignments, getPatientAssignment,
  releasePatientConflictSafe } from "@/services/AssignmentRepository";
import { setCurrentCaseManager } from "@/services/CurrentUserService";
import { InMemorySharedWorkflowGateway } from "../InMemorySharedWorkflowGateway";
import { getSharedWorkflowHead, observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics,
  setSharedWorkflowConnectivity, setSharedWorkflowGateway } from "../SharedWorkflowMutationService";

const patientId = "PT-001";
const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
const owner = { id: "CM-RELEASE-OWNER", name: "Owner" };
const initialState = () => ({ patient: { id: patientId }, assignments: [], transfers: [],
  questions: [], labs: [], imagingStudies: [], orders: [], notes: [], timelineEvents: [],
  interventions: [], medicationAdministrations: [], vitalSigns: [] });

describe("production patient ownership release", () => {
  let gateway: InMemorySharedWorkflowGateway;
  let actorId: string;

  beforeEach(() => {
    resetPatients(); clearAssignments(); resetSharedWorkflowConflictMetrics();
    setSharedWorkflowConnectivity(true);
    actorId = owner.id;
    setCurrentCaseManager(owner);
    assignPatient(patientId, owner);
    gateway = new InMemorySharedWorkflowGateway(() => ({ userId: actorId, role: "CM",
      exerciseIds: [exerciseId] }));
    gateway.seed(exerciseId, patientId, initialState(), owner.id, 1);
    observeSharedWorkflowHead(exerciseId, patientId, 1, owner.id);
    setSharedWorkflowGateway(gateway);
  });
  afterEach(() => setSharedWorkflowGateway(undefined));

  it("releases only ownership, without completing the active patient", async () => {
    const result = await releasePatientConflictSafe(patientId);
    expect(result.result.status).toBe("APPLIED");
    expect(getSharedWorkflowHead(exerciseId, patientId).ownerUserId).toBeUndefined();
    expect(getPatientAssignment(patientId)).toMatchObject({ endReason: "released",
      endedAt: expect.any(String) });
    expect(findPatientById(patientId)?.status).toBe("Active");
  });

  it("returns idempotently after a confirmed release without another mutation", async () => {
    expect((await releasePatientConflictSafe(patientId)).result.status).toBe("APPLIED");
    const revision = getSharedWorkflowHead(exerciseId, patientId).revision;
    expect((await releasePatientConflictSafe(patientId)).result.status).toBe("IDEMPOTENT");
    expect(getSharedWorkflowHead(exerciseId, patientId).revision).toBe(revision);
  });

  it("rejects a non-owner and preserves the owner's assignment", async () => {
    actorId = "CM-OTHER";
    setCurrentCaseManager({ id: actorId, name: "Other" });
    const result = await releasePatientConflictSafe(patientId);
    expect(result.result.status).toBe("NOT_OWNER");
    expect(getSharedWorkflowHead(exerciseId, patientId).ownerUserId).toBe(owner.id);
    expect(getPatientAssignment(patientId)?.endedAt).toBeUndefined();
  });

  it("fails closed while disconnected", async () => {
    setSharedWorkflowConnectivity(false);
    expect((await releasePatientConflictSafe(patientId)).result.status).toBe("RECONNECT_REQUIRED");
    expect(getPatientAssignment(patientId)?.endedAt).toBeUndefined();
  });

  it("leaves the released active patient available for another supported claim", async () => {
    expect((await releasePatientConflictSafe(patientId)).result.status).toBe("APPLIED");
    expect((await assignPatientToMeConflictSafe(patientId)).result.status).toBe("APPLIED");
    expect(getPatientAssignment(patientId)?.endedAt).toBeUndefined();
    expect(findPatientById(patientId)?.status).toBe("Active");
  });

  it("cannot submit a release to an exercise outside the actor's scope", async () => {
    const result = await gateway.submit({ exerciseId: "EX-UNRELATED", patientId,
      commandId: "RELEASE-WRONG-EXERCISE", kind: "RELEASE", expectedRevision: 1,
      expectedOwnerUserId: owner.id, nextOwnerUserId: undefined, state: initialState() });
    expect(result.status).toBe("AUTHORIZATION_DENIED");
    expect(getSharedWorkflowHead(exerciseId, patientId).ownerUserId).toBe(owner.id);
  });
});
