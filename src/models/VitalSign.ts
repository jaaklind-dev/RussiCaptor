export type VitalSignKey =
  | "heartRate" | "systolicBp" | "diastolicBp" | "respiratoryRate"
  | "spo2" | "etco2" | "temperature" | "gcs" | "crt";

export type VitalTrendDirection = "RISING" | "FALLING" | "UNCHANGED";
export type VitalTrendStability = "STABLE" | "UNSTABLE";
export type MonitorQuality = "VALID" | "UNRELIABLE" | "LOST" | "OFFLINE";
export type PulseOxSignalQuality = "GOOD" | "POOR" | "NO_SIGNAL";
export type Avpu = "ALERT" | "VOICE" | "PAIN" | "UNRESPONSIVE";
export type VitalContributionLayer = "PERMANENT" | "PROCESS" | "MEDICATION" | "TEMPORARY";

export type VitalSignReading = {
  current: number;
  target: number;
  trend: number;
  direction: VitalTrendDirection;
  stability: VitalTrendStability;
};

export type VitalSignState = {
  timestamp: number;
  quality: MonitorQuality;
  baseline: Record<VitalSignKey, number>;
  readings: Record<VitalSignKey, VitalSignReading>;
  avpu: Avpu;
  derived: { meanArterialPressure: number; shockIndex: number; pulsePressure: number };
  pulseOx?: {
    signalQuality: PulseOxSignalQuality;
    physiologicOxygenation: number;
    measuredSpO2?: number;
    perfusionScore: number;
  };
  activeContributors: VitalSignContributor[];
};

export type VitalSignRule = {
  baseline: number;
  min: number;
  max: number;
  maxChangePerTick: number;
  responseFactor: number;
  roundingDigits: number;
  unstableChangeThreshold: number;
};

export type VitalSignConfiguration = {
  version: string;
  signs: Record<VitalSignKey, VitalSignRule>;
  avpuThresholds: { alertMinGcs: number; voiceMinGcs: number; painMinGcs: number };
};

/**
 * Generic engine input retained for isolated engine tests and compatibility.
 * Production runtime accepts only PatientVitalContributor through
 * VitalSignRuntimeResolver.
 */
export type VitalSignContributor = {
  contributorId: string;
  sourceType: "PATIENT_PROCESS" | "CLINICAL_EFFECT" | "RUNTIME_TARGET" | "MANUAL_OVERRIDE";
  sourceId: string;
  layer: VitalContributionLayer;
  vital: VitalSignKey;
  operation: "DELTA" | "TARGET" | "OVERRIDE";
  value: number;
};

export type PatientVitalContributor = Omit<VitalSignContributor, "sourceType" | "layer" | "operation"> & {
  sourceType: "PATIENT_PROCESS";
  layer: "PROCESS";
  operation: "DELTA" | "TARGET";
};

export type VitalSignEvent = {
  eventType: "VitalSignChanged" | "TrendChanged" | "MonitorStateChanged";
  timestamp: number;
  vital?: VitalSignKey;
  from?: number | string;
  to?: number | string;
  sourceProcessId: "VITAL_SIGN_ENGINE";
};

export type VitalSignResolutionInput = {
  timestamp: number;
  configuration: VitalSignConfiguration;
  previous?: VitalSignState;
  contributors: VitalSignContributor[];
  monitorQuality?: MonitorQuality;
};

export type VitalSignResolutionResult = { state: VitalSignState; events: VitalSignEvent[] };
