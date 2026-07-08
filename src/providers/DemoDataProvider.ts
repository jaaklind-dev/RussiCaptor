import { Patient } from "@/models/Patient";
import { allPatients } from "@/data/demoPatient";
import { DataProvider } from "./DataProvider";

export class DemoDataProvider implements DataProvider {
  getPatients(): Patient[] {
    return allPatients;
  }

  getPatientById(id: string): Patient | undefined {
    return allPatients.find((p) => p.id === id);
  }

  getPatientByNationalId(
    nationalId: string
  ): Patient | undefined {
    return allPatients.find(
      (p) => p.isikukood === nationalId
    );
  }
}