import { Patient, PatientStatus } from "@/models/Patient";

export interface DataProvider {
  getPatients(): Patient[];

  getPatientById(id: string): Patient | undefined;

  getPatientByNationalId(
    nationalId: string
  ): Patient | undefined;

  setPatientStatus(id: string, status: PatientStatus): void;

  setPatientLocation(id: string, location: string): void;

  resetPatients(): void;

  installPatients(patients: Patient[]): void;
}
