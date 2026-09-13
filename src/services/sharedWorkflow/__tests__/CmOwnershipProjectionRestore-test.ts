import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { CaseManager } from "@/models/CaseManager";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import {
  assignPatientToMeConflictSafe,
  beginCmOwnershipProjectionHydration,
  classifyCurrentCmPatientOwnership,
  completeCmOwnershipProjectionHydration,
  getAuthoritativePatientOwnershipProjection,
  getCmOwnershipProjectionReadiness,
  getMyPatients,
  getPatientAssignment,
  restoreAssignmentState,
  restoreAuthoritativePatientOwnershipProjection,
} from "@/services/AssignmentRepository";
import { setCurrentCaseManager } from "@/services/CurrentUserService";
import { resetExercise } from "@/services/ExerciseResetService";
import { updatePatientLocationFromCurrentCmConflictSafe } from "@/services/PatientLocationService";
import {
  buildClinicalTreatmentCommand,
  clinicalTreatmentMutationReadiness,
  submitClinicalTreatment,
} from "@/services/clinical/ClinicalTreatmentCommandService";
import { requireClinicalTreatmentDescriptor } from "@/services/clinical/ClinicalTreatmentCatalog";
import {
  setRuntimePatientCommandGateway,
  type RuntimePatientCommandGateway,
} from "@/services/runtime/commands/RuntimePatientCommandService";
import {
  acceptRuntimeReaderCheckpoint,
  advertiseRuntimeReaderCheckpoint,
  beginRuntimeReaderConvergence,
  resetRuntimeReaderConvergence,
} from "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import {
  InMemorySharedWorkflowGateway,
} from "@/services/sharedWorkflow/InMemorySharedWorkflowGateway";
import {
  getSharedWorkflowHead,
  observeSharedWorkflowHead,
  resetSharedWorkflowConflictMetrics,
  setSharedWorkflowConnectivity,
  setSharedWorkflowGateway,
} from "@/services/sharedWorkflow/SharedWorkflowMutationService";

const exerciseId = "EX-CM-OWNERSHIP-RESTORE";
const patientId = "PT-001";
const cmA: CaseManager = Object.freeze({ id: "CM-A", name: "CM A" });
const cmB: CaseManager = Object.freeze({ id: "CM-B", name: "CM B" });
const assignedAt = "2026-09-13T12:00:00.000Z";
const assignment = (owner = cmA) => Object.freeze({ patientId, caseManagerId: owner.id,
  caseManagerName: owner.name, assignedAt });

function acceptOwnership(revision = 2, owner = cmA): void {
  expect(restoreAuthoritativePatientOwnershipProjection({ exerciseId, patientId, revision,
    ownerUserId: owner.id, assignments: [assignment(owner)], transfers: [] })).toBe(true);
  observeSharedWorkflowHead(exerciseId, patientId, revision, owner.id);
}

const checkpoint = (revision: number, simulationTimeSec: number) => ({
  exerciseId,
  checkpointRevision: revision,
  payloadHash: `HASH-${revision}`,
  provenanceHash: `PROVENANCE-${revision}`,
  persistedRuntimeVersion: 1,
  payload: { exerciseSession: { exerciseId, lifecycleState: "RUNNING", simulationTimeSec,
    speed: 1, version: revision, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 } },
}) as RuntimeCheckpointEnvelope<SharedExerciseState>;

