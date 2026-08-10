import type { CardiacArrestPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { ClinicalProcessHandler } from "@/models/ClinicalIntegration";
import { applyCardiacArrestClinicalEffect } from "@/services/runtime/CardiacArrestPatientProcess";

const accepted = new Set(["CPR_STARTED", "CPR_STOPPED", "DEFIBRILLATION_ATTEMPT"]);

export const cardiacArrestClinicalProcessHandler: ClinicalProcessHandler = {
  processType: "CARDIAC_ARREST",
  accepts(input, process) { return process.processType === "CARDIAC_ARREST" && accepted.has(input.payload.effectType); },
  apply(input, process) {
    const updated = applyCardiacArrestClinicalEffect(process as CardiacArrestPatientProcessRuntime, input.payload);
    return { process: updated, event: {
      eventType: "ClinicalEffectApplied", timestamp: input.timestamp, inputId: input.inputId,
      encounterId: input.encounterId, sourceId: input.source.sourceId,
      sourceProcessId: updated.processId, instanceKey: updated.instanceKey, effectType: input.payload.effectType,
    } };
  },
};
