import type { ClinicalEffect, ClinicalProcessRuntime } from "@/models/ClinicalIntegration";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { HemorrhagePatientProcessRuntime, HemorrhageProcessEvent } from "@/models/HemorrhagePatientProcess";
import type { BotulismRootPatientProcessRuntime, PleuralInjuryPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { RuntimeState } from "@/models/RuntimeAggregation";

export type CanonicalLifecycleProcess = ClinicalProcessRuntime | HemorrhagePatientProcessRuntime | BotulismRootPatientProcessRuntime | PleuralInjuryPatientProcessRuntime;
export type LifecyclePhase = "BOOTSTRAP" | "ADVANCE" | "HANDLE_INPUT" | "PREPARE" | "TICK" | "POST_AGGREGATE" | "FINALIZE";
export type LifecycleSerializationSlot = number | "SEPARATE_ROOT";

export type LegacyCanonicalOrder = Readonly<{
  bootstrapOrder?: number;
  advanceOrder?: number;
  inputOrder?: number;
  prepareOrder?: number;
  tickOrder?: number;
  postAggregateOrder?: number;
  finalizeOrder?: number;
  aggregationSlot?: number;
  serializationSlot: LifecycleSerializationSlot;
  siblingOrder: "SINGLETON" | "PROCESS_ID";
}>;

export type PatientProcessEvidence = Readonly<{
  eventType: string;
  target?: string;
  details: Readonly<Record<string, unknown>>;
  recordPhase: "BEFORE_AGGREGATION" | "AFTER_AGGREGATION" | "FINALIZE";
  sourceProcessId?: string;
}>;

export type PatientProcessLifecycleResult = Readonly<{
  processes: readonly CanonicalLifecycleProcess[];
  events: readonly PatientProcessEvidence[];
  aggregationRequested: boolean;
}>;

export type PatientProcessBootstrapContext = Readonly<{
  fixture: GoldenFixture;
  existingProcesses: readonly CanonicalLifecycleProcess[];
  requestedConfig?: Readonly<Record<string, unknown>>;
  parent?: Readonly<{ processId: string; processType: string; instanceKey: string }>;
}>;

export type PatientProcessPhaseContext = Readonly<{
  simulationTimeSec: number;
  tickSeconds: number;
  activeEffects: readonly ClinicalEffect[];
  runtimeState: Readonly<RuntimeState>;
  inputEvent?: GoldenInputEvent;
  existingProcesses: readonly CanonicalLifecycleProcess[];
  transition?: string;
}>;

export type PatientProcessInputContext = Readonly<{
  event: GoldenInputEvent;
  simulationTimeSec: number;
  runtimeState: Readonly<RuntimeState>;
  existingProcesses: readonly CanonicalLifecycleProcess[];
}>;

export type PatientProcessLifecycleDescriptor = Readonly<{
  processType: string;
  kind: "LEAF" | "ROOT";
  requiredPhases: readonly LifecyclePhase[];
  order: LegacyCanonicalOrder;
  bootstrap?: (context: PatientProcessBootstrapContext) => PatientProcessLifecycleResult;
  advance?: (process: CanonicalLifecycleProcess, context: PatientProcessPhaseContext) => PatientProcessLifecycleResult;
  handleInput?: (process: CanonicalLifecycleProcess, context: PatientProcessInputContext) => PatientProcessLifecycleResult | undefined;
  prepare?: (process: CanonicalLifecycleProcess, context: PatientProcessPhaseContext) => PatientProcessLifecycleResult;
  tick?: (process: CanonicalLifecycleProcess, context: PatientProcessPhaseContext) => PatientProcessLifecycleResult;
  postAggregate?: (process: CanonicalLifecycleProcess, context: PatientProcessPhaseContext) => readonly PatientProcessEvidence[];
  finalize?: (process: CanonicalLifecycleProcess, context: PatientProcessPhaseContext) => PatientProcessLifecycleResult;
}>;

export type LifecycleDiagnosticCode =
  | "DUPLICATE_DESCRIPTOR"
  | "INVALID_DESCRIPTOR"
  | "MISSING_REQUIRED_HANDLER"
  | "CONFLICTING_ORDER"
  | "UNKNOWN_PROCESS_TYPE"
  | "INVALID_PROCESS_IDENTITY"
  | "INVALID_ROOT_CHILD_RELATIONSHIP"
  | "UNRESOLVED_LIFECYCLE_PHASE"
  | "UNAUTHORIZED_CANONICAL_WRITE"
  | "NONDETERMINISTIC_EXECUTION_PLAN";

export class PatientProcessLifecycleError extends Error {
  constructor(readonly code: LifecycleDiagnosticCode, message: string) { super(message); this.name = "PatientProcessLifecycleError"; }
}

export type PatientProcessDomainEvent = HemorrhageProcessEvent;
