import { findPatientById, getAllPatients } from "@/repositories/PatientRepository";

let assignedPatientIds: string[] = [];

export function assignPatientToMe(patientId: string) {

  const patient = findPatientById(patientId);

  if (!patient || patient.status === "Completed") {
    return;
  }

  if (!assignedPatientIds.includes(patientId)) {

    assignedPatientIds.push(patientId);

  }

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
