import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION, pleuralInjuryManifest } from "./PleuralInjuryManifest";
import { pleuralInjuryRegistrations } from "./PleuralInjuryRegistrations";

export const pleuralInjuryClinicalModule = createClinicalModule({ moduleId: PLEURAL_INJURY_MODULE_ID, version: PLEURAL_INJURY_MODULE_VERSION,
  manifest: { description: pleuralInjuryManifest.description, dependencies: pleuralInjuryManifest.dependencies, compatibilityVersion: pleuralInjuryManifest.compatibilityVersion },
  registrations: pleuralInjuryRegistrations });
