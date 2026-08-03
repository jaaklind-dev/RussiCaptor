import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type { ExerciseClockTarget } from "./ExerciseClockTargetRegistry";

/** Bridges the authoritative exercise clock to an existing scenario engine; it owns no clock state. */
export function createScenarioEngineExerciseClockTarget(engine: ClinicalScenarioEngine, patientId: string): ExerciseClockTarget {
  return { targetId: patientId, advance(fromSimulationTimeSec, toSimulationTimeSec) {
    if (toSimulationTimeSec <= fromSimulationTimeSec) return;
    engine.advanceTo(toSimulationTimeSec);
    engine.dispatch({ sequenceId: "EXERCISE_CLOCK", step: toSimulationTimeSec, offsetSec: toSimulationTimeSec,
      eventType: "ENGINE_TICK", actor: "ScenarioEngine", target: patientId,
      eventId: `EXERCISE_CLOCK:${patientId}:${fromSimulationTimeSec}:${toSimulationTimeSec}`,
      result: "APPLY", payload: { tickMin: (toSimulationTimeSec - fromSimulationTimeSec) / 60 } });
  } };
}
