import type { Avpu, PulseOxSignalQuality } from "@/models/VitalSign";

export type InstructorPatientStatus =
  | "Stable" | "Requires attention" | "Critical" | "Life threatening" | "Completed";

export type InstructorPatientCardModel = {
  readonly patientId: string;
  readonly name: string;
  readonly location: string;
  readonly triage: string;
  readonly caseManagerId?: string;
  readonly caseManagerName?: string;
  readonly status: InstructorPatientStatus;
  readonly avpu?: Avpu;
  readonly spo2?: number;
  readonly pulseOxSignalQuality?: PulseOxSignalQuality;
  readonly respiratoryRate?: number;
  readonly heartRate?: number;
  readonly systolicBp?: number;
  readonly simulationTimeSec?: number;
  readonly lastUpdate?: string;
  readonly hasCanonicalRuntime: boolean;
  readonly clinicalState?: "ALIVE" | "CRITICAL" | "TERMINAL" | "DEAD";
};

export type InstructorDashboardFilters = {
  readonly location: string;
  readonly triage: string;
  readonly caseManager: string;
  readonly status: string;
};
