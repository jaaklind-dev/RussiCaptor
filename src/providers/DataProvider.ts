import { Patient } from "@/models/Patient";

export interface DataProvider {
  getPatients(): Patient[];

  getPatientById(id: string): Patient | undefined;

  getPatientByNationalId(
    nationalId: string
  ): Patient | undefined;
}