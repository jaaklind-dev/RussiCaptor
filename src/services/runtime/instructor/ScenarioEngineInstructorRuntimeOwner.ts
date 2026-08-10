import type { InstructorPatientCommand } from "@/models/InstructorCommand";
import type { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type { InstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";

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
  };
}
