export interface Patient {

  patientId: string;

  nationalId: string;   // isikukood

  firstName: string;

  lastName: string;

  triage: "P1" | "P2" | "P3" | "P4";

  scenarioId: string;

}