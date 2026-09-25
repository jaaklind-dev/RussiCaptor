import type { AirwayRuntimeEvent, AirwayState } from "@/models/AirwayState";
import type { CanonicalLifecycleProcess } from "@/models/PatientProcessLifecycle";
import type { CirculationRuntimeEvent, CirculationState } from "@/models/CirculationState";
import type { ClinicalIntegrationEvent } from "@/models/ClinicalIntegration";
import type { GoldenActualEvent } from "@/models/GoldenTest";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { MedicationRuntimeSnapshot } from "@/models/MedicationRuntime";
import type { ResourceRuntimeEvent, RuntimeIntervention, RuntimeResource } from "@/models/ResourceRuntime";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import type { VitalSignEvent } from "@/models/VitalSign";
import type { AssessmentRule } from "@/models/ClinicalAssessment";
import type { MechanicalVentilationRuntimeSnapshot } from "@/models/MechanicalVentilation";
import type { NarvaIroScenarioSnapshot } from "@/models/NarvaIroScenario";
import type { LaboratoryWorkflowSnapshot } from "@/models/LaboratoryWorkflow";
import type { ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";

export const LEGACY_PERSISTED_RUNTIME_SCHEMA_VERSION = 1 as const;
export const PERSISTED_RUNTIME_SCHEMA_VERSION = 2 as const;
export type PersistedRuntimeSchemaVersion =
  | typeof LEGACY_PERSISTED_RUNTIME_SCHEMA_VERSION
  | typeof PERSISTED_RUNTIME_SCHEMA_VERSION;

export type RuntimeProvenance = Readonly<{
  exerciseId: string;
  patientId: string;
  packageId: string;
  packageVersion: string;
  packageHash: string;
  definitionHash: string;
  moduleCompositionHash: string;
}>;

export type PersistedRuntimePayload = Readonly<{
  simulationTimeSec: number;
  /** Authoritative trauma onset on the simulation clock; optional for historical/non-trauma checkpoints. */
  injuryOnsetSimulationTimeSec?: number;
  sequence: number;
  processes: readonly CanonicalLifecycleProcess[];
  runtimeState: RuntimeState;
  eventLog: readonly GoldenActualEvent[];
  resourceEventLog: readonly ResourceRuntimeEvent[];
  pendingTransitions: readonly Readonly<{ dueSec: number; transition: string }>[];
  processControlledEventPending: boolean;
  appliedEventIds: readonly string[];
  resources: readonly RuntimeResource[];
  interventionEngine: Readonly<{
    pending: readonly RuntimeIntervention[];
    active: readonly RuntimeIntervention[];
    completed: readonly string[];
  }>;
  clinicalIntegration: Readonly<{
    completedInputIds: readonly string[];
    events: readonly ClinicalIntegrationEvent[];
  }>;
  interventionInstances: readonly InterventionInstance[];
  airway: Readonly<{ states: readonly AirwayState[]; events: readonly AirwayRuntimeEvent[] }>;
  circulation: Readonly<{ states: readonly CirculationState[]; events: readonly CirculationRuntimeEvent[] }>;
  medication: MedicationRuntimeSnapshot;
  mechanicalVentilation?: MechanicalVentilationRuntimeSnapshot;
  narvaIroScenario?: NarvaIroScenarioSnapshot;
  laboratory?: LaboratoryWorkflowSnapshot;
  imaging?: ImagingWorkflowSnapshot;
  assessmentRules: readonly AssessmentRule[];
  vitalSignEvents: readonly VitalSignEvent[];
}>;

export type PersistedRuntimeState = Readonly<{
  schemaVersion: PersistedRuntimeSchemaVersion;
  provenance: RuntimeProvenance;
  capturedAtSimulationTimeSec: number;
  payload: PersistedRuntimePayload;
  payloadHash: string;
}>;

export type RuntimePersistenceDiagnosticCode =
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_ARTIFACT"
  | "PAYLOAD_HASH_MISMATCH"
  | "EXERCISE_IDENTITY_MISMATCH"
  | "PATIENT_IDENTITY_MISMATCH"
  | "PACKAGE_PROVENANCE_MISMATCH"
  | "DEFINITION_PROVENANCE_MISMATCH"
  | "MODULE_COMPOSITION_MISMATCH"
  | "UNKNOWN_PROCESS_TYPE"
  | "RUNTIME_INVARIANT_VIOLATION";

export class RuntimePersistenceError extends Error {
  constructor(readonly code: RuntimePersistenceDiagnosticCode, message: string) {
    super(message);
    this.name = "RuntimePersistenceError";
  }
}
