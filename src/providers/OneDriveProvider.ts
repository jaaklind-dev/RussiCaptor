import { DataProvider } from "./DataProvider";
import { Patient } from "@/models/Patient";

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
}