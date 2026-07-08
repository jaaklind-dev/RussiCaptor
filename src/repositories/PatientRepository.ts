import { dataProvider } from "@/providers/ProviderFactory";

export function findPatientByNationalId(nationalId: string) {
  return dataProvider.getPatientByNationalId(nationalId.trim());
}

export function findPatientById(patientId: string) {
  return dataProvider.getPatientById(patientId);
}

export function getAllPatients() {
  return dataProvider.getPatients();
}