import type { ClinicalProcessHandler } from "@/models/ClinicalIntegration";
import type { RespiratoryFailurePatientProcessRuntime } from "@/models/PatientProcessRuntime";
import { applyRespiratoryFailureClinicalEffect, type RespiratoryFailureClinicalEffect } from "@/services/runtime/RespiratoryFailurePatientProcess";

const supported = new Set([
  "INSPIRED_OXYGEN_INCREASED", "INSPIRED_OXYGEN_REMOVED", "UPPER_AIRWAY_PATENCY",
  "AIRWAY_PROTECTED", "EFFECTIVE_VENTILATION",
]);

export const respiratoryFailureClinicalProcessHandler: ClinicalProcessHandler = {
  processType: "RESPIRATORY_FAILURE",
  accepts(input, process) {
    return process.processType === "RESPIRATORY_FAILURE" && supported.has(input.payload.effectType);
  },
  apply(input, process) {
    const effect = input.payload.effectType === "EFFECTIVE_VENTILATION"
      ? { effectType: "EFFECTIVE_VENTILATION" as const, mode: input.payload.parameters.mode === "MECHANICAL" ? "MECHANICAL" as const : "BVM" as const }
      : { effectType: input.payload.effectType } as RespiratoryFailureClinicalEffect;
    const updated = applyRespiratoryFailureClinicalEffect(process as RespiratoryFailurePatientProcessRuntime, effect);
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
