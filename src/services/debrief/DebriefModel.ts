import type { ExerciseLifecycleState } from "@/models/exercise/CanonicalExerciseSnapshot";
import type { ExerciseTimelineCategory, ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import type { RuntimeProcessProjection } from "@/services/RuntimeSnapshotService";

export type PatientOutcome = "ALIVE" | "DECEASED" | "TRANSFERRED" | "STILL_ACTIVE" | "COMPLETED_SCENARIO";

export type DebriefPatientRecord = Readonly<{
  id: string;
  simulationTimeSec: number;
  title: string;
  description?: string;
}>;

export type PatientDebriefSummary = Readonly<{
  patientId: string;
  name: string;
  initialLocation: string;
  finalLocation: string;
  assignedCaseManagers: readonly string[];
  processes: readonly RuntimeProcessProjection[];
  interventions: readonly DebriefPatientRecord[];
  medications: readonly DebriefPatientRecord[];
  orders: readonly DebriefPatientRecord[];
  imaging: readonly DebriefPatientRecord[];
  labs: readonly DebriefPatientRecord[];
  timelineEventIds: readonly string[];
  outcome: PatientOutcome;
}>;

export type DebriefReport = Readonly<{
  schemaVersion: "1.0";
  exerciseId: string;
  generatedFromReplayHash: string;
  simulationDurationSec: number;
  patientCount: number;
  completedPatients: number;
  exerciseState: ExerciseLifecycleState;
  commandCount: number;
  auditCount: number;
  timelineLength: number;
  patients: readonly PatientDebriefSummary[];
  timeline: readonly ExerciseTimelineEvent[];
  generatedAtSimulationTime: number;
}>;

export type PlaybackCursor = Readonly<{
  simulationTimeSec: number;
  selectedEventId?: string;
  selectedPatientId?: string;
  playing: boolean;
}>;

export type DebriefFilters = Readonly<{
  patientId?: string;
  caseManager?: string;
  category?: ExerciseTimelineCategory;
  exercisePhase?: ExerciseLifecycleState;
  outcome?: PatientOutcome;
  search?: string;
}>;

export type PatientPlaybackView = Readonly<{
  patient: PatientDebriefSummary;
  events: readonly ExerciseTimelineEvent[];
  processes: readonly RuntimeProcessProjection[];
  simulationTimeSec: number;
}>;

