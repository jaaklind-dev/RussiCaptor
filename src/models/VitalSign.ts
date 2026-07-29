export type VitalSignKey =
  | "heartRate" | "systolicBp" | "diastolicBp" | "respiratoryRate"
  | "spo2" | "etco2" | "temperature" | "gcs";

export type VitalTrendDirection = "RISING" | "FALLING" | "UNCHANGED";
export type VitalTrendStability = "STABLE" | "UNSTABLE";
export type MonitorQuality = "VALID" | "UNRELIABLE" | "LOST" | "OFFLINE";
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

export type VitalSignContributor = {
  contributorId: string;
  sourceType: "PATIENT_PROCESS" | "CLINICAL_EFFECT" | "RUNTIME_TARGET";
  sourceId: string;
  layer: VitalContributionLayer;
  vital: VitalSignKey;
  operation: "DELTA" | "TARGET";
  value: number;
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
