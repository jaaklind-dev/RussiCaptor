export type InterventionType =
  | "cpr"
  | "airway"
  | "defibrillation"
  | "iv_access";

export type Intervention = {
  id: string;
  exerciseId: string;
  patientId: string;
  type: InterventionType;
  label: string;
  status: "completed";
  performedBy: string;
  performedAt: string;
};
