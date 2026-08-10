import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { CARDIAC_ARREST_MODULE_ID, CARDIAC_ARREST_MODULE_VERSION, cardiacArrestManifest } from "./CardiacArrestManifest";
import { cardiacArrestRegistrations } from "./CardiacArrestRegistrations";

export const cardiacArrestClinicalModule = createClinicalModule({
  moduleId: CARDIAC_ARREST_MODULE_ID, version: CARDIAC_ARREST_MODULE_VERSION,
  manifest: { description: cardiacArrestManifest.description, dependencies: cardiacArrestManifest.dependencies,
    compatibilityVersion: cardiacArrestManifest.compatibilityVersion },
  registrations: cardiacArrestRegistrations,
});
