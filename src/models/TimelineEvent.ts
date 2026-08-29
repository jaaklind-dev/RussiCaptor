import { Visibility } from "@/models/Visibility";

export type TimelineEventType =
  | "assignment"
  | "question"
  | "lab"
  | "imaging"
  | "note"
  | "order"
  | "transfer"
  | "status"
  | "intervention"
  | "medication"
  | "vitals"
  | "instructor";

export type TimelineEvent = {
  id: string;

  exerciseId: string;

  patientId: string;

  timestamp: string;

  type: TimelineEventType;

  title: string;

  description: string;

  author: string;
  /** Immutable authenticated operator id. Missing only on legacy rows. */
  authorId?: string;

  visibility: Visibility;

  /** Canonical exercise time assigned at creation. Legacy persisted rows may omit it. */
  simulationTimeSec?: number;
  /** Stable insertion order assigned at creation. Legacy persisted rows may omit it. */
  sequenceNumber?: number;
};
