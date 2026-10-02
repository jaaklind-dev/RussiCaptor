import type { ClinicalTreatmentCommand, ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { AcceptedRuntimePatientCommand, RuntimePatientCommandMaterialization } from "@/models/RuntimePatientCommand";
import { applyClinicalTreatmentLocally } from "@/services/clinical/ClinicalTreatmentCommandService";
import { handleMtpCommand, type MtpAction } from "@/services/runtime/instructor/MassiveTransfusionCommandService";
import { handleResourceInterventionCommand, stopResourceInterventionCommand } from "@/services/runtime/instructor/ResourceInterventionCommandService";
import { materializePatientTransport } from "@/services/runtime/exercise/PatientTransportRuntimeService";
import { isNarvaIroScenarioControlCommandType } from "@/models/NarvaIroScenario";
import { handleNarvaIroScenarioControlCommand } from "@/services/runtime/instructor/NarvaIroScenarioControlCommandService";
import { handleLaboratoryCommand } from "@/services/runtime/instructor/LaboratoryCommandService";
import type { LabPatientBloodIdentity, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
import { handleImagingOrder } from "@/services/runtime/instructor/ImagingCommandService";
import { handleEndotrachealIntubationCommand } from
  "@/services/runtime/instructor/EndotrachealIntubationCommandService";
import { materializePatientCompletionAuthoritatively } from
  "@/services/runtime/exercise/PatientCompletionMaterializationService";
import { materializePatientInternalTransferAuthoritatively } from
  "@/services/runtime/exercise/PatientInternalTransferService";

function rejected(reason: string): RuntimePatientCommandMaterialization {
  return Object.freeze({ status: "REJECTED", result: Object.freeze({ ok: false, reason }) });
}

export function materializeRuntimePatientCommand(command: AcceptedRuntimePatientCommand): RuntimePatientCommandMaterialization;
export function materializeRuntimePatientCommand(command: AcceptedRuntimePatientCommand):
RuntimePatientCommandMaterialization | Promise<RuntimePatientCommandMaterialization> {
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
      const result = materializePatientTransport(command.commandId, command.patientId, resourceId, destinationId,
        command.simulationTimeSec);
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
    if (command.commandType === "LAB_ORDER" || command.commandType === "LAB_COLLECT") {
      const labPackageId = command.payload.labPackageId as NarvaLabPackageId | undefined;
      const orderId = typeof command.payload.orderId === "string" ? command.payload.orderId : undefined;
      if ((command.commandType === "LAB_ORDER" && !labPackageId) ||
        (command.commandType === "LAB_COLLECT" && !orderId)) return rejected("INVALID_COMMAND_PAYLOAD");
      const result = handleLaboratoryCommand({ commandId: command.commandId, exerciseId: command.exerciseId,
        patientId: command.patientId, commandType: command.commandType, actorUserId: command.actorUserId,
        simulationTimeSec: command.simulationTimeSec, patientRevision: command.patientResultingRevision,
        labPackageId, orderId,
        patientBloodIdentity: command.payload.patientBloodIdentity as LabPatientBloodIdentity | undefined });
      return Object.freeze({ status: result.ok ? "MATERIALIZED" : "REJECTED",
        result: Object.freeze({ ...result }) as Readonly<Record<string, unknown>> });
    }
    if (command.commandType === "IMAGING_ORDER") {
      const definitionId = command.payload.definitionId;
      if (typeof definitionId !== "string") return rejected("INVALID_COMMAND_PAYLOAD");
      const result = handleImagingOrder({ commandId: command.commandId, exerciseId: command.exerciseId,
        patientId: command.patientId, actorUserId: command.actorUserId,
        simulationTimeSec: command.simulationTimeSec, definitionId });
      return Object.freeze({ status: result.ok ? "MATERIALIZED" : "REJECTED",
        result: Object.freeze({ ...result }) as Readonly<Record<string, unknown>> });
    }
    if (command.commandType === "ENDOTRACHEAL_INTUBATION") {
      const { tubeResourceId, laryngoscopeResourceId, capnographyResourceId, device,
        tubeSize, cuff, confirmation } = command.payload;
      if (typeof tubeResourceId !== "string" || typeof laryngoscopeResourceId !== "string" ||
        capnographyResourceId !== undefined && typeof capnographyResourceId !== "string" ||
        device !== "DIRECT" && device !== "VIDEO" || typeof tubeSize !== "number" ||
        typeof cuff !== "boolean" || typeof confirmation !== "boolean") return rejected("INVALID_COMMAND_PAYLOAD");
      const result = handleEndotrachealIntubationCommand({ commandId: command.commandId,
        exerciseId: command.exerciseId, patientId: command.patientId, tubeResourceId,
        laryngoscopeResourceId, ...(capnographyResourceId ? { capnographyResourceId } : {}),
        device, tubeSize, cuff, confirmation, issuedBy: command.actorUserId });
      return Object.freeze({ status: result.ok ? "MATERIALIZED" : "REJECTED",
        result: Object.freeze({ ...result }) as Readonly<Record<string, unknown>> });
    }
    if (command.commandType === "PATIENT_COMPLETE") {
      if (Object.keys(command.payload).length !== 0) return rejected("INVALID_COMMAND_PAYLOAD");
      return materializePatientCompletionAuthoritatively({ commandId: command.commandId,
        exerciseId: command.exerciseId, patientId: command.patientId,
        simulationTimeSec: command.simulationTimeSec, actorUserId: command.actorUserId,
        acceptedPatientRevision: command.patientResultingRevision })
        .then(result => Object.freeze({ status: result.ok ? "MATERIALIZED" as const : "REJECTED" as const,
          result: Object.freeze({ ...result }) as Readonly<Record<string, unknown>> }))
        .catch(() => rejected("RUNTIME_MATERIALIZATION_FAILURE"));
    }
    if (command.commandType === "PATIENT_LOCATION_TRANSFER") {
      const actionId = command.payload.actionId;
      if (typeof actionId !== "string" || Object.keys(command.payload).length !== 1) {
        return rejected("INVALID_COMMAND_PAYLOAD");
      }
      return materializePatientInternalTransferAuthoritatively({ commandId: command.commandId,
        exerciseId: command.exerciseId, patientId: command.patientId, actionId,
        simulationTimeSec: command.simulationTimeSec, actorUserId: command.actorUserId,
        acceptedPatientRevision: command.patientResultingRevision })
        .then(result => Object.freeze({ status: result.ok ? "MATERIALIZED" as const : "REJECTED" as const,
          result: Object.freeze({ ...result }) as Readonly<Record<string, unknown>> }))
        .catch(() => rejected("RUNTIME_MATERIALIZATION_FAILURE"));
    }
    return rejected("UNSUPPORTED_COMMAND_TYPE");
  } catch {
    return rejected("RUNTIME_MATERIALIZATION_FAILURE");
  }
}
