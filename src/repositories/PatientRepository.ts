import { dataProvider } from "@/providers/ProviderFactory";
import type { PatientStatus } from "@/models/Patient";

export function findPatientByNationalId(nationalId: string) {
  const normalized = nationalId.trim();
  const byNationalId = dataProvider.getPatientByNationalId(normalized);

  if (byNationalId) {
    return byNationalId;
  }

  return dataProvider.getPatients().find(
    (patient) => patient.id.toUpperCase() === normalized.toUpperCase()
  );
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

export function setPatientLocation(patientId: string, location: string): void {
  dataProvider.setPatientLocation(patientId, location);
}

export function resetPatients(): void {
  dataProvider.resetPatients();
}
