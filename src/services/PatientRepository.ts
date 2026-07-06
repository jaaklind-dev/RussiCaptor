import { allPatients } from "@/data/demoPatient";

export function findPatientByNationalId(nationalId: string) {

  return allPatients.find(

    (patient) => patient.isikukood === nationalId.trim()

  );

}

export function findPatientById(patientId: string) {

  return allPatients.find(

    (patient) => patient.id === patientId

  );

}