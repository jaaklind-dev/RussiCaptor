import {
  findPatientById,
  getAllPatients,
  setPatientStatus,
} from "@/repositories/PatientRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import type { CaseManager } from "@/models/CaseManager";
import type { PatientAssignment } from "@/models/PatientAssignment";
import { currentCaseManager } from "@/services/CurrentUserService";

let assignments: PatientAssignment[] = [];

export type AssignmentResult =
  | { status: "assigned" | "already-assigned"; assignment: PatientAssignment }
  | { status: "assigned-to-other"; assignment: PatientAssignment }
  | { status: "unavailable" };

export function assignPatientToMe(patientId: string): AssignmentResult {
  return assignPatient(patientId, currentCaseManager);
}

export function assignPatient(
  patientId: string,
  caseManager: CaseManager
): AssignmentResult {

  const patient = findPatientById(patientId);

  if (
    !patient ||
    patient.status === "Completed" ||
    patient.status === "Transferred"
  ) {
    return { status: "unavailable" };
  }

  const existingAssignment = getPatientAssignment(patientId);

  if (existingAssignment && !existingAssignment.endedAt) {
    return existingAssignment.caseManagerId === caseManager.id
      ? { status: "already-assigned", assignment: existingAssignment }
      : { status: "assigned-to-other", assignment: existingAssignment };
  }

  const assignment: PatientAssignment = {
    patientId,
    caseManagerId: caseManager.id,
    caseManagerName: caseManager.name,
    assignedAt: new Date().toISOString(),
  };

  assignments.push(assignment);

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
    description: `Patsient määrati Case Managerile ${caseManager.name}.`,
    author: caseManager.name,
    visibility: "revealed",
  });

  notifySync();
  return { status: "assigned", assignment };
}

export function unassignPatient(
  patientId: string,
  endReason: PatientAssignment["endReason"] = "completed"
): void {
  const assignment = getPatientAssignment(patientId);

  if (assignment && !assignment.endedAt) {
    assignment.endedAt = new Date().toISOString();
    assignment.endReason = endReason;
  }
}

export function transferPatient(
  patientId: string,
  targetCaseManager: CaseManager
): boolean {
  const patient = findPatientById(patientId);
  const currentAssignment = getPatientAssignment(patientId);

  if (
    !patient ||
    patient.status !== "Active" ||
    !currentAssignment ||
    currentAssignment.endedAt ||
    currentAssignment.caseManagerId === targetCaseManager.id
  ) {
    return false;
  }

  const transferredAt = new Date().toISOString();
  currentAssignment.endedAt = transferredAt;
  currentAssignment.endReason = "transferred";
  currentAssignment.transferredToCaseManagerId = targetCaseManager.id;
  currentAssignment.transferredToCaseManagerName = targetCaseManager.name;

  assignments.push({
    patientId,
    caseManagerId: targetCaseManager.id,
    caseManagerName: targetCaseManager.name,
    assignedAt: transferredAt,
  });

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: transferredAt,
    type: "transfer",
    title: "Patsient üle antud",
    description: `Patsient anti üle: ${currentAssignment.caseManagerName} → ${targetCaseManager.name}.`,
    author: currentAssignment.caseManagerName,
    visibility: "revealed",
  });

  notifySync();
  return true;
}

export function getPatientAssignment(
  patientId: string
): PatientAssignment | undefined {
  return [...assignments]
    .reverse()
    .find((item) => item.patientId === patientId);
}

export function getMyPatients() {

  return assignments

    .filter((assignment) => assignment.caseManagerId === currentCaseManager.id)

    .filter((assignment) => !assignment.endedAt)

    .map((assignment) => findPatientById(assignment.patientId))

    .filter((patient) => patient !== undefined);

}

export function getDashboardStats() {

  const patients = getAllPatients();

  return {

    active: assignments.filter(
      (assignment) =>
        assignment.caseManagerId === currentCaseManager.id &&
        !assignment.endedAt &&
        findPatientById(assignment.patientId)?.status === "Active"
    ).length,

    incoming: patients.filter((patient) => patient.status === "Incoming").length,

    transferred: assignments.filter(
      (assignment) =>
        assignment.caseManagerId === currentCaseManager.id &&
        assignment.endReason === "transferred"
    ).length,

    completed: patients.filter((patient) => patient.status === "Completed").length,

  };

}

export function clearAssignments(): void {
  assignments = [];
}
