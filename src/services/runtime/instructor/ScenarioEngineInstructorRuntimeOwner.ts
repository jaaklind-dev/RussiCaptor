import type { InstructorPatientCommand } from "@/models/InstructorCommand";
import type { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type { InstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";
import { inferredInterventionDefinitionId } from "@/services/runtime/clinical/InterventionRuntime";

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
      if (command.eventType !== "RESPIRATORY_DETERIORATION") return { ok: false, reason: "No registered runtime handler" };
      return engine.injectRespiratoryDeterioration(command.commandId, command.patientId, command.issuedAtSimulationTime);
    },
    executeClinicalIntervention(commandId, action) {
      const sourceInterventionId = `EXCON:${commandId}`;
      try {
        engine.startClinicalIntervention({ sourceInterventionId, definitionId: action, patientId });
        engine.dispatch({ sequenceId: `SEQ:${commandId}`, step: 1, offsetSec: 1, eventType: "ENGINE_TICK",
          actor: "EXCON", target: patientId, eventId: `TICK:${commandId}`, result: "SUCCESS", payload: { tickMin: 1 / 60 } });
        return { ok: true, runtimeEventId: `INTERVENTION:${sourceInterventionId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Clinical intervention failed" };
      }
    },
    executeResourceIntervention(commandId, resourceId, canonicalSimulationTimeSec) {
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
        if (canonicalSimulationTimeSec !== undefined) return { ok: true, runtimeEventId: `INTERVENTION:${sourceInterventionId}` };
        if (interventionTime > before) engine.advanceTo(interventionTime);
        engine.dispatch({ sequenceId: `SEQ:${commandId}`, step: 1, offsetSec: interventionTime,
          eventType: "ENGINE_TICK", actor: "EXCON", target: patientId, eventId: `TICK:${commandId}`,
          result: "SUCCESS", payload: { tickMin: 1 } });
        return { ok: true, runtimeEventId: `INTERVENTION:${sourceInterventionId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Resource intervention failed" };
      }
    },
    advanceRuntime(commandId, durationSec) {
      try {
        const target = engine.getRuntimeState().exerciseTimeSec + durationSec;
        engine.advanceTo(target);
        engine.dispatch({ sequenceId: `SEQ:${commandId}`, step: 1, offsetSec: target, eventType: "ENGINE_TICK",
          actor: "EXCON", target: patientId, eventId: `TICK:${commandId}`, result: "SUCCESS",
          payload: { tickMin: durationSec / 60 } });
        return { ok: true, runtimeEventId: `TICK:${commandId}` };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "Runtime advance failed" };
      }
    },
  };
}
