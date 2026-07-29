export type DefinitiveAirwayState = "NONE" | "MANUAL" | "OPA" | "NPA" | "SUPRAGLOTTIC" | "ENDOTRACHEAL";
export type VentilationState = "NONE" | "BVM" | "MECHANICAL";

export type AirwayState = {
  patientId: string;
  activeAirway: DefinitiveAirwayState;
  currentVentilation: VentilationState;
  activeOxygenDelivery?: string;
  confirmed: boolean;
  updatedAt: number;
};

export type AirwayEventType =
  | "AirwayInserted"
  | "AirwayRemoved"
  | "VentilationStarted"
  | "VentilationStopped"
  | "AirwayConfirmed";

export type AirwayRuntimeEvent = {
  eventType: AirwayEventType;
  timestamp: number;
  patientId: string;
  interventionInstanceId: string;
  definitionId: string;
  airwayState: DefinitiveAirwayState;
  ventilationState: VentilationState;
};
