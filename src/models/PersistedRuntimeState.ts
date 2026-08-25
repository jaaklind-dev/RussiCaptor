import type { AirwayRuntimeEvent, AirwayState } from "@/models/AirwayState";
import type { CanonicalLifecycleProcess } from "@/models/PatientProcessLifecycle";
import type { CirculationRuntimeEvent, CirculationState } from "@/models/CirculationState";
import type { ClinicalIntegrationEvent, ClinicalEffect } from "@/models/ClinicalIntegration";
import type { GoldenActualEvent } from "@/models/GoldenTest";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { MedicationDefinition, MedicationInstance, MedicationRuntimeEvent } from "@/models/MedicationRuntime";
import type { ResourceRuntimeEvent, RuntimeIntervention, RuntimeResource } from "@/models/ResourceRuntime";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import type { VitalSignEvent } from "@/models/VitalSign";
import type { AssessmentRule } from "@/models/ClinicalAssessment";

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
  medication: Readonly<{
    definitions: readonly MedicationDefinition[];
    instances: readonly MedicationInstance[];
    events: readonly MedicationRuntimeEvent[];
    effects: readonly ClinicalEffect[];
  }>;
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
