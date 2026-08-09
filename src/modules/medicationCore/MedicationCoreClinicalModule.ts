import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import {
  MEDICATION_CORE_MODULE_ID,
  MEDICATION_CORE_MODULE_VERSION,
  medicationCoreManifest,
} from "./MedicationCoreManifest";
import { medicationCoreRegistrations } from "./MedicationCoreRegistrations";

export const medicationCoreClinicalModule = createClinicalModule({
  moduleId: MEDICATION_CORE_MODULE_ID,
  version: MEDICATION_CORE_MODULE_VERSION,
  manifest: {
    description: medicationCoreManifest.description,
    dependencies: medicationCoreManifest.dependencies,
    compatibilityVersion: medicationCoreManifest.compatibilityVersion,
  },
  registrations: medicationCoreRegistrations,
});
