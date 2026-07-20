import { Patient, PatientStatus } from "@/models/Patient";
import { patients } from "@/data/patients";
import { DataProvider } from "./DataProvider";

export class DemoDataProvider implements DataProvider {
  private readonly initialPatients = patients.map((patient) => ({
    ...patient,
    mist: { ...patient.mist },
  }));

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

  setPatientStatus(id: string, status: PatientStatus): void {
    const patient = patients.find((item) => item.id === id);

    if (patient) {
      patient.status = status;
    }
  }

  resetPatients(): void {
    patients.splice(
      0,
      patients.length,
      ...this.initialPatients.map((patient) => ({
        ...patient,
        mist: { ...patient.mist },
      }))
    );
  }
}
