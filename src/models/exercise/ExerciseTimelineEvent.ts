export type ExerciseTimelineCategory = "EXERCISE" | "PATIENT" | "COMMAND" | "SYSTEM" | "AUDIT";
export type ExerciseTimelineSeverity = "INFO" | "WARNING" | "ERROR";

export type ExerciseTimelineEvent = Readonly<{
  id: string;
  exerciseId: string;
  simulationTimeSec: number;
  sequenceNumber: number;
  category: ExerciseTimelineCategory;
  type: string;
  severity: ExerciseTimelineSeverity;
  patientId?: string;
  issuedBy?: string;
  title: string;
  description?: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type ExerciseTimelineFilters = Readonly<{
  categories: readonly ExerciseTimelineCategory[];
  severities: readonly ExerciseTimelineSeverity[];
  patientId?: string;
  caseManager?: string;
  search?: string;
}>;

export type ExerciseTimelineGroup = "NONE" | "TODAY" | "SIMULATION_MINUTE" | "PATIENT" | "CATEGORY";
export type ExerciseTimelineGroupSection = Readonly<{ key: string; title: string; events: readonly ExerciseTimelineEvent[] }>;
