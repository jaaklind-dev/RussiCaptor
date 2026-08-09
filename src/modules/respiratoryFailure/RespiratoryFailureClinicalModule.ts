import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import {
  RESPIRATORY_FAILURE_MODULE_ID,
  RESPIRATORY_FAILURE_MODULE_VERSION,
  respiratoryFailureManifest,
} from "./RespiratoryFailureManifest";
import { respiratoryFailureRegistrations } from "./RespiratoryFailureRegistrations";

export const respiratoryFailureClinicalModule = createClinicalModule({
  moduleId: RESPIRATORY_FAILURE_MODULE_ID,
  version: RESPIRATORY_FAILURE_MODULE_VERSION,
  manifest: {
    description: respiratoryFailureManifest.description,
    dependencies: respiratoryFailureManifest.dependencies,
    compatibilityVersion: respiratoryFailureManifest.compatibilityVersion,
  },
  registrations: respiratoryFailureRegistrations,
});
