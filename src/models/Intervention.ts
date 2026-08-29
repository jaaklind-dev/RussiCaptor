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
  /** Immutable authenticated operator id. Missing only on legacy rows. */
  performedById?: string;
  performedAt: string;
};

export type InterventionOption = {
  id: string;
  exerciseId: string;
  patientId: string;
  type: InterventionType;
  label: string;
  visibility: "hidden" | "available" | "revealed";
};
