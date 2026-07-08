export type TriageCategory = "P1" | "P2" | "P3" | "P4";

export type PatientStatus =
  | "Active"
  | "Incoming"
  | "Transferred"
  | "Completed";

export type Mist = {
  mechanism: string;
  injuries: string;
  signs: string;
  treatment: string;
};

export type Patient = {
  id: string;
  isikukood: string;
  name: string;
  triage: TriageCategory;
  status: PatientStatus;
  location: string;
  lastSeen: string;
  mist: Mist;
};