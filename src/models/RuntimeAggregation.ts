export type NumericRange = { min: number; max: number };
export type RuntimeStatus = "Stable" | "Critical" | "Arrest" | "Dead" | "Resolved";
export type MentalStatusCode =
  | "Alert" | "Anxious" | "Confused" | "Drowsy" | "Obtunded" | "Unresponsive" | "Arrest";

export type RuntimeVitalTargets = {
  hr?: number;
  sbp?: number;
  dbp?: number;
  rr?: number;
  spo2?: number;
  temperature?: number;
  crt?: number;
};

export type RuntimeVitalAttribution = Record<string, {
  primaryProcessId?: string;
  contributorProcessIds: string[];
  rawContributions?: number[];
  appliedContribution?: number;
}>;

export type RuntimeState = {
  encounterId: string;
  stateVersion: number;
  exerciseTimeSec: number;
  globalStatus: RuntimeStatus;
  dominantProcessId?: string;
  /** @deprecated Read-only compatibility projection generated from vitalSignState. */
  readonly targetVitals: Readonly<RuntimeVitalTargets>;
  /** @deprecated Read-only compatibility projection generated from vitalSignState. */
  readonly displayedVitals: Readonly<RuntimeVitalTargets>;
  vitalSignState?: import("@/models/VitalSign").VitalSignState;
  vitalSignConfiguration?: import("@/models/VitalSign").VitalSignConfiguration;
  /** @deprecated Read-only compatibility projection generated from vitalSignState. */
  readonly mapCalculated?: number;
  mentalStatusCode: MentalStatusCode;
  /** @deprecated Read-only compatibility projection generated from vitalSignState. */
  readonly gcsTarget?: number;
  symptomTags: string[];
  visibleFindings: RuntimeFinding[];
  activeAlerts: string[];
  runtimeFields: Record<string, unknown>;
  vitalAttribution: RuntimeVitalAttribution;
  statusAttribution: { primaryProcessId?: string; supportingProcessIds: string[] };
  manualOverrideActive: boolean;
  overrideMap: Record<string, unknown>;
  aggregationConfigVersion: string;
  randomSeed: string | number;
  lastAggregatedAt?: string;
  criticalClearSinceSec?: number;
  physiologicDecompensationConfig?: PhysiologicDecompensationConfiguration;
  physiologicDecompensation?: PhysiologicDecompensationState;
};

export type PhysiologicDecompensationConfiguration = Readonly<{
  version: "WP-48/V1";
  poorSignalScore: number;
  noSignalScore: number;
  terminalFailureDurationSec: number;
  deathFailureDurationSec: number;
}>;

export type PhysiologicDecompensationState = Readonly<{
  profoundFailureSinceSec?: number;
  terminalSinceSec?: number;
  clinicalState: "ALIVE" | "CRITICAL" | "TERMINAL" | "DEAD";
  gcsCause: "NONE" | "HYPOXIA" | "HYPOPERFUSION" | "COMBINED";
  pulseOxSignalQuality?: import("@/models/VitalSign").PulseOxSignalQuality;
}>;

export type RuntimeFinding = {
  code: string;
  location?: string;
  severity?: number;
  visible?: boolean;
  sourceProcessId?: string;
};

export type ProcessOutput = {
  processId: string;
  encounterId: string;
  moduleId: string;
  status: "Active" | "Controlled" | "Resolved" | "Cancelled";
  vitalContributions?: {
    vital: import("@/models/VitalSign").VitalSignKey;
    operation: "DELTA" | "TARGET";
    value: number;
  }[];
  globalSeverityScore: number;
  vitalPriority?: number;
  respiratoryPriority?: number;
  oxygenationPriority?: number;
  neurologicPriority?: number;
  statusPriority?: number;
  hrDelta?: number;
  hrTargetRange?: NumericRange;
  sbpTargetRange?: NumericRange;
  sbpSupportDelta?: number;
  dbpTargetRange?: NumericRange;
  rrDelta?: number;
  rrTargetRange?: NumericRange;
  spo2Ceiling?: number;
  temperatureTarget?: number;
  temperatureDelta?: number;
  crtTarget?: number;
  mentalStatusCeiling?: MentalStatusCode;
  gcsCeiling?: number;
  symptomTags?: string[];
  visibleFindings?: RuntimeFinding[];
  alerts?: string[];
  statusProposal?: RuntimeStatus;
  runtimeContributions?: Record<string, unknown>;
  observedAtSec?: number;
};

export type RuntimeOverride = {
  field: string;
  value: unknown;
  authorized: boolean;
  actorId: string;
  eventId: string;
  expiresAtSec?: number;
};

export type AggregationEvent = {
  eventType: string;
  processId?: string;
  field?: string;
  details?: Record<string, unknown>;
};

export type AggregationInput = {
  previous: RuntimeState;
  expectedStateVersion: number;
  exerciseTimeSec: number;
  processOutputs: ProcessOutput[];
  overrides?: RuntimeOverride[];
  aggregationConfigVersion: string;
};

export type AggregationResult = {
  state: RuntimeState;
  events: AggregationEvent[];
  acceptedProcessIds: string[];
  rejectedProcessIds: string[];
};

export type RuntimeAggregationCommitter = {
  commit(result: AggregationResult, expectedStateVersion: number): Promise<void>;
};
