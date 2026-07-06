import { findPatientById } from "@/services/PatientRepository";

let assignedPatientIds: string[] = [];

export function assignPatientToMe(patientId: string) {

  if (!assignedPatientIds.includes(patientId)) {

    assignedPatientIds.push(patientId);

  }

}

export function getMyPatients() {

  return assignedPatientIds

    .map((patientId) => findPatientById(patientId))

    .filter((patient) => patient !== undefined);

}

export function getMyPatientCount() {

  return assignedPatientIds.length;

}