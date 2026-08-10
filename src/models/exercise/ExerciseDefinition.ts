import type { ExerciseCapability } from "./ExerciseCapability";
import type { ExerciseObjective } from "./ExerciseObjective";
import type { ExerciseProfile } from "./ExerciseProfile";
import type { ClinicalModuleComposition } from "@/models/clinical/ClinicalModule";
import type { ProtocolProvenance } from "@/models/protocol/ClinicalProtocolConfiguration";

export type ExerciseDefinition = Readonly<{
  definitionVersion: number;
  exerciseTypeId: string;
  name: string;
  description: string;
  profile: ExerciseProfile;
  enabledPatientProcesses: readonly string[];
  enabledAnalyticsProviders: readonly string[];
  enabledMetricProviders: readonly string[];
  objectives: readonly ExerciseObjective[];
  capabilities: readonly ExerciseCapability[];
  clinicalModuleComposition?: ClinicalModuleComposition;
  protocolProvenance?: ProtocolProvenance;
}>;

export type ExerciseDefinitionCatalog = Readonly<{
  patientProcesses: readonly string[];
  analyticsProviders: readonly string[];
  metricProviders: readonly string[];
}>;
