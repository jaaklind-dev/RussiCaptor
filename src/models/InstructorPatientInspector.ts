import type { Avpu } from "@/models/VitalSign";
import type { InstructorPatientStatus } from "@/models/InstructorDashboard";

export type InspectorHeaderModel = {
  readonly patientId: string;
  readonly name: string;
  readonly nationalId: string;
  readonly location: string;
  readonly triage: string;
  readonly status: InstructorPatientStatus;
  readonly caseManagerName?: string;
  readonly simulationTimeSec?: number;
  readonly lastSnapshotTimestamp?: string;
};

export type InspectorClinicalStateModel = {
  readonly hasCanonicalRuntime: boolean;
  readonly heartRate?: number;
  readonly respiratoryRate?: number;
  readonly spo2?: number;
  readonly systolicBp?: number;
  readonly diastolicBp?: number;
  readonly map?: number;
  readonly temperature?: number;
  readonly etco2?: number;
  readonly avpu?: Avpu;
  readonly gcs?: number;
};

export type InspectorListItem = {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly time?: string;
  readonly status?: string;
};

export type InstructorPatientInspectorModel = {
  readonly header: InspectorHeaderModel;
  readonly clinicalState: InspectorClinicalStateModel;
  readonly processes: readonly InspectorListItem[];
  readonly effects: readonly InspectorListItem[];
  readonly timeline: readonly InspectorListItem[];
  readonly ownershipHistory: readonly InspectorListItem[];
  readonly interventions: readonly InspectorListItem[];
  readonly medications: readonly InspectorListItem[];
  readonly labs: readonly InspectorListItem[];
  readonly imaging: readonly InspectorListItem[];
  readonly orders: readonly InspectorListItem[];
  readonly notes: readonly InspectorListItem[];
};

export type InspectorTab = "Interventions" | "Medications" | "Labs" | "Imaging" | "Orders" | "Notes";
