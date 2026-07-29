import type { ClinicalProcessHandler, ClinicalProcessRuntime } from "@/models/ClinicalIntegration";
import type { PatientProcessRuntime } from "@/models/PatientProcessRuntime";
import { applyHvAction, setHvOxygenTherapy, type HvAction } from "@/services/runtime/HvPatientProcess";

function actionFor(process: ClinicalProcessRuntime, effectType: string, mode: unknown): HvAction | undefined {
  if (process.processType !== "HYPOVENTILATION_HYPERCAPNIA") return undefined;
  if (effectType === "INSPIRED_OXYGEN_INCREASED") return "OXYGEN_HIGH_FLOW";
  if (effectType === "INSPIRED_OXYGEN_REMOVED") return "OXYGEN_HIGH_FLOW";
  if (effectType === "AIRWAY_PROTECTED") return "INTUBATION";
  if (effectType === "EFFECTIVE_VENTILATION") {
    return mode === "MECHANICAL" ? "MECHANICAL_VENTILATION" : "BVM_VENTILATION";
  }
  return undefined;
}

export const hvClinicalProcessHandler: ClinicalProcessHandler = {
  processType: "HYPOVENTILATION_HYPERCAPNIA",
  accepts(input, process) {
    return process.processType === "HYPOVENTILATION_HYPERCAPNIA" &&
      (input.payload.effectType === "UPPER_AIRWAY_PATENCY" ||
        Boolean(actionFor(process, input.payload.effectType, input.payload.parameters.mode)));
  },
  apply(input, process) {
    const action = actionFor(process, input.payload.effectType, input.payload.parameters.mode);
    if (!action && input.payload.effectType !== "UPPER_AIRWAY_PATENCY") {
      throw new Error(`HV ei toeta effect'i ${input.payload.effectType}.`);
    }
    const updated = input.payload.effectType === "UPPER_AIRWAY_PATENCY"
      ? structuredClone(process as PatientProcessRuntime)
      : input.payload.effectType === "INSPIRED_OXYGEN_REMOVED"
      ? setHvOxygenTherapy(process as PatientProcessRuntime, false)
      : applyHvAction(process as PatientProcessRuntime, action!);
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
