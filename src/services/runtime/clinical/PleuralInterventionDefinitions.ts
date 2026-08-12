import type { InterventionDefinition } from "@/models/InterventionDefinition";

export const pleuralInterventionDefinitions: InterventionDefinition[] = [{
  definitionId: "CHEST_DRAIN_INSERTION",
  version: "1.0.0",
  name: "Chest drain insertion",
  requiredResources: [{ resourceType: "chestDrain", quantity: 1 }],
  effects: [{ effectType: "PLEURAL_DRAINAGE", parameterMap: {} }],
  duration: { kind: "CONTINUOUS" },
  parameters: [],
  preconditions: [{ kind: "ACTIVE_ENCOUNTER" }, { kind: "RESOURCE_ASSIGNED_TO_PATIENT", resourceType: "chestDrain" }],
}];
