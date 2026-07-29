import type { ClinicalEffectType, ClinicalParameterValue } from "@/models/ClinicalIntegration";
import type { ResourceType } from "@/models/ResourceRuntime";

export type ResourceRequirement = {
  resourceType: ResourceType;
  quantity: number;
  optional?: boolean;
};

export type ClinicalEffectDefinition = {
  effectType: ClinicalEffectType;
  parameterMap: Record<string, string>;
};

export type InterventionDuration =
  | { kind: "CONTINUOUS" }
  | { kind: "FIXED"; durationSec: number };

export type InterventionParameterDefinition = {
  name: string;
  type: "NUMBER" | "STRING" | "BOOLEAN";
  required: boolean;
  defaultValue?: ClinicalParameterValue;
  min?: number;
  max?: number;
};

export type InterventionPrecondition =
  | { kind: "ACTIVE_ENCOUNTER" }
  | { kind: "RESOURCE_ASSIGNED_TO_PATIENT"; resourceType: ResourceType };

export type InterventionDefinition = {
  definitionId: string;
  version: string;
  name: string;
  requiredResources: ResourceRequirement[];
  effects: ClinicalEffectDefinition[];
  duration: InterventionDuration;
  parameters: InterventionParameterDefinition[];
  preconditions: InterventionPrecondition[];
};
