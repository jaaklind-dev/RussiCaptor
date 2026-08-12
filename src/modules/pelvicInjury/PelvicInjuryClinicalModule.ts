import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION, pelvicInjuryManifest } from "./PelvicInjuryManifest";
import { pelvicInjuryRegistrations } from "./PelvicInjuryRegistrations";

export const pelvicInjuryClinicalModule = createClinicalModule({
  moduleId: PELVIC_INJURY_MODULE_ID,
  version: PELVIC_INJURY_MODULE_VERSION,
  manifest: { description: pelvicInjuryManifest.description, dependencies: pelvicInjuryManifest.dependencies, compatibilityVersion: pelvicInjuryManifest.compatibilityVersion },
  registrations: pelvicInjuryRegistrations,
});
