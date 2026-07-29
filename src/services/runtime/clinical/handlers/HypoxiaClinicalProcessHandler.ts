import type { ClinicalProcessHandler } from "@/models/ClinicalIntegration";
import type { HypoxiaPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import { setHypoxiaOxygenTherapy } from "@/services/runtime/HypoxiaPatientProcess";

export const hypoxiaClinicalProcessHandler: ClinicalProcessHandler = {
  processType: "HYPOXIA",
  accepts(input, process) {
    return process.processType === "HYPOXIA" &&
      (input.payload.effectType === "INSPIRED_OXYGEN_INCREASED" || input.payload.effectType === "INSPIRED_OXYGEN_REMOVED");
  },
  apply(input, process) {
    const updated = setHypoxiaOxygenTherapy(
      process as HypoxiaPatientProcessRuntime,
      input.payload.effectType === "INSPIRED_OXYGEN_INCREASED"
    );
    return {
      process: updated,
      event: {
        eventType: "ClinicalEffectApplied", timestamp: input.timestamp, inputId: input.inputId,
        encounterId: input.encounterId, sourceId: input.source.sourceId,
        sourceProcessId: updated.processId, instanceKey: updated.instanceKey,
        effectType: input.payload.effectType,
      },
    };
  },
};
