import type { VitalSignContributor } from "@/models/VitalSign";

export type ClinicalFeatureCategory = "MEDICATION" | "FLUID" | "VENTILATION" | "PROCEDURE";
export type ClinicalFeatureLifecycle = "RUNNING" | "STOPPING" | "STOPPED";

/**
 * Small reusable contract for authoritative clinical features. Implementations
 * own command validation and persisted state, derive effects only from
 * simulation time, and expose detached assessment/debug projections.
 */
export type ClinicalFeatureContract<
  TFeatureId extends string,
  TCommand,
  TState,
  TConfiguration,
> = Readonly<{
  featureId: TFeatureId;
  category: ClinicalFeatureCategory;
  schemaVersion: number;
  configuration: TConfiguration;
  input: Readonly<{
    unit: string;
    actions: readonly string[];
    validate(command: TCommand): readonly string[];
  }>;
  authoritativeState: Readonly<{
    lifecycle: readonly ClinicalFeatureLifecycle[];
    persistedFields: readonly string[];
  }>;
  determinism: Readonly<{
    clock: "SIMULATION_TIME";
    wallClockAllowed: false;
  }>;
  physiology: Readonly<{
    order: readonly ["UNDERLYING_PHYSIOLOGY", "HEMORRHAGE_SOURCE_CONTROL", "VOLUME_RESUSCITATION", "VASOPRESSOR", "FINAL_HEMODYNAMICS"];
    combine: "VITAL_SIGN_MEDICATION_LAYER";
    contributors(state: TState, simulationTimeSec: number): readonly VitalSignContributor[];
  }>;
  persistence: Readonly<{
    boundary: "RUNTIME_CHECKPOINT";
    detached: true;
  }>;
  idempotency: Readonly<{
    key: "COMMAND_ID";
    duplicateEffectAllowed: false;
  }>;
  visibility: Readonly<{
    assessment: true;
    debug: true;
  }>;
  regressionIsolation: Readonly<{
    absentFeatureChangesBaseline: false;
  }>;
}>;
