import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { dataProvider } from "@/providers/ProviderFactory";
import { assignPatient, assignPatientToMeConflictSafe, beginCmOwnershipProjectionHydration,
  classifyCurrentCmPatientOwnership, clearAssignments, completeCmOwnershipProjectionHydration,
  getCmOwnershipProjectionReadiness, getPatientAssignment, releasePatientConflictSafe,
  restoreAuthoritativePatientOwnershipProjection, setCmOwnershipProjectionRefresh } from "@/services/AssignmentRepository";
import { setCurrentCaseManager } from "@/services/CurrentUserService";
import { resetExercise } from "@/services/ExerciseResetService";
import { InMemorySharedWorkflowGateway } from "@/services/sharedWorkflow/InMemorySharedWorkflowGateway";
import { getSharedWorkflowHead, observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics,
  setSharedWorkflowConnectivity, setSharedWorkflowGateway } from "@/services/sharedWorkflow/SharedWorkflowMutationService";

const exerciseId = "EX-OWNERSHIP-CONVERGENCE";
const patientA = "PT-001";
const patientB = "PT-002";
const cm = { id: "CM-CONVERGENCE", name: "CM Convergence" };
const patient = (id: string) => ({ id, isikukood: id, name: id, triage: "P1" as const,
  status: "Active" as const, location: "EMO", lastSeen: "T+0",
  mist: { mechanism: "Test", injuries: "", signs: "", treatment: "" } });

