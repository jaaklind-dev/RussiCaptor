import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type { ExerciseClockTarget } from "./ExerciseClockTargetRegistry";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

/** Bridges the authoritative exercise clock to an existing scenario engine; it owns no clock state. */
export function createScenarioEngineExerciseClockTarget(engine: ClinicalScenarioEngine, patientId: string): ExerciseClockTarget {
  return { targetId: patientId, advance(fromSimulationTimeSec, toSimulationTimeSec) {
    if (toSimulationTimeSec <= fromSimulationTimeSec) return;
    if (engine.getRuntimeState().exerciseTimeSec >= toSimulationTimeSec) return;
    const runningAccessIds = new Set(engine.getInterventionInstances(patientId).filter(item => item.status === "RUNNING" &&
      (item.definitionId === "PERIPHERAL_IV_ACCESS" || item.definitionId === "CENTRAL_VENOUS_ACCESS")).map(item => item.instanceId));
    engine.advanceTo(toSimulationTimeSec);
    engine.dispatch({ sequenceId: "EXERCISE_CLOCK", step: toSimulationTimeSec, offsetSec: toSimulationTimeSec,
      eventType: "ENGINE_TICK", actor: "ScenarioEngine", target: patientId,
      eventId: `EXERCISE_CLOCK:${patientId}:${fromSimulationTimeSec}:${toSimulationTimeSec}`,
      result: "APPLY", payload: { tickMin: (toSimulationTimeSec - fromSimulationTimeSec) / 60 } });
    for (const completed of engine.getInterventionInstances(patientId).filter(item => item.status === "COMPLETED" && runningAccessIds.has(item.instanceId))) {
      const central = completed.definitionId === "CENTRAL_VENOUS_ACCESS"; const simulationTimeSec = completed.endedAt ?? toSimulationTimeSec;
      addTimelineEvent({ id: `TL-ACCESS-COMPLETED-${completed.instanceId}`, exerciseId: getCanonicalExerciseSnapshot().exerciseId,
        patientId, timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "intervention",
        title: central ? "Tsentraalveenitee rajatud" : "Perifeerne veenitee rajatud",
        description: `${central ? "Tsentraalse" : "Perifeerse"} veenitee rajamine lõpetati`, author: "Scenario Runtime", visibility: "revealed" });
    }
  } };
}
