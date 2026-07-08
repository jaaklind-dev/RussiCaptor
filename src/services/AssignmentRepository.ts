import { findPatientById } from "@/repositories/PatientRepository";

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

export function getDashboardStats() {

  return {

    active: assignedPatientIds.length,

    incoming: 0,

    transferred: 0,

    completed: 0,

  };

}