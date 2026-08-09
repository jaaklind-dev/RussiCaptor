import type { ClinicalModule } from "@/models/clinical/ClinicalModule";
import { deepFreeze } from "@/utils/immutable";
import { calculateClinicalModuleHash } from "./ClinicalModuleHash";

export const CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION = 1;
const key = (moduleId: string, version: string): string => `${moduleId}@${version}`;
const exactVersion = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;

export class ClinicalModuleRegistry {
  private readonly byKey = new Map<string, ClinicalModule>();

  register(input: ClinicalModule): void {
    if (!input.moduleId?.trim() || input.manifest.moduleId !== input.moduleId) throw new Error("INVALID_CLINICAL_MODULE_ID");
    if (!exactVersion.test(input.version) || input.manifest.version !== input.version) throw new Error("INVALID_CLINICAL_MODULE_VERSION");
    if (!input.manifest.description?.trim()) throw new Error("INVALID_CLINICAL_MODULE_DESCRIPTION");
    for (const dependency of input.manifest.dependencies) if (!dependency.moduleId?.trim() || !exactVersion.test(dependency.version)) throw new Error("INVALID_CLINICAL_MODULE_DEPENDENCY");
    if (new Set(input.manifest.dependencies.map(item => item.moduleId)).size !== input.manifest.dependencies.length) throw new Error("DUPLICATE_CLINICAL_MODULE_DEPENDENCY");
    if (input.manifest.compatibilityVersion !== CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION) throw new Error("INCOMPATIBLE_CLINICAL_MODULE");
    if (calculateClinicalModuleHash(input) !== input.moduleHash) throw new Error("INVALID_CLINICAL_MODULE_HASH");
    const identity = key(input.moduleId, input.version);
    if (this.byKey.has(identity)) throw new Error(`DUPLICATE_CLINICAL_MODULE:${identity}`);
    this.byKey.set(identity, deepFreeze(structuredClone(input)) as ClinicalModule);
  }

  get(moduleId: string, version: string): ClinicalModule | undefined {
    return this.byKey.get(key(moduleId, version));
  }

  require(moduleId: string, version: string): ClinicalModule {
    const module = this.get(moduleId, version);
    if (!module) throw new Error(`UNKNOWN_CLINICAL_MODULE:${key(moduleId, version)}`);
    return module;
  }

  versions(moduleId: string): readonly string[] {
    return Object.freeze(this.modules.filter(module => module.moduleId === moduleId).map(module => module.version));
  }

  get modules(): readonly ClinicalModule[] {
    return Object.freeze([...this.byKey.values()].sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.version.localeCompare(right.version)));
  }
}
