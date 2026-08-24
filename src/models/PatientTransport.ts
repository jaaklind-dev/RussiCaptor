export type TransportResourceState = "AVAILABLE" | "PATIENT_ONBOARD" | "OUTBOUND" | "HANDOVER" | "RETURNING" | "TURNAROUND";
export type PatientTransportState = "ONBOARD" | "IN_TRANSIT" | "ARRIVED" | "HANDED_OVER" | "COMPLETED" | "CANCELLED" | "FAILED";

export type TransportResourceDefinition = Readonly<{
  resourceId: string; resourceType: string; displayName: string; capacity: number; homeLocationId: string;
}>;
export type TransportDestinationDefinition = Readonly<{
  destinationId: string; displayName: string; capabilities: readonly string[]; travelDurationSec: number;
  handoverDurationSec: number; returnDurationSec: number; turnaroundDurationSec: number;
}>;
export type TransportConfiguration = Readonly<{
  version: string; vehicleLocationId: string; resources: readonly TransportResourceDefinition[];
  destinations: readonly TransportDestinationDefinition[];
}>;
export type PatientTransport = Readonly<{
  transportId: string; commandId: string; patientId: string; resourceId: string; destinationId: string;
  state: PatientTransportState; requestedAtSec: number; onboardAtSec: number; departedAtSec: number;
  arrivedAtSec?: number; handedOverAtSec?: number; completedAtSec?: number;
}>;
export type TransportResourceRuntime = Readonly<{
  resourceId: string; state: TransportResourceState; currentPatientId?: string; currentTransportId?: string;
  availableAtSimulationTime: number; phaseEndsAtSec?: number;
}>;
export type TransportEvidenceType = "TRANSPORT_REQUESTED" | "PATIENT_ONBOARD" | "TRANSPORT_DEPARTED" | "TRANSPORT_ARRIVED" | "TRANSPORT_HANDOVER_COMPLETED" | "TRANSPORT_RETURNING" | "TRANSPORT_RESOURCE_AVAILABLE" | "TRANSPORT_CANCELLED";
export type TransportEvidence = Readonly<{ sequence: number; type: TransportEvidenceType; simulationTimeSec: number; transportId: string; patientId: string; resourceId: string; destinationId?: string }>;
export type PatientTransportRuntimeState = Readonly<{
  schemaVersion: 1; configuration: TransportConfiguration; currentSimulationTimeSec: number; sequence: number;
  resources: readonly TransportResourceRuntime[]; transports: readonly PatientTransport[];
  patientLocations: Readonly<Record<string, string>>; evidence: readonly TransportEvidence[];
}>;
export type TransportCommandResult = Readonly<{ status: "STARTED" | "CANCELLED" | "NO_OP" | "REJECTED"; reason?: "TRANSPORT_RESOURCE_BUSY" | "UNKNOWN_RESOURCE" | "UNKNOWN_DESTINATION" | "INVALID_PATIENT_LOCATION" | "TRANSPORT_NOT_CANCELLABLE" | "INVALID_CONFIGURATION"; transport?: PatientTransport }>;
