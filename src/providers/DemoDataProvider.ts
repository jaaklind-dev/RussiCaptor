import { Patient } from "@/models/Patient";
import { patients } from "@/data/patients";
import { DataProvider } from "./DataProvider";

export class DemoDataProvider implements DataProvider {
  getPatients(): Patient[] {
    return patients;
  }

  getPatientById(id: string): Patient | undefined {
    return patients.find((p) => p.id === id);
  }

  getPatientByNationalId(
    nationalId: string
  ): Patient | undefined {
    return patients.find(
      (p) => p.isikukood === nationalId
    );
  }
}