describe("CM ownership projection convergence after release", () => {
  const original = getCanonicalExerciseSnapshot();
  let gateway: InMemorySharedWorkflowGateway;

  beforeEach(() => {
    resetExercise();
    clearAssignments();
    resetSharedWorkflowConflictMetrics();
    setCurrentCaseManager(cm);
    replaceCanonicalExerciseSnapshot({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 1,
      speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    dataProvider.installPatients([patient(patientA), patient(patientB)]);
    setSharedWorkflowConnectivity(true);
    gateway = new InMemorySharedWorkflowGateway(() => ({ userId: cm.id, role: "CM", exerciseIds: [exerciseId] }));
    setSharedWorkflowGateway(gateway);
  });

  afterEach(() => {
    setCmOwnershipProjectionRefresh(undefined);
    setSharedWorkflowGateway(undefined);
    resetSharedWorkflowConflictMetrics();
    resetExercise();
    replaceCanonicalExerciseSnapshot(original);
  });

  function installReleasedProjection(): void {
    const released = getPatientAssignment(patientA);
    expect(released?.endedAt).toBeDefined();
    expect(restoreAuthoritativePatientOwnershipProjection({ exerciseId, patientId: patientA,
      revision: getSharedWorkflowHead(exerciseId, patientA).revision, ownerUserId: undefined,
      assignments: released ? [released] : [], transfers: [] })).toBe(true);
    expect(restoreAuthoritativePatientOwnershipProjection({ exerciseId, patientId: patientB,
      revision: 0, ownerUserId: undefined, assignments: [], transfers: [] })).toBe(true);
    observeSharedWorkflowHead(exerciseId, patientB, 0);
    expect(completeCmOwnershipProjectionHydration(exerciseId)).toBe(true);
  }

  async function releaseA(): Promise<void> {
    assignPatient(patientA, cm);
    gateway.seed(exerciseId, patientA, { patient: { id: patientA },
      assignments: [{ ...getPatientAssignment(patientA) }], transfers: [], questions: [], labs: [],
      imagingStudies: [], orders: [], notes: [], timelineEvents: [], interventions: [],
      medicationAdministrations: [], vitalSigns: [] }, cm.id, 1);
    observeSharedWorkflowHead(exerciseId, patientA, 1, cm.id);
    expect((await releasePatientConflictSafe(patientA)).result.status).toBe("APPLIED");
    expect(getSharedWorkflowHead(exerciseId, patientA).ownerUserId).toBeUndefined();
  }

  test("OWNERSHIP-PROJ-01 release ACK and canonical no-owner converge", async () => {
    await releaseA();
    beginCmOwnershipProjectionHydration(exerciseId);
    installReleasedProjection();
    expect(classifyCurrentCmPatientOwnership(patientA)).toBe("UNOWNED");
    expect(getCmOwnershipProjectionReadiness(exerciseId).ready).toBe(true);
  });

  test("OWNERSHIP-PROJ-02 next patient assignment succeeds after bounded refresh", async () => {
    await releaseA();
    beginCmOwnershipProjectionHydration(exerciseId);
    const refresh = jest.fn(async () => { installReleasedProjection(); return "READY" as const; });
    setCmOwnershipProjectionRefresh(refresh);
    expect((await assignPatientToMeConflictSafe(patientB)).result.status).toBe("APPLIED");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getPatientAssignment(patientB)?.caseManagerId).toBe(cm.id);
  });

  test("OWNERSHIP-PROJ-03 stale prior owner cannot replace newer no-owner", async () => {
    await releaseA();
    beginCmOwnershipProjectionHydration(exerciseId);
    installReleasedProjection();
    expect(restoreAuthoritativePatientOwnershipProjection({ exerciseId, patientId: patientA,
      revision: 1, ownerUserId: cm.id, assignments: [{ patientId: patientA,
        caseManagerId: cm.id, caseManagerName: cm.name, assignedAt: "2026-10-10T00:00:00Z" }],
      transfers: [] })).toBe(false);
    expect(classifyCurrentCmPatientOwnership(patientA)).toBe("UNOWNED");
  });

  test("OWNERSHIP-PROJ-04 unresolved claim reads canonical state at most once", async () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    const refresh = jest.fn(async () => { installReleasedProjectionWithoutA(); return "READY" as const; });
    setCmOwnershipProjectionRefresh(refresh);
    expect((await assignPatientToMeConflictSafe(patientB)).result.status).toBe("APPLIED");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  function installReleasedProjectionWithoutA(): void {
    expect(restoreAuthoritativePatientOwnershipProjection({ exerciseId, patientId: patientB,
      revision: 0, ownerUserId: undefined, assignments: [], transfers: [] })).toBe(true);
    expect(completeCmOwnershipProjectionHydration(exerciseId)).toBe(true);
  }

  test("OWNERSHIP-PROJ-05 network failure remains retryable without a claim", async () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    const refresh = jest.fn(async () => "NETWORK_UNAVAILABLE" as const);
    setCmOwnershipProjectionRefresh(refresh);
    const result = await assignPatientToMeConflictSafe(patientB);
    expect(result.result.status).toBe("RECONNECT_REQUIRED");
    expect(result.message).toContain("võrguühendus");
    expect(gateway.acceptedCount(exerciseId)).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("OWNERSHIP-PROJ-06 authorization denial fails closed", async () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    setCmOwnershipProjectionRefresh(async () => {
      installReleasedProjectionWithoutA();
      return "AUTHORIZATION_DENIED";
    });
    const result = await assignPatientToMeConflictSafe(patientB);
    expect(result.result.status).toBe("AUTHORIZATION_DENIED");
    expect(result.value).toBeUndefined();
    expect(result.message).toContain("õigus");
    expect(gateway.acceptedCount(exerciseId)).toBe(0);
  });

  test("OWNERSHIP-PROJ-07 another exercise cannot satisfy this projection", async () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    setCmOwnershipProjectionRefresh(async () => {
      restoreAuthoritativePatientOwnershipProjection({ exerciseId: "EX-OTHER", patientId: patientB,
        revision: 1, ownerUserId: undefined, assignments: [], transfers: [] });
      return "READY";
    });
    expect((await assignPatientToMeConflictSafe(patientB)).result.status).toBe("RECONNECT_REQUIRED");
    expect(gateway.acceptedCount(exerciseId)).toBe(0);
  });

  test("OWNERSHIP-PROJ-08 exercise/session change discards the refresh result", async () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    setCmOwnershipProjectionRefresh(async () => {
      replaceCanonicalExerciseSnapshot({ exerciseId: "EX-OTHER", lifecycleState: "RUNNING", simulationTimeSec: 1,
        speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
      return "READY";
    });
    expect((await assignPatientToMeConflictSafe(patientB)).result.status).toBe("RECONNECT_REQUIRED");
    expect(gateway.acceptedCount(exerciseId)).toBe(0);
  });

  test("OWNERSHIP-PROJ-09 release remains idempotent", async () => {
    await releaseA();
    const revision = getSharedWorkflowHead(exerciseId, patientA).revision;
    expect((await releasePatientConflictSafe(patientA)).result.status).toBe("IDEMPOTENT");
    expect(getSharedWorkflowHead(exerciseId, patientA).revision).toBe(revision);
  });

  test("OWNERSHIP-PROJ-10 syncing message is distinct from network loss", async () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    setCmOwnershipProjectionRefresh(async () => "UNAVAILABLE");
    const result = await assignPatientToMeConflictSafe(patientB);
    expect(result.result.status).toBe("RECONNECT_REQUIRED");
    expect(result.message).toContain("andmed ei ole veel valmis");
    expect(result.message).not.toContain("võrguühendus");
  });
});
