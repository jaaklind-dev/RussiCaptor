import type { ClinicalTreatmentCommand, ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { AcceptedRuntimePatientCommand, RuntimePatientCommandMaterialization } from "@/models/RuntimePatientCommand";
import { applyClinicalTreatmentLocally } from "@/services/clinical/ClinicalTreatmentCommandService";
import { handleMtpCommand, type MtpAction } from "@/services/runtime/instructor/MassiveTransfusionCommandService";
import { handleResourceInterventionCommand, stopResourceInterventionCommand } from "@/services/runtime/instructor/ResourceInterventionCommandService";
import { startPatientTransport } from "@/services/runtime/exercise/PatientTransportRuntimeService";
import { isNarvaIroScenarioControlCommandType } from "@/models/NarvaIroScenario";
import { handleNarvaIroScenarioControlCommand } from "@/services/runtime/instructor/NarvaIroScenarioControlCommandService";

function rejected(reason: string): RuntimePatientCommandMaterialization {
  return Object.freeze({ status: "REJECTED", result: Object.freeze({ ok: false, reason }) });
}

export function materializeRuntimePatientCommand(command: AcceptedRuntimePatientCommand): RuntimePatientCommandMaterialization {
  try {
    if (command.commandType === "RESOURCE_APPLY") {
      const resourceId = command.payload.resourceId;
      if (typeof resourceId !== "string") return rejected("INVALID_COMMAND_PAYLOAD");
      const result = handleResourceInterventionCommand({ commandId: command.commandId, exerciseId: command.exerciseId,
        patientId: command.patientId, resourceId, issuedBy: command.actorUserId });
      return Object.freeze({ status: result.ok ? "MATERIALIZED" : "REJECTED", result: Object.freeze({ ...result }) });
    }
    if (command.commandType === "RESOURCE_STOP") {
      const sourceInterventionId = command.payload.sourceInterventionId;
      if (typeof sourceInterventionId !== "string") return rejected("INVALID_COMMAND_PAYLOAD");
      const result = stopResourceInterventionCommand({ commandId: command.commandId, exerciseId: command.exerciseId,
        patientId: command.patientId, sourceInterventionId, issuedBy: command.actorUserId });
      return Object.freeze({ status: result.ok ? "MATERIALIZED" : "REJECTED", result: Object.freeze({ ...result }) });
    }
    if (command.commandType === "MTP") {
      const action = command.payload.action;
      if (typeof action !== "string") return rejected("INVALID_COMMAND_PAYLOAD");
      const result = handleMtpCommand({ commandId: command.commandId, exerciseId: command.exerciseId,
        patientId: command.patientId, action: action as MtpAction,
        units: typeof command.payload.units === "number" ? command.payload.units : undefined,
        issuedBy: command.actorUserId,
        deliveryMode: command.payload.deliveryMode as "GRAVITY" | "PRESSURE_BAG" | "RAPID_INFUSER" | undefined,
        vascularAccessLineId: command.payload.vascularAccessLineId as "IV-1" | "IV-2" | "IV-3" | undefined,
        administrationId: typeof command.payload.administrationId === "string" ? command.payload.administrationId : undefined });
      return Object.freeze({ status: result.ok ? "MATERIALIZED" : "REJECTED", result: Object.freeze({ ...result }) });
    }
    if (command.commandType === "CLINICAL_TREATMENT") {
      const treatmentId = command.payload.treatmentId as ClinicalTreatmentId | undefined;
      const treatmentCommand = command.payload.command as ClinicalTreatmentCommand | undefined;
      if (!treatmentId || !treatmentCommand || typeof treatmentCommand !== "object") return rejected("INVALID_COMMAND_PAYLOAD");
      const result = applyClinicalTreatmentLocally(command.exerciseId, command.patientId, treatmentId, treatmentCommand,
        command.simulationTimeSec);
      return Object.freeze({ status: result.status === "REJECTED" || result.status === "UNAVAILABLE" ? "REJECTED" : "MATERIALIZED",
        result: Object.freeze({ ...result }) as unknown as Readonly<Record<string, unknown>> });
    }
    if (command.commandType === "TRANSPORT_START") {
      const resourceId = command.payload.resourceId;
      const destinationId = command.payload.destinationId;
      if (typeof resourceId !== "string" || typeof destinationId !== "string") return rejected("INVALID_COMMAND_PAYLOAD");
      const result = startPatientTransport(command.commandId, command.patientId, resourceId, destinationId);
      return Object.freeze({ status: result.status === "REJECTED" ? "REJECTED" : "MATERIALIZED",
        result: Object.freeze({ ...result }) as Readonly<Record<string, unknown>> });
    }
    if (isNarvaIroScenarioControlCommandType(command.commandType)) {
      const result = handleNarvaIroScenarioControlCommand({ commandId: command.commandId,
        exerciseId: command.exerciseId, patientId: command.patientId, commandType: command.commandType,
        payload: command.payload, issuedBy: command.actorUserId,
        acceptedDurableSimulationTimeSec: command.simulationTimeSec });
      return Object.freeze({ status: result.ok ? "MATERIALIZED" : "REJECTED",
        result: Object.freeze({ ...result }) as unknown as Readonly<Record<string, unknown>> });
    }
    return rejected("UNSUPPORTED_COMMAND_TYPE");
  } catch {
    return rejected("RUNTIME_MATERIALIZATION_FAILURE");
  }
}
