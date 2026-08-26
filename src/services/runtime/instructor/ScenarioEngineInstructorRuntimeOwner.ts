import type { InstructorPatientCommand } from "@/models/InstructorCommand";
import type { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type { InstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";
import { inferredInterventionDefinitionId } from "@/services/runtime/clinical/InterventionRuntime";
import { runtimeWritesAllowed } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { notifySync } from "@/services/SyncService";

const readOnly = () => ({ ok: false as const, reason: "Runtime active on another device" });

/** Adapter at the authoritative runtime boundary; UI code never receives the engine instance. */
export function createScenarioEngineInstructorRuntimeOwner(
  engine: ClinicalScenarioEngine,
  exerciseId: string,
  patientId: string
): InstructorRuntimeOwner {
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
