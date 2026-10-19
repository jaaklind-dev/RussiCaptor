import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCurrentExercise, installCurrentExercise } from "@/repositories/ExerciseRepository";
import { exercisePackageRegistry, getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { activeScopedExerciseIds, getOperatorSession } from "@/services/authorization/OperatorSessionService";
import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";
import { RUNTIME_CONTINUITY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { setCurrentCaseManager } from "@/services/CurrentUserService";
import { assignPatient, clearAssignments, getPatientAssignment, releasePatientConflictSafe } from "@/services/AssignmentRepository";
import { findPatientById, resetPatients } from "@/repositories/PatientRepository";
import { getSharedWorkflowOperationalState, observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics, setSharedWorkflowConnectivity, setSharedWorkflowGateway, setSharedWorkflowRealtimeLifecycle } from "../SharedWorkflowMutationService";
import { InMemorySharedWorkflowGateway } from "../InMemorySharedWorkflowGateway";
import { armPhysicalValidationHarness, disarmPhysicalValidationHarness, isPhysicalValidationContextArmed, prepareSameBaseMutableMutation, submitPreparedPhysicalValidationMutation } from "../PhysicalValidationHarnessService";
import { capturePatientSharedWorkflowState } from "../PatientSharedWorkflowState";

jest.mock("@/services/authorization/OperatorSessionService", () => ({ ...jest.requireActual("@/services/authorization/OperatorSessionService"), getOperatorSession: jest.fn() }));
jest.mock("@/config/SharedWorkflowValidationHarness", () => ({ isSharedWorkflowValidationHarnessEnabled: jest.fn(() => true) }));
const patientId = "PT-PELVIC-001";
const beforeEnvironment = { release: process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT, enabled: process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS };

describe("physical shared-workflow validation harness", () => {
  beforeEach(() => {
    jest.mocked(isSharedWorkflowValidationHarnessEnabled).mockReturnValue(true);
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = "production"; process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = "1";
    installCurrentExercise("EX-TEST-HARNESS", "TEST", RUNTIME_CONTINUITY_EXERCISE_PACKAGE);
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-TEST-HARNESS", lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1, version: 1 });
    jest.mocked(getOperatorSession).mockReturnValue({ state: "AUTHENTICATED", profile: { userId: "CM-001", displayName: "Test" }, principal: {
      userId: "CM-001", authenticationState: "AUTHENTICATED", permissions: ["CM_WORKFLOW_WRITE"], authorizationFreshness: "VERIFIED_ONLINE",
      authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: "2026-01-01", expiresAt: "2099-01-01" },
      roleAssignments: [{ assignmentId: "ROLE", userId: "CM-001", role: "CM", scope: { scopeType: "EXERCISE", scopeId: "EX-TEST-HARNESS" }, status: "ACTIVE", issuedAt: "2026-01-01", issuedBy: "ADMIN" }],
    } });
    resetPatients(); clearAssignments(); resetSharedWorkflowConflictMetrics(); setSharedWorkflowConnectivity(true);
    const patient = findPatientById("PT-001")!; patient.id = patientId;
    setCurrentCaseManager({ id: "CM-001", name: "Jaak" });
    assignPatient(patientId, { id: "CM-001", name: "Jaak" });
    const gateway = new InMemorySharedWorkflowGateway(() => ({ userId: "CM-001", role: "CM", exerciseIds: [getCanonicalExerciseSnapshot().exerciseId] }));
    gateway.seed(getCanonicalExerciseSnapshot().exerciseId, patientId, capturePatientSharedWorkflowState(patientId), "CM-001", 1);
    observeSharedWorkflowHead(getCanonicalExerciseSnapshot().exerciseId, patientId, 1, "CM-001");
    setSharedWorkflowGateway(gateway);
    expect(getCurrentExercise().id).toBe("EX-TEST-HARNESS");
    expect(getCanonicalExerciseSnapshot().lifecycleState).toBe("RUNNING");
    expect(getExercisePackage("EX-TEST-HARNESS").packageHash).toBe(exercisePackageRegistry.require(RUNTIME_CONTINUITY_EXERCISE_PACKAGE.packageId, "1.0.0").packageHash);
    expect(activeScopedExerciseIds(getOperatorSession(), "CM")).toEqual(["EX-TEST-HARNESS"]);
    expect(getSharedWorkflowOperationalState().online).toBe(true);
    expect(armPhysicalValidationHarness("Samsung-A")).toBe(true);
  });
  afterEach(() => { setSharedWorkflowGateway(undefined); disarmPhysicalValidationHarness();
    if (beforeEnvironment.release === undefined) delete process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT; else process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = beforeEnvironment.release;
    if (beforeEnvironment.enabled === undefined) delete process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS; else process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = beforeEnvironment.enabled;
  });

  it("submits staged same-base proposals through normal CAS and accepts only one", async () => {
    const first = prepareSameBaseMutableMutation(patientId)!;
    const second = prepareSameBaseMutableMutation(patientId)!;
    expect(first.commandId).not.toBe(second.commandId);
    const outcomes = await Promise.all([submitPreparedPhysicalValidationMutation(first), submitPreparedPhysicalValidationMutation(second)]);
    expect(outcomes.map(item => item.result.status).sort()).toEqual(["APPLIED", "STALE_VERSION"]);
  });

  it("persists RELEASE through the authoritative path and prepares an unowned claim base", async () => {
    const outcome = await releasePatientConflictSafe(patientId);

    expect(outcome.result).toMatchObject({ status: "APPLIED", revision: 2, ownerUserId: undefined });
    expect(getPatientAssignment(patientId)?.endedAt).toBeDefined();
    expect(getPatientAssignment(patientId)?.endReason).toBe("released");
    expect(findPatientById(patientId)?.status).toBe("Active");
    expect(prepareSameBaseMutableMutation(patientId)).toBeUndefined();
  });

  it("keeps workflow unavailable until the subscribed channel has hydrated patient heads", () => {
    setSharedWorkflowConnectivity(false);
    setSharedWorkflowRealtimeLifecycle("SUBSCRIBED");
    expect(getSharedWorkflowOperationalState()).toMatchObject({ realtimeLifecycle: "SUBSCRIBED", online: false });
    setSharedWorkflowConnectivity(true);
    expect(getSharedWorkflowOperationalState()).toMatchObject({ realtimeLifecycle: "SUBSCRIBED", online: true });
  });

  it("canonical build remains disabled even with valid Auth and package", () => {
    jest.mocked(isSharedWorkflowValidationHarnessEnabled).mockReturnValue(false);
    expect(armPhysicalValidationHarness("Samsung-A")).toBe(false);
    expect(prepareSameBaseMutableMutation(patientId)).toBeUndefined();
  });

  it.each(["GLOBAL", "EXCON", "EXPIRED", "OTHER_SCOPE", "PROFILE"])("rejects an unsuitable operator: %s", variant => {
    const session = getOperatorSession(); if (session.state !== "AUTHENTICATED") throw Error("fixture");
    const assignment = session.principal.roleAssignments[0];
    jest.mocked(getOperatorSession).mockReturnValue({ ...session,
      profile: variant === "PROFILE" ? { ...session.profile, userId: "OTHER" } : session.profile,
      principal: { ...session.principal, roleAssignments: [{ ...assignment,
        role: variant === "EXCON" ? "EXCON" : "CM",
        scope: variant === "GLOBAL" ? { scopeType: "GLOBAL" } : { scopeType: "EXERCISE", scopeId: variant === "OTHER_SCOPE" ? "EX-OTHER" : "EX-TEST-HARNESS" },
        expiresAt: variant === "EXPIRED" ? "2000-01-01" : undefined,
      }] } });
    expect(armPhysicalValidationHarness("Samsung-A")).toBe(false);
  });

  it("leaving RUNNING and returning cannot resurrect prepared commands", async () => {
    const prepared = prepareSameBaseMutableMutation(patientId)!;
    replaceCanonicalExerciseSnapshot({ ...getCanonicalExerciseSnapshot(), lifecycleState: "PAUSED", version: 2 });
    expect(isPhysicalValidationContextArmed()).toBe(false);
    replaceCanonicalExerciseSnapshot({ ...getCanonicalExerciseSnapshot(), lifecycleState: "RUNNING", version: 3 });
    expect((await submitPreparedPhysicalValidationMutation(prepared)).result.status).toBe("AUTHORIZATION_DENIED");
  });
});
