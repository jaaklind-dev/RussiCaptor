export type NarvaIroVentilationFault = "CIRCUIT_DISCONNECT" | "HIGH_PRESSURE_KINK" |
  "OXYGEN_DEPLETION" | "VENTILATOR_STOP";
export type NarvaIroVasopressorStage = "S0" | "S1" | "S2" | "S3" | "PEA" |
  "S1R" | "S2R" | "S3R" | "ROSC";
export type NarvaIroVentilationStage = "NORMAL" | "EARLY" | "DETERIORATING" | "CRITICAL" | "PEA" | "RECOVERING";

export type NarvaIroFaultClock = Readonly<{
  startedAtSimulationTimeSec: number;
  heldAtSimulationTimeSec?: number;
  accumulatedHoldSec: number;
  correctedAtSimulationTimeSec?: number;
}>;

export type NarvaIroScenarioState = Readonly<{
  schemaVersion: 1;
  patientId: string;
  enabled: true;
  vasopressorFault?: NarvaIroFaultClock;
  ventilationFault?: NarvaIroFaultClock & Readonly<{ type: NarvaIroVentilationFault }>;
  hold: boolean;
  arrest: boolean;
  cprQuality: boolean;
  rosc: boolean;
  roscAtSimulationTimeSec?: number;
  goNoGoRequired: boolean;
  lastUpdatedSimulationTimeSec: number;
}>;

export type NarvaIroScenarioProjection = NarvaIroScenarioState & Readonly<{
  vasopressorStage: NarvaIroVasopressorStage;
  ventilationStage: NarvaIroVentilationStage;
  heartRate: number;
  systolicBp?: number;
  diastolicBp?: number;
  spo2: number;
  etco2?: number;
  pulsePresent: boolean;
  ventilationAlarm?: "LOW_VOLUME" | "HIGH_PRESSURE" | "OXYGEN_SUPPLY" | "APNOEA";
  etco2WaveformPresent: boolean;
  exhaledVolumeReduced: boolean;
  oxygenSourceAdequate: boolean;
  ventilatorRunning: boolean;
  causesCorrected: boolean;
  roscEligible: boolean;
}>;

export type NarvaIroScenarioSnapshot = Readonly<{ schemaVersion: 1; state: NarvaIroScenarioState }>;
