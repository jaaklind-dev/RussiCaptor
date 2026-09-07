export const runtimePatientCommandTypes = [
  "RESOURCE_APPLY",
  "RESOURCE_STOP",
  "MTP",
  "CLINICAL_TREATMENT",
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
  patientResultingRevision: number;
  actorUserId: string;
}>;

export type RuntimePatientCommandSubmissionResult = Readonly<{
  status: "APPLIED" | "IDEMPOTENT" | "STALE_VERSION" | "NOT_OWNER" |
    "COMPLETION_FENCED" | "EXERCISE_NOT_ACTIVE" | "AUTHORIZATION_DENIED" |
    "RECONNECT_REQUIRED" | "UNAVAILABLE";
  commandSequence?: number;
  patientRevision: number;
  ownerUserId?: string;
}>;

export type RuntimePatientCommandMaterialization = Readonly<{
  status: "MATERIALIZED" | "REJECTED";
  result: Readonly<Record<string, unknown>>;
}>;
