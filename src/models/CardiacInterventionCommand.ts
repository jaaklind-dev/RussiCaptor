export type CardiacInterventionAction = "START_CPR" | "STOP_CPR" | "DEFIBRILLATION";

export type CardiacInterventionCommand = Readonly<{
  commandId: string;
  exerciseId: string;
  patientId: string;
  action: CardiacInterventionAction;
  issuedBy: string;
}>;

export type CardiacInterventionCommandResult =
  | Readonly<{ ok: true; commandId: string; runtimeEventId: string }>
  | Readonly<{ ok: false; commandId: string; errorCode: "UNAVAILABLE" | "INVALID_STATE" | "RUNTIME_FAILURE"; message: string }>;
