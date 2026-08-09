import type { ClinicalModule, ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";
import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { deepFreeze } from "@/utils/immutable";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const sorted = (values: readonly string[]) => [...values].sort((left, right) => left.localeCompare(right));
const canonicalRegistrations = (input: ClinicalModuleRegistrations): ClinicalModuleRegistrations => ({
  patientProcesses: sorted(input.patientProcesses),
  clinicalEffects: sorted(input.clinicalEffects),
  interventions: sorted(input.interventions),
  medications: sorted(input.medications),
  assessmentRules: sorted(input.assessmentRules),
  analyticsProviders: sorted(input.analyticsProviders),
  metricProviders: sorted(input.metricProviders),
  capabilities: sorted(input.capabilities),
  objectives: [...input.objectives].sort((left, right) => left.objectiveId.localeCompare(right.objectiveId)),
  validationRules: sorted(input.validationRules),
});

export function clinicalModuleHashInput(input: Omit<ClinicalModule, "moduleHash">) {
  return {
    moduleId: input.moduleId,
    version: input.version,
    manifest: {
      ...input.manifest,
      dependencies: [...input.manifest.dependencies].sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.version.localeCompare(right.version)),
    },
    registrations: canonicalRegistrations(input.registrations),
  };
}

export const calculateClinicalModuleHash = (input: Omit<ClinicalModule, "moduleHash">): string => sha256Text(stableJson(clinicalModuleHashInput(input)));

export function createClinicalModule(input: Readonly<{
  moduleId: string;
  version: string;
  manifest: Omit<ClinicalModuleManifest, "moduleId" | "version">;
  registrations: ClinicalModuleRegistrations;
}>): ClinicalModule {
  const content = {
    moduleId: input.moduleId,
    version: input.version,
    manifest: { ...structuredClone(input.manifest), moduleId: input.moduleId, version: input.version },
    registrations: structuredClone(input.registrations),
  };
  return deepFreeze({ ...clinicalModuleHashInput(content), moduleHash: calculateClinicalModuleHash(content) }) as ClinicalModule;
}
