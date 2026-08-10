import type { InterventionDefinition } from "@/models/InterventionDefinition";

export const cardiacArrestInterventionDefinitions: InterventionDefinition[] = [
  {
    definitionId: "START_CPR", version: "1.0.0", name: "Start CPR", requiredResources: [],
    effects: [{ effectType: "CPR_STARTED", parameterMap: {} }], duration: { kind: "CONTINUOUS" },
    parameters: [], preconditions: [{ kind: "ACTIVE_ENCOUNTER" }],
  },
  {
    definitionId: "STOP_CPR", version: "1.0.0", name: "Stop CPR", requiredResources: [],
    effects: [{ effectType: "CPR_STOPPED", parameterMap: {} }], duration: { kind: "FIXED", durationSec: 1 },
    parameters: [], preconditions: [{ kind: "ACTIVE_ENCOUNTER" }],
  },
  {
    definitionId: "DEFIBRILLATION", version: "1.0.0", name: "Defibrillation", requiredResources: [],
    effects: [{ effectType: "DEFIBRILLATION_ATTEMPT", parameterMap: {} }], duration: { kind: "FIXED", durationSec: 1 },
    parameters: [], preconditions: [{ kind: "ACTIVE_ENCOUNTER" }],
  },
];
