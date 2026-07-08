import { DemoDataProvider } from "@/providers/DemoDataProvider";

const provider = new DemoDataProvider();

export function findPatientByNationalId(nationalId: string) {

  return provider.getPatientByNationalId(nationalId.trim());

}

export function findPatientById(patientId: string) {

  return provider.getPatientById(patientId);

}

export function getAllPatients() {

  return provider.getPatients();

}

