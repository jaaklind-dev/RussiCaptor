import type { InstructorPatientInspectorModel } from "@/models/InstructorPatientInspector";
import { getImagingStudies } from "@/repositories/ImagingRepository";
import { getLabResults } from "@/repositories/LabRepository";
import { getMedicationAdministrations } from "@/repositories/MedicationRepository";
import { getNotes } from "@/repositories/NoteRepository";
import { getOrders } from "@/repositories/OrderRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import { getInterventions } from "@/repositories/InterventionRepository";
import { getPatientAssignment } from "@/services/AssignmentRepository";
import {
  getInstructorDashboardVersion, subscribeToInstructorDashboard,
} from "@/services/InstructorDashboardService";
import {
  getResourceRuntimeDebugSnapshot, getResourceRuntimeDebugVersion, subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";
import {
  getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots,
} from "@/services/RuntimeSnapshotService";
import { projectInstructorPatientInspector } from "@/services/runtime/selectors/InstructorPatientInspectorSelector";

let cachedKey = "";
let cachedModel: InstructorPatientInspectorModel | undefined;

export function getInstructorPatientInspector(patientId: string): InstructorPatientInspectorModel | undefined {
  const key = `${patientId}:${getInstructorPatientInspectorVersion()}`;
  if (cachedModel && cachedKey === key) return cachedModel;
  const patient = findPatientById(patientId);
  if (!patient) return undefined;
  const runtimeDebug = getResourceRuntimeDebugSnapshot();
  const activeEffects = [
    ...(runtimeDebug.clinicalInterventions ?? [])
      .filter(item => item.patientId === patientId && item.status === "RUNNING")
      .map(item => ({ id: item.instanceId, name: item.definitionName, source: "Intervention" })),
    ...(runtimeDebug.medicationState?.effects ?? [])
      .filter(item => item.patientId === patientId)
      .map(item => ({ id: item.effectId, name: item.effectType.replaceAll("_", " "), source: "Medication" })),
  ];
  cachedModel = projectInstructorPatientInspector({
    patient, assignment: getPatientAssignment(patientId),
    runtime: getCanonicalPatientRuntimeSnapshot(patientId), activeEffects,
    timeline: getTimelineEvents(patientId), interventions: getInterventions(patientId),
    medications: getMedicationAdministrations(patientId), labs: getLabResults(patientId),
    imaging: getImagingStudies(patientId), orders: getOrders(patientId), notes: getNotes(patientId),
  });
  cachedKey = key;
  return cachedModel;
}

export function getInstructorPatientInspectorVersion(): string {
  return `${getInstructorDashboardVersion()}:${getResourceRuntimeDebugVersion()}:${getRuntimeSnapshotVersion()}`;
}

export function subscribeToInstructorPatientInspector(listener: () => void): () => void {
  const stopDashboard = subscribeToInstructorDashboard(listener);
  const stopRuntimeDetails = subscribeToResourceRuntimeDebug(listener);
  const stopCanonicalRuntime = subscribeToRuntimeSnapshots(listener);
  return () => { stopDashboard(); stopRuntimeDetails(); stopCanonicalRuntime(); };
}
