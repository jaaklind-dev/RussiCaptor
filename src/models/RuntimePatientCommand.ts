export const runtimePatientCommandTypes = [
  "RESOURCE_APPLY",
  "RESOURCE_STOP",
  "MTP",
  "CLINICAL_TREATMENT",
  "TRANSPORT_START",
  "IRO_VASOPRESSOR_FAULT_START",
  "IRO_VASOPRESSOR_FAULT_CORRECT",
  "IRO_VENTILATION_FAULT_START",
  "IRO_VENTILATION_FAULT_CORRECT",
  "IRO_HOLD",
  "IRO_RESUME",
  "LAB_ORDER",
  "LAB_COLLECT",
  "IMAGING_ORDER",
  "ENDOTRACHEAL_INTUBATION",
  "PATIENT_COMPLETE",
  "PATIENT_LOCATION_TRANSFER",
] as const;

export type RuntimePatientCommandType = typeof runtimePatientCommandTypes[number];

export type RuntimePatientCommandSubmission = Readonly<{
  exerciseId: string;
  patientId: string;
  commandId: string;
  commandType: RuntimePatientCommandType;
  patientBaseRevision: number;
  simulationTimeSec: number;
  payload: Readonly<Record<string, unknown>>;
}>;

export type AcceptedRuntimePatientCommand = RuntimePatientCommandSubmission & Readonly<{
  commandSequence: number;
  /** Durable shared-workflow/CAS revision reserved at submission, not proof of clinical materialization. */
  patientResultingRevision: number;
  actorUserId: string;
}>;

export type RuntimePatientCommandSubmissionResult = Readonly<{
  status: "APPLIED" | "IDEMPOTENT" | "STALE_VERSION" | "NOT_OWNER" |
    "COMPLETION_FENCED" | "EXERCISE_NOT_ACTIVE" | "AUTHORIZATION_DENIED" |
    "RECONNECT_REQUIRED" | "UNAVAILABLE";
  commandSequence?: number;
  intentSimulationTimeSec?: number;
  patientRevision: number;
  ownerUserId?: string;
}>;

export type RuntimePatientCommandMaterialization = Readonly<{
  status: "MATERIALIZED" | "REJECTED";
  result: Readonly<Record<string, unknown>>;
}>;
