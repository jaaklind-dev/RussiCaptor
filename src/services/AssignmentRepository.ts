import {
  findPatientById,
  getAllPatients,
  setPatientStatus,
} from "@/repositories/PatientRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";

let assignedPatientIds: string[] = [];

export type AssignmentResult = "assigned" | "already-assigned" | "unavailable";

export function assignPatientToMe(patientId: string): AssignmentResult {

  const patient = findPatientById(patientId);

  if (
    !patient ||
    patient.status === "Completed" ||
    patient.status === "Transferred"
  ) {
    return "unavailable";
  }

  if (assignedPatientIds.includes(patientId)) {
    return "already-assigned";
  }

  assignedPatientIds.push(patientId);

  if (patient.status === "Incoming") {
    setPatientStatus(patientId, "Active");
  }

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: new Date().toISOString(),
    type: "assignment",
    title: "Patsient määratud Case Managerile",
    description: "Patsient määrati Case Manager Jaagule.",
    author: "Jaak",
    visibility: "revealed",
  });

  notifySync();
  return "assigned";
}

export function unassignPatient(patientId: string): void {
  assignedPatientIds = assignedPatientIds.filter((id) => id !== patientId);
}

export function getMyPatients() {

  return assignedPatientIds

    .map((patientId) => findPatientById(patientId))

    .filter((patient) => patient !== undefined);

}

export function getDashboardStats() {

  const patients = getAllPatients();

  return {

    active: assignedPatientIds.filter(
      (patientId) => findPatientById(patientId)?.status === "Active"
    ).length,

    incoming: patients.filter((patient) => patient.status === "Incoming").length,

    transferred: patients.filter((patient) => patient.status === "Transferred").length,

    completed: patients.filter((patient) => patient.status === "Completed").length,

  };

}

export function clearAssignments(): void {
  assignedPatientIds = [];
}
