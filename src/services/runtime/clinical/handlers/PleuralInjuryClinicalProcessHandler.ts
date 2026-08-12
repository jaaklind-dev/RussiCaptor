import type { ClinicalProcessHandler } from "@/models/ClinicalIntegration";
import type { PleuralInjuryPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import { applyPleuralEffects } from "@/services/runtime/PleuralInjuryPatientProcess";

export const pleuralInjuryClinicalProcessHandler: ClinicalProcessHandler = {
  processType: "PLEURAL_INJURY",
  accepts(input, process) { return process.processType === "PLEURAL_INJURY" && input.payload.effectType === "PLEURAL_DRAINAGE"; },
  apply(input, process) {
    const updated = applyPleuralEffects(process as PleuralInjuryPatientProcessRuntime, [{ ...input.payload, effectId: input.inputId,
      encounterId: input.encounterId, patientId: input.patientId, timestamp: input.timestamp,
      sourceInterventionInstanceId: input.source.sourceId }]);
    return { process: updated, event: { eventType: "ClinicalEffectApplied", timestamp: input.timestamp, inputId: input.inputId,
      encounterId: input.encounterId, sourceId: input.source.sourceId, sourceProcessId: updated.processId,
      instanceKey: updated.instanceKey, effectType: input.payload.effectType } };
  },
};
