import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { alsClinicalModule } from "@/modules/als/AlsClinicalModule";
import { cardiacArrestClinicalModule } from "@/modules/cardiacArrest/CardiacArrestClinicalModule";
import { massiveTransfusionClinicalModule } from "@/modules/massiveTransfusion/MassiveTransfusionClinicalModule";
import { medicationCoreClinicalModule } from "@/modules/medicationCore/MedicationCoreClinicalModule";
import { pelvicInjuryClinicalModule } from "@/modules/pelvicInjury/PelvicInjuryClinicalModule";
import { pleuralInjuryClinicalModule } from "@/modules/pleuralInjury/PleuralInjuryClinicalModule";
import { respiratoryFailureClinicalModule } from "@/modules/respiratoryFailure/RespiratoryFailureClinicalModule";
import { traumaCoreClinicalModule } from "@/modules/traumaCore/TraumaCoreClinicalModule";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { cardiacArrestInterventionDefinitions } from "@/services/runtime/clinical/CardiacArrestInterventionDefinitions";
import { circulationInterventionDefinitions } from "@/services/runtime/clinical/CirculationInterventionDefinitions";
import { oxygenTherapyDefinition } from "@/services/runtime/clinical/OxygenTherapyDefinition";
import { pleuralInterventionDefinitions } from "@/services/runtime/clinical/PleuralInterventionDefinitions";

const modules = [airwayClinicalModule, alsClinicalModule, cardiacArrestClinicalModule, massiveTransfusionClinicalModule,
  medicationCoreClinicalModule, pelvicInjuryClinicalModule, pleuralInjuryClinicalModule,
  respiratoryFailureClinicalModule, traumaCoreClinicalModule] as const;
const definitions = [...airwayInterventionDefinitions, ...cardiacArrestInterventionDefinitions,
  ...circulationInterventionDefinitions, oxygenTherapyDefinition, ...pleuralInterventionDefinitions];

export const canonicalImportBindingCatalog = Object.freeze({
  modules: new Map(modules.map((module) => [`${module.moduleId}@${module.version}`, module])),
  actionDefinitions: new Map(definitions.map((definition) => [definition.definitionId, definition.version])),
});

