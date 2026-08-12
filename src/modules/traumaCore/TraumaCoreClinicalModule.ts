import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION, traumaCoreManifest } from "./TraumaCoreManifest";
import { traumaCoreRegistrations } from "./TraumaCoreRegistrations";

export const traumaCoreClinicalModule = createClinicalModule({
  moduleId: TRAUMA_CORE_MODULE_ID,
  version: TRAUMA_CORE_MODULE_VERSION,
  manifest: {
    description: traumaCoreManifest.description,
    dependencies: traumaCoreManifest.dependencies,
    compatibilityVersion: traumaCoreManifest.compatibilityVersion,
  },
  registrations: traumaCoreRegistrations,
});
