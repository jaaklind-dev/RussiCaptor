export const LABORATORY_WORKFLOW_SCHEMA_VERSION = 1 as const;
export const LAB_SAMPLE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type NarvaLabPackageId = "NARVA_POLYTRAUMA" | "NARVA_IRO_ASTRUP";
export type LabResultGroupType = "ASTRUP" | "HEMATOLOGY" | "AB0" |
  "CLINICAL_CHEMISTRY" | "COAGULATION";
export type LaboratoryWorkflowStatus = "ORDERED" | "COLLECTED" | "PROCESSING" |
  "PARTIALLY_RESULTED" | "RESULTED";

export type LabPatientBloodIdentity = Readonly<{
  ab0: "A" | "B" | "AB" | "O";
  rhd: "POSITIVE" | "NEGATIVE";
  antibodyScreen?: "NEGATIVE" | "POSITIVE";
}>;

/** Versioned, bounded capture of authoritative inputs. Future clinical generators consume this, never live state. */
export type LabSamplePhysiologySnapshot = Readonly<{
  schemaVersion: typeof LAB_SAMPLE_SNAPSHOT_SCHEMA_VERSION;
  displayedVitals: Readonly<Record<string, number | string | boolean | null>>;
  targetVitals: Readonly<Record<string, number | string | boolean | null>>;
  runtimeFields: Readonly<Record<string, unknown>>;
  clinicalProcessInputs: readonly Readonly<{
    processId: string;
    processType: string;
    runtimeContributions: Readonly<Record<string, unknown>>;
    clinicalState?: Readonly<Record<string, unknown>>;
  }>[];
  medicationState?: Readonly<Record<string, unknown>>;
  ventilationState?: Readonly<Record<string, unknown>>;
  patientBloodIdentity?: LabPatientBloodIdentity;
}>;

export type LaboratoryOrder = Readonly<{
  orderId: string;
  exerciseId: string;
  patientId: string;
  packageId: NarvaLabPackageId;
  orderedAtSimulationTimeSec: number;
  orderedBy: string;
  status: LaboratoryWorkflowStatus;
}>;

export type LaboratorySample = Readonly<{
  sampleId: string;
  orderId: string;
  exerciseId: string;
  patientId: string;
  sampledAtSimulationTimeSec: number;
  sourcePatientRevision: number;
  sourceRuntimeStateVersion: number;
  snapshot: LabSamplePhysiologySnapshot;
}>;

export type LaboratoryResultGroup = Readonly<{
  resultGroupId: string;
  sampleId: string;
  type: LabResultGroupType;
  availableAtSimulationTimeSec: number;
  status: "PROCESSING" | "RESULTED";
  resultPayload?: Readonly<Record<string, unknown>>;
  generationVersion?: string;
  generatedAtSimulationTimeSec?: number;
}>;

export type LaboratoryWorkflowSnapshot = Readonly<{
  schemaVersion: typeof LABORATORY_WORKFLOW_SCHEMA_VERSION;
  orders: readonly LaboratoryOrder[];
  samples: readonly LaboratorySample[];
  resultGroups: readonly LaboratoryResultGroup[];
  patientBloodIdentities: Readonly<Record<string, LabPatientBloodIdentity>>;
  terminalFencedAtSimulationTimeSec?: number;
}>;

export type LaboratoryResultGenerator = (input: Readonly<{
  order: LaboratoryOrder;
  sample: LaboratorySample;
  resultGroupType: LabResultGroupType;
}>) => Readonly<{ payload: Readonly<Record<string, unknown>>; generationVersion: string }>;
