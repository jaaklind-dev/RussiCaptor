import type { ClinicalModuleManifest } from "./ClinicalModuleManifest";

export type ClinicalModuleObjective = Readonly<{
  objectiveId: string;
  name: string;
  description: string;
}>;

export type ClinicalModuleRegistrations = Readonly<{
  patientProcesses: readonly string[];
  clinicalEffects: readonly string[];
  interventions: readonly string[];
  medications: readonly string[];
  assessmentRules: readonly string[];
  analyticsProviders: readonly string[];
  metricProviders: readonly string[];
  capabilities: readonly string[];
  objectives: readonly ClinicalModuleObjective[];
  validationRules: readonly string[];
}>;

export type ClinicalModule = Readonly<{
  moduleId: string;
  version: string;
  moduleHash: string;
  manifest: ClinicalModuleManifest;
  registrations: ClinicalModuleRegistrations;
}>;

export type ClinicalModuleProvenance = Readonly<{
  moduleId: string;
  version: string;
  moduleHash: string;
  compositionOrder: number;
}>;

export type ClinicalModuleComposition = Readonly<{
  modules: readonly ClinicalModuleProvenance[];
  registrations: ClinicalModuleRegistrations;
}>;
