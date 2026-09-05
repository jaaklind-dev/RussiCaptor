export type ResourceAwareInterventionErrorCode =
  | "TUBE_UNAVAILABLE" | "LARYNGOSCOPE_UNAVAILABLE" | "RESOURCE_UNAVAILABLE"
  | "INVALID_PARAMETER" | "INTERVENTION_REJECTED";

export class ResourceAwareInterventionError extends Error {
  constructor(readonly code: ResourceAwareInterventionErrorCode, message: string) {
    super(message);
    this.name = "ResourceAwareInterventionError";
  }
}
