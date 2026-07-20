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
import type { PatientTransfer } from "@/models/PatientTransfer";
import { getCurrentCaseManager } from "@/services/CurrentUserService";

let assignments: PatientAssignment[] = [];
let transfers: PatientTransfer[] = [];

export type AssignmentResult =
  | { status: "assigned" | "already-assigned"; assignment: PatientAssignment }
  | { status: "assigned-to-other"; assignment: PatientAssignment }
  | { status: "unavailable" };

export function assignPatientToMe(patientId: string): AssignmentResult {
  return assignPatient(patientId, getCurrentCaseManager());
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

  const pendingTransfer = getPendingPatientTransfer(patientId);
  if (pendingTransfer) {
    pendingTransfer.status = "cancelled";
    pendingTransfer.cancelledAt = new Date().toISOString();
  }
}

export function requestPatientTakeover(
  patientId: string,
  requestingCaseManager: CaseManager
): boolean {
  const patient = findPatientById(patientId);
  const currentAssignment = getPatientAssignment(patientId);

  if (
    !patient ||
    patient.status !== "Active" ||
    !currentAssignment ||
    currentAssignment.endedAt ||
    currentAssignment.caseManagerId === requestingCaseManager.id ||
    Boolean(getPendingPatientTransfer(patientId))
  ) {
    return false;
  }

  const requestedAt = new Date().toISOString();
  transfers.push({
    id: createId("TRANSFER"),
    patientId,
    fromCaseManagerId: currentAssignment.caseManagerId,
    fromCaseManagerName: currentAssignment.caseManagerName,
    toCaseManagerId: requestingCaseManager.id,
    toCaseManagerName: requestingCaseManager.name,
    status: "pending",
    requestedAt,
  });

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: requestedAt,
    type: "transfer",
    title: "Ülevõtmistaotlus saadetud",
    description: `${requestingCaseManager.name} taotles patsiendi ülevõtmist CM-ilt ${currentAssignment.caseManagerName}.`,
    author: requestingCaseManager.name,
    visibility: "revealed",
  });

  notifySync();
  return true;
}

export function acceptPatientTransfer(
  patientId: string,
  approvingCaseManager: CaseManager
): boolean {
  const transfer = getPendingPatientTransfer(patientId);
  const currentAssignment = getPatientAssignment(patientId);
  const patient = findPatientById(patientId);

  if (
    !patient ||
    patient.status !== "Active" ||
    !transfer ||
    transfer.fromCaseManagerId !== approvingCaseManager.id ||
    !currentAssignment ||
    currentAssignment.endedAt ||
    currentAssignment.caseManagerId !== transfer.fromCaseManagerId
  ) {
    return false;
  }

  const acceptedAt = new Date().toISOString();
  transfer.status = "accepted";
  transfer.acceptedAt = acceptedAt;
  currentAssignment.endedAt = acceptedAt;
  currentAssignment.endReason = "transferred";
  currentAssignment.transferredToCaseManagerId = transfer.toCaseManagerId;
  currentAssignment.transferredToCaseManagerName = transfer.toCaseManagerName;

  assignments.push({
    patientId,
    caseManagerId: transfer.toCaseManagerId,
    caseManagerName: transfer.toCaseManagerName,
    assignedAt: acceptedAt,
  });

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: acceptedAt,
    type: "transfer",
    title: "Patsiendi üleandmine vastu võetud",
    description: `Patsient anti üle: ${currentAssignment.caseManagerName} → ${transfer.toCaseManagerName}.`,
    author: approvingCaseManager.name,
    visibility: "revealed",
  });

  notifySync();
  return true;
}

export function rejectPatientTransfer(
  patientId: string,
  rejectingCaseManager: CaseManager
): boolean {
  const transfer = getPendingPatientTransfer(patientId);
  const currentAssignment = getPatientAssignment(patientId);

  if (
    !transfer ||
    transfer.fromCaseManagerId !== rejectingCaseManager.id ||
    !currentAssignment ||
    currentAssignment.endedAt ||
    currentAssignment.caseManagerId !== rejectingCaseManager.id
  ) {
    return false;
  }

  const rejectedAt = new Date().toISOString();
  transfer.status = "rejected";
  transfer.rejectedAt = rejectedAt;

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: rejectedAt,
    type: "transfer",
    title: "Ülevõtmistaotlus tagasi lükatud",
    description: `${rejectingCaseManager.name} lükkas CM-i ${transfer.toCaseManagerName} ülevõtmistaotluse tagasi.`,
    author: rejectingCaseManager.name,
    visibility: "revealed",
  });

  notifySync();
  return true;
}

export function getPendingPatientTransfer(
  patientId: string
): PatientTransfer | undefined {
  return transfers.find(
    (transfer) => transfer.patientId === patientId && transfer.status === "pending"
  );
}

export function getMyIncomingTakeoverRequests(): PatientTransfer[] {
  return transfers
    .filter(
      (transfer) =>
        transfer.status === "pending" &&
        transfer.fromCaseManagerId === getCurrentCaseManager().id
    )
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function getPatientAssignment(
  patientId: string
): PatientAssignment | undefined {
  return [...assignments]
    .reverse()
    .find((item) => item.patientId === patientId);
}

export function canCurrentCaseManagerEditPatient(patientId: string): boolean {
  const assignment = getPatientAssignment(patientId);

  return Boolean(
    assignment &&
      !assignment.endedAt &&
      assignment.caseManagerId === getCurrentCaseManager().id
  );
}

export function getMyPatients() {

  return assignments

    .filter((assignment) => assignment.caseManagerId === getCurrentCaseManager().id)

    .filter((assignment) => !assignment.endedAt)

    .map((assignment) => findPatientById(assignment.patientId))

    .filter((patient) => patient !== undefined);

}

export function getMyClosedAssignments(): PatientAssignment[] {
  return assignments
    .filter(
      (assignment) =>
        assignment.caseManagerId === getCurrentCaseManager().id &&
        Boolean(assignment.endedAt)
    )
    .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
}

export function getDashboardStats() {

  const patients = getAllPatients();

  return {

    active: assignments.filter(
      (assignment) =>
        assignment.caseManagerId === getCurrentCaseManager().id &&
        !assignment.endedAt &&
        findPatientById(assignment.patientId)?.status === "Active"
    ).length,

    incoming: patients.filter((patient) => patient.status === "Incoming").length,

    transferred: assignments.filter(
      (assignment) =>
        assignment.caseManagerId === getCurrentCaseManager().id &&
        assignment.endReason === "transferred"
    ).length,

    completed: assignments.filter(
      (assignment) =>
        assignment.caseManagerId === getCurrentCaseManager().id &&
        assignment.endReason === "completed"
    ).length,

  };

}

export function clearAssignments(): void {
  assignments = [];
  transfers = [];
}
