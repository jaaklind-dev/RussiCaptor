import type { ExerciseControlAuditEntry } from "@/models/exercise/ExerciseControlCommand";
import type { ExerciseTimelineEvent, ExerciseTimelineSeverity } from "@/models/exercise/ExerciseTimelineEvent";
import type { InstructorCommandAuditEntry } from "@/models/InstructorCommand";
import type { TimelineEvent } from "@/models/TimelineEvent";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { getAllTimelineEvents } from "@/repositories/TimelineRepository";
import { getInstructorCommandAudit } from "@/features/instructor/commands/InstructorPatientCommandHandler";
import { getExerciseControlAudit } from "./ExerciseControlCommandHandler";

type Candidate = Omit<ExerciseTimelineEvent, "sequenceNumber"> & { readonly sourceRank: number; readonly sourceOrder: number };
const exerciseTitles: Record<string, string> = { ExerciseStarted: "Exercise started", ExercisePaused: "Exercise paused", ExerciseResumed: "Exercise resumed", ExerciseCompleted: "Exercise completed", ExerciseSpeedChanged: "Simulation speed changed" };
const instructorTitles: Record<string, string> = { RESPIRATORY_DETERIORATION: "Respiratory deterioration injected", AIRWAY_OBSTRUCTION: "Airway obstruction injected", VOMITING: "Vomiting injected", HYPOTENSION: "Hypotension injected", REDUCED_CONSCIOUSNESS: "Reduced consciousness injected", RECOVERY_TRIGGER: "Recovery triggered" };

function severity(outcome: "ACCEPTED" | "REJECTED", code?: string): ExerciseTimelineSeverity {
  if (outcome === "ACCEPTED") return "INFO";
  return code === "RUNTIME_FAILURE" ? "ERROR" : "WARNING";
}

function controlCandidate(entry: ExerciseControlAuditEntry, index: number): Candidate | undefined {
  if (!entry.exerciseId || !entry.commandId || !entry.commandType) return undefined;
  const rejected = entry.outcome === "REJECTED";
  return { id: `EXERCISE-CONTROL:${entry.commandId}`, exerciseId: entry.exerciseId, simulationTimeSec: entry.simulationTimeSec,
    category: rejected ? "AUDIT" : "EXERCISE", type: entry.eventType ?? entry.commandType, severity: severity(entry.outcome, entry.rejectionCode),
    issuedBy: entry.issuer, title: rejected ? "Exercise command rejected" : (exerciseTitles[entry.eventType ?? ""] ?? entry.commandType),
    description: rejected ? entry.rejectionCode : undefined,
    metadata: Object.freeze({ commandId: entry.commandId, commandType: entry.commandType, previousState: entry.previousState,
      resultingState: entry.resultingState, previousSpeed: entry.previousSpeed, resultingSpeed: entry.resultingSpeed,
      outcome: entry.outcome, rejectionCode: entry.rejectionCode }), sourceRank: 0, sourceOrder: index };
}

function instructorCandidate(entry: InstructorCommandAuditEntry, index: number): Candidate | undefined {
  if (!entry.exerciseId || !entry.commandId || !entry.eventType) return undefined;
  const rejected = entry.outcome === "REJECTED";
  return { id: `INSTRUCTOR-COMMAND:${entry.commandId}`, exerciseId: entry.exerciseId, patientId: entry.patientId,
    simulationTimeSec: entry.simulationTime ?? 0, category: rejected ? "AUDIT" : "COMMAND", type: entry.eventType,
    severity: severity(entry.outcome, entry.errorCode), issuedBy: entry.issuedBy,
    title: rejected ? "Patient event command rejected" : (instructorTitles[entry.eventType] ?? entry.eventType),
    description: rejected ? entry.errorCode : undefined,
    metadata: Object.freeze({ commandId: entry.commandId, eventType: entry.eventType, outcome: entry.outcome, errorCode: entry.errorCode, runtimeEventId: entry.runtimeEventId }),
    sourceRank: 1, sourceOrder: index };
}

function patientCandidate(entry: TimelineEvent, index: number): Candidate | undefined {
  if (entry.type === "instructor") return undefined;
  const category = entry.type === "assignment" || entry.type === "transfer" ? "AUDIT" as const : "PATIENT" as const;
  return { id: `PATIENT-EVENT:${entry.exerciseId}:${entry.sequenceNumber ?? index + 1}`, exerciseId: entry.exerciseId,
    patientId: entry.patientId, simulationTimeSec: entry.simulationTimeSec ?? 0, category, type: entry.type.toUpperCase(),
    severity: "INFO", issuedBy: entry.author, title: entry.title, description: entry.description,
    metadata: Object.freeze({ sourceEventType: entry.type, visibility: entry.visibility }), sourceRank: 2,
    sourceOrder: entry.sequenceNumber ?? index + 1 };
}

/** Pure read-only projection of existing canonical audit and patient event sources. */
export function aggregateExerciseTimeline(input: { exerciseId: string; controls: readonly ExerciseControlAuditEntry[]; commands: readonly InstructorCommandAuditEntry[]; patientEvents: readonly TimelineEvent[] }): readonly ExerciseTimelineEvent[] {
  const candidates = [
    ...input.controls.map(controlCandidate), ...input.commands.map(instructorCandidate), ...input.patientEvents.map(patientCandidate),
  ].filter((item): item is Candidate => Boolean(item) && item!.exerciseId === input.exerciseId)
    .sort((a, b) => a.simulationTimeSec - b.simulationTimeSec || a.sourceRank - b.sourceRank || a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));
  return Object.freeze(candidates.map(({ sourceRank: _rank, sourceOrder: _order, ...event }, index) => Object.freeze({ ...event, sequenceNumber: index + 1 })));
}

export function getCanonicalExerciseTimeline(): readonly ExerciseTimelineEvent[] {
  return aggregateExerciseTimeline({ exerciseId: getCurrentExercise().id, controls: getExerciseControlAudit(), commands: getInstructorCommandAudit(), patientEvents: getAllTimelineEvents() });
}
