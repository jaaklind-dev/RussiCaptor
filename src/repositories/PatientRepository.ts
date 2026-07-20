import { dataProvider } from "@/providers/ProviderFactory";
import type { PatientStatus } from "@/models/Patient";

export function findPatientByNationalId(nationalId: string) {
  return dataProvider.getPatientByNationalId(nationalId.trim());
}

export function findPatientById(patientId: string) {
  return dataProvider.getPatientById(patientId);
}

export function getAllPatients() {
  return dataProvider.getPatients();
}

export function setPatientStatus(patientId: string, status: PatientStatus): void {
  dataProvider.setPatientStatus(patientId, status);
}

export function resetPatients(): void {
  dataProvider.resetPatients();
}
