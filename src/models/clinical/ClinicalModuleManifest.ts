import type { ClinicalModuleDependency } from "./ClinicalModuleDependency";

export type ClinicalModuleManifest = Readonly<{
  moduleId: string;
  version: string;
  description: string;
  dependencies: readonly ClinicalModuleDependency[];
  compatibilityVersion: number;
}>;
