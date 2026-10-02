import { dataProvider, clinicalDataProvider } from "@/providers/ProviderFactory";
import { getPatientAssignment, restoreAssignmentState } from "@/services/AssignmentRepository";
import { resetExercise } from "@/services/ExerciseResetService";
import { addTimelineEvent, getTimelineEvents } from "@/repositories/TimelineRepository";
import {
  capturePatientSharedWorkflowState,
  reconcileAuthoritativePatientSharedWorkflowState,
} from "../PatientSharedWorkflowState";

const exerciseId = "EX-WF-CANONICAL";
const patientId = "PT-PELVIC-001";
const patient = (location: string) => ({ id: patientId, isikukood: patientId, name: patientId,
  triage: "P1" as const, status: "Active" as const, location, lastSeen: "T+0",
  mist: { mechanism: "Trauma", injuries: "", signs: "", treatment: "" } });

describe("SHARED-WORKFLOW-EQUAL-REVISION-CANONICAL-RECONCILIATION-01", () => {
  beforeEach(() => {
    resetExercise();
    dataProvider.installPatients([patient("NARVA_ED")]);
    restoreAssignmentState({ assignments: [], transfers: [] });
    addTimelineEvent({ id: "TL-INTERNAL-TRANSFER-CMD-1", exerciseId, patientId,
      timestamp: "T+120s", simulationTimeSec: 120, type: "transfer", title: "P01-MOVE-ED",
      description: "NARVA_HOSPITAL_OUTDOOR → NARVA_ED", author: "Runtime", visibility: "revealed" });
  });

  afterEach(() => resetExercise());

  test("WF-CAN-G01/G02/G03/G05/G06/G08: stale equal-revision head contributes ownership only", () => {
    const canonical = capturePatientSharedWorkflowState(patientId);
    const stale = { ...canonical, patient: patient("NARVA_HOSPITAL_OUTDOOR"), timelineEvents: [] };
    const result = reconcileAuthoritativePatientSharedWorkflowState({ exerciseId, patientId,
      revision: 2, state: stale, preserveCanonicalRuntime: true });
    expect(result).toEqual({ accepted: true, mode: "OWNERSHIP_ONLY",
      conflicts: ["patient.location", "timelineEvents"] });
    expect(dataProvider.getPatientById(patientId)?.location).toBe("NARVA_ED");
    expect(getTimelineEvents(patientId).map(item => item.id)).toEqual(["TL-INTERNAL-TRANSFER-CMD-1"]);
  });

  test("WF-CAN-G07: ownership advances without replacing canonical Runtime fields", () => {
    const canonical = capturePatientSharedWorkflowState(patientId);
    const assignment = { patientId, caseManagerId: "CM-B", caseManagerName: "CM B",
      assignedAt: "2026-10-02T08:00:00.000Z" };
    const result = reconcileAuthoritativePatientSharedWorkflowState({ exerciseId, patientId,
      revision: 3, ownerUserId: "CM-B", state: { ...canonical, assignments: [assignment],
        patient: patient("NARVA_HOSPITAL_OUTDOOR"), timelineEvents: [] }, preserveCanonicalRuntime: true });
    expect(result.mode).toBe("OWNERSHIP_ONLY");
    expect(getPatientAssignment(patientId)).toMatchObject({ caseManagerId: "CM-B" });
    expect(dataProvider.getPatientById(patientId)?.location).toBe("NARVA_ED");
    expect(getTimelineEvents(patientId)).toHaveLength(1);
  });

  test("WF-CAN-G09/G10/G11: accepted local mutation may advance once and repeated hydration is idempotent", () => {
    const proposed = capturePatientSharedWorkflowState(patientId);
    clinicalDataProvider.getTimelineEvents().push({ ...proposed.timelineEvents[0], id: "TL-NEW" } as never);
    const advanced = capturePatientSharedWorkflowState(patientId);
    const first = reconcileAuthoritativePatientSharedWorkflowState({ exerciseId, patientId,
      revision: 4, state: advanced, allowRuntimeAdvance: true });
    const second = reconcileAuthoritativePatientSharedWorkflowState({ exerciseId, patientId,
      revision: 4, state: advanced, preserveCanonicalRuntime: true });
    expect(first.mode).toBe("FULL_SHARED_WORKFLOW");
    expect(second.mode).toBe("OWNERSHIP_ONLY");
    expect(getTimelineEvents(patientId).map(item => item.id)).toEqual([
      "TL-INTERNAL-TRANSFER-CMD-1", "TL-NEW",
    ]);
  });
});
