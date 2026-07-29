import type { InterventionDefinition } from "@/models/InterventionDefinition";
import { oxygenTherapyDefinition } from "@/services/runtime/clinical/OxygenTherapyDefinition";

const continuous = { kind: "CONTINUOUS" as const };
const activeEncounter = { kind: "ACTIVE_ENCOUNTER" as const };

export const airwayInterventionDefinitions: InterventionDefinition[] = [
  oxygenTherapyDefinition,
  {
    definitionId: "OROPHARYNGEAL_AIRWAY", version: "1.0.0", name: "Oropharyngeal airway",
    requiredResources: [{ resourceType: "oropharyngealAirway", quantity: 1 }],
    effects: [{ effectType: "UPPER_AIRWAY_PATENCY", parameterMap: { device: "device" } }],
    duration: continuous, parameters: [{ name: "device", type: "STRING", required: true, defaultValue: "OPA" }],
    preconditions: [activeEncounter, { kind: "CLINICAL_FLAG", flag: "unconscious", equals: true },
      { kind: "CLINICAL_FLAG", flag: "gagReflexAbsent", equals: true }],
  },
  {
    definitionId: "NASOPHARYNGEAL_AIRWAY", version: "1.0.0", name: "Nasopharyngeal airway",
    requiredResources: [{ resourceType: "nasopharyngealAirway", quantity: 1 }],
    effects: [{ effectType: "UPPER_AIRWAY_PATENCY", parameterMap: { device: "device" } }],
    duration: continuous, parameters: [{ name: "device", type: "STRING", required: true, defaultValue: "NPA" }],
    preconditions: [activeEncounter, { kind: "CLINICAL_FLAG", flag: "spontaneousBreathing", equals: true }],
  },
  ...(["iGel", "laryngealMask"] as const).map((resourceType): InterventionDefinition => ({
    definitionId: resourceType === "iGel" ? "SUPRAGLOTTIC_IGEL" : "SUPRAGLOTTIC_LMA",
    version: "1.0.0", name: resourceType === "iGel" ? "Supraglottic airway (i-gel)" : "Supraglottic airway (LMA)",
    requiredResources: [{ resourceType, quantity: 1 }],
    effects: [{ effectType: "AIRWAY_PROTECTED", parameterMap: { device: "device" } }],
    duration: continuous, parameters: [{ name: "device", type: "STRING", required: true, defaultValue: "SUPRAGLOTTIC" }],
    preconditions: [activeEncounter],
  })),
  {
    definitionId: "BAG_VALVE_MASK_VENTILATION", version: "1.0.0", name: "BVM ventilation",
    requiredResources: [{ resourceType: "bagValveMask", quantity: 1 }, { resourceType: "oxygen", quantity: 1, optional: true }],
    effects: [{ effectType: "EFFECTIVE_VENTILATION", parameterMap: { mode: "mode", ventilationRate: "ventilationRate", oxygenSource: "oxygenSource" } }],
    duration: continuous,
    parameters: [{ name: "mode", type: "STRING", required: true, defaultValue: "BVM" },
      { name: "ventilationRate", type: "NUMBER", required: true, defaultValue: 12, min: 4, max: 30 },
      { name: "oxygenSource", type: "BOOLEAN", required: false, defaultValue: false }],
    preconditions: [activeEncounter],
  },
  {
    definitionId: "ENDOTRACHEAL_INTUBATION", version: "1.0.0", name: "Endotracheal intubation",
    requiredResources: [{ resourceType: "endotrachealTube", quantity: 1 }, { resourceType: "directLaryngoscope", quantity: 1 },
      { resourceType: "capnography", quantity: 1, optional: true }],
    effects: [{ effectType: "AIRWAY_PROTECTED", parameterMap: { device: "device", confirmed: "confirmation" } }],
    duration: continuous,
    parameters: [{ name: "device", type: "STRING", required: true, defaultValue: "ENDOTRACHEAL" },
      { name: "tubeSize", type: "NUMBER", required: true, defaultValue: 7.5, min: 2, max: 12 },
      { name: "cuff", type: "BOOLEAN", required: true, defaultValue: true },
      { name: "confirmation", type: "BOOLEAN", required: true, defaultValue: false }],
    preconditions: [activeEncounter],
  },
  {
    definitionId: "MECHANICAL_VENTILATION", version: "1.0.0", name: "Mechanical ventilation",
    requiredResources: [{ resourceType: "ventilator", quantity: 1 }],
    effects: [], duration: continuous,
    parameters: [{ name: "mode", type: "STRING", required: true, defaultValue: "VC" },
      { name: "respiratoryRate", type: "NUMBER", required: true, defaultValue: 12, min: 1, max: 60 },
      { name: "tidalVolumeMl", type: "NUMBER", required: true, defaultValue: 500, min: 50, max: 1500 },
      { name: "peep", type: "NUMBER", required: true, defaultValue: 5, min: 0, max: 30 },
      { name: "fio2", type: "NUMBER", required: true, defaultValue: 0.4, min: 0.21, max: 1 }],
    preconditions: [activeEncounter],
  },
];
