import type { InterventionDefinition } from "@/models/InterventionDefinition";

export const oxygenTherapyDefinition: InterventionDefinition = {
  definitionId: "OXYGEN_THERAPY",
  version: "1.0.0",
  name: "Oxygen",
  requiredResources: [{ resourceType: "oxygenMask", quantity: 1 }],
  effects: [{
    effectType: "INSPIRED_OXYGEN_INCREASED",
    parameterMap: { flowRateLMin: "flowRateLMin", deliveryInterface: "deliveryInterface" },
  }],
  duration: { kind: "CONTINUOUS" },
  parameters: [{
    name: "flowRateLMin", type: "NUMBER", required: true, defaultValue: 15, min: 0.1, max: 15,
  }, {
    name: "deliveryInterface", type: "STRING", required: true, defaultValue: "oxygenMask",
  }],
  preconditions: [
    { kind: "ACTIVE_ENCOUNTER" },
    { kind: "RESOURCE_ASSIGNED_TO_PATIENT", resourceType: "oxygenMask" },
  ],
};
