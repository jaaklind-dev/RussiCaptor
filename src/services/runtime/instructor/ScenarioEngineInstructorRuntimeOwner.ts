import type { InstructorPatientCommand } from "@/models/InstructorCommand";
import type { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type { ImagingRuntimeOwner } from "./InstructorRuntimeEventRegistry";
import { inferredInterventionDefinitionId } from "@/services/runtime/clinical/InterventionRuntime";
import { runtimeWritesAllowed } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { notifySync } from "@/services/SyncService";
import type { ClinicalTreatmentRuntimeResult } from "@/models/ClinicalTreatment";
import { ResourceAwareInterventionError } from "@/services/runtime/clinical/ResourceAwareInterventionError";
import type { NarvaIroVentilationFault } from "@/models/NarvaIroScenario";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";

const readOnly = () => ({ ok: false as const, reason: "Runtime active on another device" });

/** Adapter at the authoritative runtime boundary; UI code never receives the engine instance. */
export function createScenarioEngineInstructorRuntimeOwner(
  engine: ClinicalScenarioEngine,
  exerciseId: string,
  patientId: string
): ImagingRuntimeOwner {
  return {
    exerciseId,
    patientId,
    supportedEvents: ["RESPIRATORY_DETERIORATION"],
    execute(command: InstructorPatientCommand) {
      if (!runtimeWritesAllowed()) return readOnly();
      if (command.eventType !== "RESPIRATORY_DETERIORATION") return { ok: false, reason: "No registered runtime handler" };
      const result = engine.injectRespiratoryDeterioration(command.commandId, command.patientId, command.issuedAtSimulationTime);
      if (result.ok) notifySync("local");
      return result;
    },
    executeClinicalIntervention(commandId, action) {
      if (!runtimeWritesAllowed()) return readOnly();
      const sourceInterventionId = `EXCON:${commandId}`;
      try {
        engine.startClinicalIntervention({ sourceInterventionId, definitionId: action, patientId });
        engine.dispatch({ sequenceId: `SEQ:${commandId}`, step: 1, offsetSec: 1, eventType: "ENGINE_TICK",
          actor: "EXCON", target: patientId, eventId: `TICK:${commandId}`, result: "SUCCESS", payload: { tickMin: 1 / 60 } });
        notifySync("local"); return { ok: true, runtimeEventId: `INTERVENTION:${sourceInterventionId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Clinical intervention failed" };
      }
    },
    executeResourceIntervention(commandId, resourceId, canonicalSimulationTimeSec) {
      if (!runtimeWritesAllowed()) return readOnly();
      const sourceInterventionId = `EXCON:${commandId}`;
      try {
        const resource = engine.getResourcePoolSnapshot().find(item => item.resourceId === resourceId);
        const definitionId = inferredInterventionDefinitionId(resource);
        if (!resource || !definitionId) return { ok: false, reason: "Resource intervention is not supported" };
        const before = engine.getRuntimeState().exerciseTimeSec;
        const interventionTime = canonicalSimulationTimeSec ?? before + 60;
        if (interventionTime < before) return { ok: false, reason: "Canonical exercise clock is behind patient runtime" };
        engine.scheduleIntervention({ interventionId: sourceInterventionId, patientId, resourceId,
          action: "APPLY", timestamp: interventionTime, definitionId });
        if (["PERIPHERAL_IV_ACCESS", "CENTRAL_VENOUS_ACCESS"].includes(definitionId)) {
          engine.applyScheduledResourceInterventionsAtCurrentTime();
        }
        if (canonicalSimulationTimeSec !== undefined) { notifySync("local"); return { ok: true, runtimeEventId: `INTERVENTION:${sourceInterventionId}` }; }
        if (interventionTime > before) engine.advanceTo(interventionTime);
        engine.dispatch({ sequenceId: `SEQ:${commandId}`, step: 1, offsetSec: interventionTime,
          eventType: "ENGINE_TICK", actor: "EXCON", target: patientId, eventId: `TICK:${commandId}`,
          result: "SUCCESS", payload: { tickMin: 1 } });
        notifySync("local"); return { ok: true, runtimeEventId: `INTERVENTION:${sourceInterventionId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Resource intervention failed" };
      }
    },
    executeResourceAwareIntervention(commandId, definitionId, resourceIds, parameters) {
      if (!runtimeWritesAllowed()) return readOnly();
      const sourceInterventionId = `CLINICAL:${commandId}`;
      try {
        const instance = engine.startResourceAwareClinicalIntervention({ sourceInterventionId, definitionId,
          patientId, resourceIds, parameters });
        notifySync("local");
        return { ok: true, runtimeEventId: `INTERVENTION:${instance.instanceId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Clinical intervention failed",
          ...(error instanceof ResourceAwareInterventionError ? { code: error.code } : {}) };
      }
    },
    stopResourceIntervention(commandId, sourceInterventionId) {
      if (!runtimeWritesAllowed()) return readOnly();
      try {
        const stopped = engine.stopClinicalIntervention(sourceInterventionId);
        if (!stopped) return { ok: false, reason: "Active resource intervention was not found" };
        notifySync("local");
        return { ok: true, runtimeEventId: `INTERVENTION-STOP:${commandId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Resource intervention removal failed" };
      }
    },
    executeMtpAction(commandId, action, units, options) {
      if (!runtimeWritesAllowed()) return readOnly();
      try {
        const administrationId = typeof options?.administrationId === "string" ? options.administrationId : undefined;
        const beforeMode = action === "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE" && administrationId
          ? (engine.getPatientProcesses().find(item => item.processType === "MASSIVE_TRANSFUSION") as { clinicalState?: { administrations?: readonly { administrationId: string; deliveryMode?: string }[] } } | undefined)
            ?.clinicalState?.administrations?.find(item => item.administrationId === administrationId)?.deliveryMode
          : undefined;
        engine.dispatch({ sequenceId: `SEQ:${commandId}`, step: 1, offsetSec: engine.getRuntimeState().exerciseTimeSec,
          eventType: "ACTION", actor: "EXCON", target: patientId, eventId: `MTP:${commandId}`, actionId: action,
          result: "SUCCESS", payload: { units, ...options } });
        const changed = action !== "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE" || beforeMode !== options?.deliveryMode;
        if (changed) notifySync("local");
        return { ok: true, runtimeEventId: `MTP:${commandId}`, changed };
      } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "MTP action failed" }; }
    },
    executeClinicalTreatment(request, acceptedDurableSimulationTimeSec) {
      if (!runtimeWritesAllowed()) return Object.freeze({ status: "REJECTED", commandId: request.command.commandId,
        rejectionReason: "INVALID_STATE" }) as ClinicalTreatmentRuntimeResult;
      const result = request.kind === "FLUID" ? engine.executeFluidTherapyCommand(request.command,
        acceptedDurableSimulationTimeSec) :
        request.kind === "NOREPINEPHRINE" ? engine.executeNorepinephrineCommand(request.command,
          acceptedDurableSimulationTimeSec) :
          request.kind === "TXA" ? engine.executeTranexamicAcidCommand(request.command,
            acceptedDurableSimulationTimeSec) :
            request.kind === "ANALGESIC" ? engine.executeAnalgesicCommand(request.command,
              acceptedDurableSimulationTimeSec) :
              request.kind === "MEDICATION" ? engine.executeMedicationCommand(request.command,
                acceptedDurableSimulationTimeSec) :
                request.kind === "VENTILATION" ? engine.executeMechanicalVentilationCommand(request.command,
                  acceptedDurableSimulationTimeSec) :
                  engine.executeAlsMedicationCommand(request.command, acceptedDurableSimulationTimeSec);
      if (result.status === "APPLIED") notifySync("local");
      return result;
    },
    executeNarvaIroScenarioControl(commandId, commandType, faultType, acceptedDurableSimulationTimeSec) {
      if (!runtimeWritesAllowed()) return readOnly();
      const currentSimulationTimeSec = engine.getRuntimeState().exerciseTimeSec;
      const actionTime = acceptedDurableSimulationTimeSec ?? currentSimulationTimeSec;
      const correctionDecision = commandType === "IRO_VENTILATION_FAULT_CORRECT"
        ? engine.getNarvaIroVentilationCorrectionIntentDecision(actionTime)
        : commandType === "IRO_VASOPRESSOR_FAULT_CORRECT"
          ? engine.getNarvaIroVasopressorCorrectionIntentDecision(actionTime) : undefined;
      const controlAudit = Object.freeze({ controlIntentSimulationTimeSec: actionTime,
        controlMaterializationSimulationTimeSec: currentSimulationTimeSec,
        ...(correctionDecision ? { faultEffectiveElapsedSec: correctionDecision.faultEffectiveElapsedSec,
          irreversibleThresholdSec: correctionDecision.irreversibleThresholdSec,
          logicallyCorrectable: correctionDecision.accepted } : {}) });
      try {
        if (!Number.isFinite(actionTime) || actionTime < 0 || actionTime > currentSimulationTimeSec) {
          return { ok: false, reason: "STALE_SIMULATION_TIME", controlAudit };
        }
        if (commandType === "IRO_VASOPRESSOR_FAULT_START") engine.triggerNarvaIroVasopressorFault(actionTime);
        else if (commandType === "IRO_VASOPRESSOR_FAULT_CORRECT") {
          engine.correctNarvaIroVasopressorFault(actionTime, currentSimulationTimeSec);
        }
        else if (commandType === "IRO_VENTILATION_FAULT_START") {
          if (!faultType) return { ok: false, reason: "INVALID_COMMAND_PAYLOAD" };
          engine.triggerNarvaIroVentilationFault(faultType as NarvaIroVentilationFault, actionTime);
        } else if (commandType === "IRO_VENTILATION_FAULT_CORRECT") {
          engine.correctNarvaIroVentilationFault(actionTime, currentSimulationTimeSec);
        }
        else if (commandType === "IRO_HOLD") engine.setNarvaIroHold(true, actionTime);
        else engine.setNarvaIroHold(false, actionTime);
        notifySync("local");
        return { ok: true, runtimeEventId: `NARVA-IRO:${commandId}:${commandType}`, controlAudit };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "IRO scenario control failed",
          controlAudit };
      }
    },
    executeLaboratoryCommand(input) {
      if (!runtimeWritesAllowed()) return readOnly();
      try {
        if (input.commandType === "LAB_ORDER") {
          if (!input.labPackageId) return { ok: false, reason: "INVALID_COMMAND_PAYLOAD" };
          const pkg = getExercisePackage(exerciseId);
          const order = engine.orderLaboratory({ orderId: `LAB-ORDER:${input.commandId}`, exerciseId,
            patientId, exercisePackageId: pkg.packageId,
            authoredCatalogPackageId: pkg.laboratoryConfiguration?.catalogPackageId,
            labPackageId: input.labPackageId, orderedBy: input.actorUserId,
            orderedAtSimulationTimeSec: input.simulationTimeSec });
          notifySync("local");
          return { ok: true, runtimeEventId: order.orderId };
        }
        if (!input.orderId) return { ok: false, reason: "INVALID_COMMAND_PAYLOAD" };
        const collectionTime = engine.getSimulationTimeSec();
        const authoredLab = getExercisePackage(exerciseId).laboratoryConfiguration;
        const sample = engine.collectLaboratorySample({ sampleId: `LAB-SAMPLE:${input.commandId}`,
          orderId: input.orderId, sampledAtSimulationTimeSec: collectionTime,
          sourcePatientRevision: input.patientRevision,
          ...(authoredLab?.resultDelaySeconds ? { resultDelaySeconds: authoredLab.resultDelaySeconds } : {}),
          ...(authoredLab?.patients.find(item => item.patientId === patientId)?.initialResults
            ? { authoredInitialResults: authoredLab.patients.find(item => item.patientId === patientId)!.initialResults } : {}),
          ...(input.patientBloodIdentity ? { patientBloodIdentity: input.patientBloodIdentity } : {}) });
        notifySync("local");
        return { ok: true, runtimeEventId: sample.sampleId };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Laboratory command failed" };
      }
    },
    executeImagingOrder(input) {
      if (!runtimeWritesAllowed()) return readOnly();
      try {
        const pkg = getExercisePackage(exerciseId);
        const configured = pkg.imagingConfiguration?.definitions.find(item =>
          item.study.id === input.definitionId && item.study.patientId === patientId);
        if (!configured) return { ok: false, reason: "IMAGING_DEFINITION_SCOPE_DENIED" };
        const instance = engine.orderImaging({ commandId: input.commandId, exerciseId, patientId,
          orderedBy: input.actorUserId, orderedAtSimulationTimeSec: input.simulationTimeSec,
          definition: { definitionId: configured.study.id, patientId, title: configured.study.title,
            modality: configured.study.modality, reportSource: configured.study.report,
            ...(configured.study.asset ? { asset: configured.study.asset } : {}),
            delaySeconds: configured.order.workflow.delayMinutes * 60, packageId: pkg.packageId,
            packageVersion: pkg.packageVersion, packageHash: pkg.packageHash } });
        notifySync("local");
        return { ok: true, runtimeEventId: instance.imagingInstanceId };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Imaging order failed" };
      }
    },
    advanceRuntime(commandId, durationSec, canonicalSimulationTimeSec) {
      if (!runtimeWritesAllowed()) return readOnly();
      try {
        const before = engine.getRuntimeState().exerciseTimeSec;
        const target = canonicalSimulationTimeSec ?? before + durationSec;
        if (target < before) return { ok: false, reason: "Canonical exercise clock is behind patient runtime" };
        // A RUNNING exercise advances through the canonical Exercise Clock so
        // every registered patient target observes the same tick exactly once.
        if (canonicalSimulationTimeSec !== undefined) {
          return { ok: true, runtimeEventId: `TICK:${commandId}` };
        }
        engine.advanceTo(target);
        engine.dispatch({ sequenceId: `SEQ:${commandId}`, step: 1, offsetSec: target, eventType: "ENGINE_TICK",
          actor: "EXCON", target: patientId, eventId: `TICK:${commandId}`, result: "SUCCESS",
          payload: { tickMin: durationSec / 60 } });
        notifySync("local"); return { ok: true, runtimeEventId: `TICK:${commandId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Runtime advance failed" };
      }
    },
  };
}
