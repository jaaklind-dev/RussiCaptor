export type RuntimeCompletionRequest = Readonly<{
  exerciseId: string;
  commandId: string;
  requestedBy: string;
  expectedExerciseVersion: number;
  fenceCommandSequence: number;
  status: "PENDING" | "COMPLETED";
  terminalCheckpointRevision?: number;
  terminalPayloadHash?: string;
}>;

export type RuntimeCompletionSubmissionResult = Readonly<{
  status: "PENDING" | "COMPLETED" | "UNAVAILABLE" | "REJECTED";
  fenceCommandSequence?: number;
  terminalCheckpointRevision?: number;
  code?: string;
}>;
