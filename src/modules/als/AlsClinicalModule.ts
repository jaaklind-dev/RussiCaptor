import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { ALS_MODULE_ID, ALS_MODULE_VERSION, alsManifest } from "./AlsManifest";
import { alsRegistrations } from "./AlsRegistrations";

export const alsClinicalModule = createClinicalModule({
  moduleId: ALS_MODULE_ID,
  version: ALS_MODULE_VERSION,
  manifest: {
    description: alsManifest.description,
    dependencies: alsManifest.dependencies,
    compatibilityVersion: alsManifest.compatibilityVersion,
  },
  registrations: alsRegistrations,
});
