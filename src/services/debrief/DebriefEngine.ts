import type { Patient } from "@/models/Patient";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import type { CanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";
import { comparePatientIds } from "@/services/runtime/selectors/InstructorDashboardSelector";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import type { DebriefPatientRecord, DebriefReport, PatientDebriefSummary, PatientOutcome } from "./DebriefModel";
import { validateExerciseClock } from "@/services/runtime/exercise/ExerciseClockIntegrityValidator";

export type DebriefPatientSource = Readonly<{
  patient: Pick<Patient, "id" | "name" | "location" | "status">;
  runtime?: CanonicalPatientRuntimeSnapshot;
}>;

export type DebriefSource = Readonly<{
  exercise: CanonicalExerciseSnapshot;
  patients: readonly DebriefPatientSource[];
  timeline: readonly ExerciseTimelineEvent[];
  replayEvents?: readonly unknown[];
}>;

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

function records(events: readonly ExerciseTimelineEvent[], type: string): readonly DebriefPatientRecord[] {
  return events.filter(event => event.type === type).map(event => immutable({
    id: event.id, simulationTimeSec: event.simulationTimeSec, title: event.title, description: event.description,
  }));
}

function locations(patient: DebriefPatientSource, events: readonly ExerciseTimelineEvent[]): [string, string] {
  const movement = events.filter(event => event.type === "TRANSFER" || /location/i.test(event.type));
  const metadataLocations = movement.map(event => {
    const metadata = event.metadata;
    return [metadata?.fromLocation, metadata?.toLocation, metadata?.location].filter(value => typeof value === "string") as string[];
  });
  return [metadataLocations[0]?.[0] ?? patient.patient.location, metadataLocations.at(-1)?.at(-1) ?? patient.patient.location];
}

function outcome(patient: DebriefPatientSource): PatientOutcome {
  const status = patient.runtime?.state.globalStatus;
  if (status === "Dead") return "DECEASED";
  if (patient.patient.status === "Transferred") return "TRANSFERRED";
  if (patient.patient.status === "Completed" || status === "Resolved") return "COMPLETED_SCENARIO";
  return patient.patient.status === "Active" ? "STILL_ACTIVE" : "ALIVE";
}

function summarizePatient(source: DebriefPatientSource, timeline: readonly ExerciseTimelineEvent[]): PatientDebriefSummary {
  const events = timeline.filter(event => event.patientId === source.patient.id);
  const [initialLocation, finalLocation] = locations(source, events);
  const assignedCaseManagers = [...new Set(events.filter(event => event.type === "ASSIGNMENT" && event.issuedBy).map(event => event.issuedBy!))].sort();
  return immutable({
    patientId: source.patient.id, name: source.patient.name, initialLocation, finalLocation, assignedCaseManagers,
    processes: structuredClone(source.runtime?.processes ?? []),
    interventions: records(events, "INTERVENTION"), medications: records(events, "MEDICATION"),
    orders: records(events, "ORDER"), imaging: records(events, "IMAGING"), labs: records(events, "LAB"),
    timelineEventIds: events.map(event => event.id), outcome: outcome(source),
  });
}

/** Pure consumer of canonical artifacts. It never reads or mutates a runtime service. */
export function reconstructDebrief(source: DebriefSource): DebriefReport {
  const timeline = source.timeline.map(event => immutable(structuredClone(event)));
  const patients = source.patients.map(patient => summarizePatient(patient, timeline))
    .sort((a, b) => comparePatientIds(a.patientId, b.patientId));
  const { updatedAtWallClock: _wallClock, clockVersion: _clockVersion, clockInitializedAtSimulationTimeSec: _clockInitialized, ...exercise } = source.exercise;
  const clockIntegrity = validateExerciseClock(source.exercise);
  const generatedFromReplayHash = sha256Text(stableJson({
    exercise, timeline, replayEvents: source.replayEvents ?? [],
    runtime: source.patients.map(item => ({ patientId: item.patient.id, runtime: item.runtime })),
  }));
  return immutable({
    schemaVersion: "1.0", exerciseId: source.exercise.exerciseId, generatedFromReplayHash,
    simulationDurationSec: source.exercise.simulationTimeSec, patientCount: patients.length,
    completedPatients: patients.filter(patient => patient.outcome === "COMPLETED_SCENARIO").length,
    exerciseState: source.exercise.lifecycleState,
    commandCount: timeline.filter(event => event.category === "COMMAND" || event.category === "EXERCISE").length,
    auditCount: timeline.filter(event => event.category === "AUDIT").length,
    timelineLength: timeline.length, patients: immutable(patients), timeline: immutable(timeline),
    generatedAtSimulationTime: source.exercise.simulationTimeSec,
    clockMigrationStatus: clockIntegrity.migrationStatus, clockDiagnostics: clockIntegrity.diagnostics,
  });
}
