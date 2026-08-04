import type { AnalyticsEvaluationContext, AnalyticsMetricProvider, MetricResult } from "@/models/analytics/Analytics";
import { coreMetricIndex, definition, eventEvidence, evidence, legacyDuration, unavailableResult, valueResult } from "./CoreMetricsSupport";
const id = "core.exercise";
const defs = Object.freeze([
  definition(id, "exercise.duration.seconds", "Exercise duration", "Canonical exercise duration", "EXERCISE_FLOW", "SECONDS", "EXERCISE"),
  definition(id, "exercise.pause.count", "Pause count", "Accepted exercise pauses", "EXERCISE_FLOW", "COUNT", "EXERCISE"),
  definition(id, "exercise.paused_duration.seconds", "Total paused duration", "Time spent paused", "EXERCISE_FLOW", "SECONDS", "EXERCISE"),
  definition(id, "exercise.running_duration.seconds", "Running duration", "Exercise duration excluding pauses", "EXERCISE_FLOW", "SECONDS", "EXERCISE"),
  definition(id, "exercise.speed.average", "Average simulation speed", "Average of observed canonical speed settings", "EXERCISE_FLOW", "RATIO", "EXERCISE"),
  definition(id, "exercise.speed.maximum", "Maximum simulation speed", "Maximum configured simulation speed", "EXERCISE_FLOW", "RATIO", "EXERCISE"),
  definition(id, "exercise.control_command.count", "Exercise control commands", "Accepted and rejected exercise control commands", "COMMANDS", "COUNT", "EXERCISE"),
  definition(id, "exercise.timeline.event_count", "Timeline event count", "Canonical timeline events", "EXERCISE_FLOW", "COUNT", "EXERCISE"),
  definition(id, "exercise.audit.event_count", "Audit event count", "Canonical audit events", "COMMANDS", "COUNT", "EXERCISE"),
]);
function evaluate(context: AnalyticsEvaluationContext): readonly MetricResult[] { const debrief = context.debrief; const index = coreMetricIndex(debrief); const pauses = index.timeline.filter(event => event.type === "ExercisePaused"); const durationEvidence = [evidence("DEBRIEF_FIELD", "simulationDurationSec")]; const legacy = legacyDuration(context); let paused = 0; for (const pause of pauses) { const end = index.timeline.find(event => event.simulationTimeSec >= pause.simulationTimeSec && (event.type === "ExerciseResumed" || event.type === "ExerciseCompleted")); paused += Math.max(0, (end?.simulationTimeSec ?? debrief.simulationDurationSec) - pause.simulationTimeSec); } const speedValues = index.controlEvents.map(event => Number(event.metadata?.resultingSpeed)).filter(Number.isFinite); const unavailable = (def: typeof defs[number]) => unavailableResult(def, "LEGACY_EXERCISE_CLOCK", "Duration-dependent metric unavailable for legacy clock", durationEvidence); return Object.freeze([
  legacy ? unavailable(defs[0]) : valueResult(defs[0], debrief.simulationDurationSec, durationEvidence), valueResult(defs[1], pauses.length, eventEvidence(pauses).length ? eventEvidence(pauses) : [evidence("DEBRIEF_FIELD", "timeline")]),
  legacy ? unavailable(defs[2]) : valueResult(defs[2], paused, eventEvidence(pauses).length ? eventEvidence(pauses) : durationEvidence), legacy ? unavailable(defs[3]) : valueResult(defs[3], Math.max(0, debrief.simulationDurationSec - paused), durationEvidence),
  legacy ? unavailable(defs[4]) : valueResult(defs[4], speedValues.length ? speedValues.reduce((sum, value) => sum + value, 0) / speedValues.length : 1, eventEvidence(index.controlEvents).length ? eventEvidence(index.controlEvents) : durationEvidence), valueResult(defs[5], speedValues.length ? Math.max(1, ...speedValues) : 1, eventEvidence(index.controlEvents).length ? eventEvidence(index.controlEvents) : [evidence("DEBRIEF_FIELD", "exerciseState")]),
  valueResult(defs[6], index.controlEvents.length, eventEvidence(index.controlEvents).length ? eventEvidence(index.controlEvents) : [evidence("DEBRIEF_FIELD", "commandCount")]), valueResult(defs[7], debrief.timelineLength, [evidence("DEBRIEF_FIELD", "timelineLength")]), valueResult(defs[8], debrief.auditCount, [evidence("DEBRIEF_FIELD", "auditCount")]),
]); }
export const ExerciseMetricsProvider: AnalyticsMetricProvider = Object.freeze({ providerId: id, version: "1.0.0", getDefinitions: () => defs, evaluate });
