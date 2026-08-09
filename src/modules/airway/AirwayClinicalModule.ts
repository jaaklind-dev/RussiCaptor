import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION, airwayManifest } from "./AirwayManifest";
import { airwayRegistrations } from "./AirwayRegistrations";

export const airwayClinicalModule = createClinicalModule({
  moduleId: AIRWAY_MODULE_ID,
  version: AIRWAY_MODULE_VERSION,
  manifest: {
    description: airwayManifest.description,
    dependencies: airwayManifest.dependencies,
    compatibilityVersion: airwayManifest.compatibilityVersion,
  },
  registrations: airwayRegistrations,
});
