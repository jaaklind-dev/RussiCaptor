import { DataProvider } from "./DataProvider";
import { Patient, PatientStatus } from "@/models/Patient";

export class OneDriveProvider implements DataProvider {
  getPatients(): Patient[] {
    throw new Error("OneDrive provider not implemented yet.");
  }

  getPatientById(id: string): Patient | undefined {
    throw new Error("OneDrive provider not implemented yet.");
  }

  getPatientByNationalId(
    nationalId: string
  ): Patient | undefined {
    throw new Error("OneDrive provider not implemented yet.");
  }

  setPatientStatus(id: string, status: PatientStatus): void {
    throw new Error("OneDrive provider not implemented yet.");
  }

  setPatientLocation(id: string, location: string): void {
    throw new Error("OneDrive provider not implemented yet.");
  }

  resetPatients(): void {
    throw new Error("OneDrive provider not implemented yet.");
  }
}