describe("WP-NARVA-10B17 authoritative CM ownership restore", () => {
  const exerciseBefore = getCanonicalExerciseSnapshot();

  beforeEach(() => {
    resetExercise();
    setCurrentCaseManager(cmA);
    replaceCanonicalExerciseSnapshot({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 728,
      speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    resetSharedWorkflowConflictMetrics();
    setSharedWorkflowConnectivity(true);
    setRuntimePatientCommandGateway(undefined);
    setRuntimeWriterAuthorityState("READER");
  });

  afterEach(() => {
    setSharedWorkflowGateway(undefined);
    setRuntimePatientCommandGateway(undefined);
    resetRuntimeReaderConvergence();
    resetSharedWorkflowConflictMetrics();
    setRuntimeWriterAuthorityState("UNRESOLVED");
    resetExercise();
    replaceCanonicalExerciseSnapshot(exerciseBefore);
  });

  test("rebuilds Minu patsiendid and survives a later stale checkpoint projection", async () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    acceptOwnership();
    expect(completeCmOwnershipProjectionHydration(exerciseId)).toBe(true);
    expect(getMyPatients().map(patient => patient.id)).toEqual([patientId]);

    // Runtime hydration may arrive after the workflow fetch. It cannot erase
    // the newer authoritative ownership overlay.
    restoreAssignmentState({ assignments: [], transfers: [] });
    expect(getPatientAssignment(patientId)).toMatchObject({ caseManagerId: cmA.id });
    expect(getMyPatients().map(patient => patient.id)).toEqual([patientId]);
    expect(classifyCurrentCmPatientOwnership(patientId)).toBe("SELF");

    const opened = await assignPatientToMeConflictSafe(patientId);
    expect(opened.result).toMatchObject({ status: "IDEMPOTENT", revision: 2, ownerUserId: cmA.id });
    expect(opened.value).toMatchObject({ status: "already-assigned" });
    await expect(updatePatientLocationFromCurrentCmConflictSafe(patientId)).resolves.toMatchObject({
      result: { status: "IDEMPOTENT", revision: 2 }, value: false,
    });
    expect(getAuthoritativePatientOwnershipProjection(exerciseId, patientId)?.revision).toBe(2);
  });

  test("fences scan and treatment mutation while authoritative ownership is unresolved", async () => {
    const gateway: RuntimePatientCommandGateway = { submit: jest.fn(),
      loadAfter: jest.fn(async () => Object.freeze([])), record: jest.fn(async () => undefined) };
    setRuntimePatientCommandGateway(gateway);
    restoreAssignmentState({ assignments: [assignment(cmB)], transfers: [] });
    beginCmOwnershipProjectionHydration(exerciseId);
    expect(getMyPatients()).toEqual([]);
    expect(getCmOwnershipProjectionReadiness(exerciseId)).toEqual({ managed: true, ready: false });
    expect(clinicalTreatmentMutationReadiness(exerciseId, patientId)).toMatchObject({ ready: false });
    await expect(assignPatientToMeConflictSafe(patientId)).resolves.toMatchObject({
      result: { status: "RECONNECT_REQUIRED" }, value: undefined,
    });
    expect(gateway.submit).not.toHaveBeenCalled();
  });

  test("keeps other-CM ownership fail-closed and never issues a duplicate claim", async () => {
    const submit = jest.fn();
    setSharedWorkflowGateway({ submit });
    beginCmOwnershipProjectionHydration(exerciseId);
    acceptOwnership(4, cmB);
    completeCmOwnershipProjectionHydration(exerciseId);
    expect(getMyPatients()).toEqual([]);
    expect(classifyCurrentCmPatientOwnership(patientId)).toBe("OTHER_CM");
    const outcome = await assignPatientToMeConflictSafe(patientId);
    expect(outcome.result.status).toBe("ALREADY_OWNED");
    expect(outcome.value).toMatchObject({ status: "assigned-to-other",
      assignment: { caseManagerId: cmB.id } });
    expect(submit).not.toHaveBeenCalled();
  });

  test("preserves the unowned claim path and advances ownership once", async () => {
    const gateway = new InMemorySharedWorkflowGateway(() => ({ userId: cmA.id, role: "CM", exerciseIds: [exerciseId] }));
    setSharedWorkflowGateway(gateway);
    beginCmOwnershipProjectionHydration(exerciseId);
    completeCmOwnershipProjectionHydration(exerciseId);
    const outcome = await assignPatientToMeConflictSafe(patientId);
    expect(outcome.result).toMatchObject({ status: "APPLIED", revision: 1, ownerUserId: cmA.id });
    expect(getPatientAssignment(patientId)).toMatchObject({ caseManagerId: cmA.id });
    expect(getSharedWorkflowHead(exerciseId, patientId)).toMatchObject({ revision: 1, ownerUserId: cmA.id });
  });

  test("role reactivation and foreground replacement keep the latest owner without revision bumps", () => {
    beginCmOwnershipProjectionHydration(exerciseId);
    acceptOwnership(2, cmA);
    completeCmOwnershipProjectionHydration(exerciseId);

    // A temporary role/session loss starts a new read-only reconciliation.
    beginCmOwnershipProjectionHydration(exerciseId);
    expect(getMyPatients().map(patient => patient.id)).toEqual([patientId]);
    acceptOwnership(2, cmA);
    completeCmOwnershipProjectionHydration(exerciseId);
    expect(getMyPatients().map(patient => patient.id)).toEqual([patientId]);
    expect(getAuthoritativePatientOwnershipProjection(exerciseId, patientId)?.revision).toBe(2);

    // Realtime transfer to CM-B wins and a stale foreground cache cannot undo it.
    expect(restoreAuthoritativePatientOwnershipProjection({ exerciseId, patientId, revision: 3,
      ownerUserId: cmB.id, assignments: [assignment(cmB)], transfers: [] })).toBe(true);
    restoreAssignmentState({ assignments: [assignment(cmA)], transfers: [] });
    expect(getPatientAssignment(patientId)).toMatchObject({ caseManagerId: cmB.id });
    expect(getMyPatients()).toEqual([]);
    expect(restoreAuthoritativePatientOwnershipProjection({ exerciseId, patientId, revision: 2,
      ownerUserId: cmA.id, assignments: [assignment(cmA)], transfers: [] })).toBe(false);
    expect(getPatientAssignment(patientId)).toMatchObject({ caseManagerId: cmB.id });
  });

  test("combines reader-time and ownership readiness before a durable clinical command", async () => {
    const submit = jest.fn(async () => Object.freeze({ status: "APPLIED" as const,
      commandSequence: 31, patientRevision: 9, ownerUserId: cmA.id }));
    const gateway: RuntimePatientCommandGateway = { submit,
      loadAfter: jest.fn(async () => Object.freeze([])), record: jest.fn(async () => undefined) };
    setRuntimePatientCommandGateway(gateway);
    beginCmOwnershipProjectionHydration(exerciseId);
    acceptOwnership(2, cmA);
    completeCmOwnershipProjectionHydration(exerciseId);
    beginRuntimeReaderConvergence(exerciseId);
    const remote = checkpoint(26, 2622);
    advertiseRuntimeReaderCheckpoint({ exerciseId, checkpointRevision: 26, payloadHash: remote.payloadHash,
      provenanceHash: remote.provenanceHash, writerInstanceId: "WRITER-EMULATOR" });
    expect(clinicalTreatmentMutationReadiness(exerciseId, patientId)).toMatchObject({ ready: false });
    acceptRuntimeReaderCheckpoint(remote, "REMOTE");
    expect(clinicalTreatmentMutationReadiness(exerciseId, patientId)).toEqual({ ready: true });

    const descriptor = requireClinicalTreatmentDescriptor("RINGER");
    const built = buildClinicalTreatmentCommand(descriptor,
      { mode: "BOLUS", volumeMl: "500", rateMlHour: "1000", vascularAccessId: "IV-1" },
      { patientId, simulationTimeSec: 2622, commandId: "TREATMENT-CURRENT",
        instanceId: "TREATMENT-INSTANCE-CURRENT", action: "START" });
    if (!built.ok) throw new Error(built.errors.join(","));
    await expect(submitClinicalTreatment(exerciseId, patientId, "RINGER", built.command))
      .resolves.toMatchObject({ status: "APPLIED" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ simulationTimeSec: 2622,
      patientBaseRevision: 2 }));
  });
});
