import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { MASSIVE_TRANSFUSION_MODULE_ID, MASSIVE_TRANSFUSION_MODULE_VERSION, massiveTransfusionManifest } from "./MassiveTransfusionManifest";
import { massiveTransfusionRegistrations } from "./MassiveTransfusionRegistrations";
export const massiveTransfusionClinicalModule = createClinicalModule({ moduleId: MASSIVE_TRANSFUSION_MODULE_ID, version: MASSIVE_TRANSFUSION_MODULE_VERSION,
  manifest: { description: massiveTransfusionManifest.description, dependencies: massiveTransfusionManifest.dependencies, compatibilityVersion: massiveTransfusionManifest.compatibilityVersion },
  registrations: massiveTransfusionRegistrations });
