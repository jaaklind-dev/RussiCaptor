import type { ProjectionPublicationStamp, ProjectionPublicationRejectionReason } from "./ExerciseProjectionPublicationGuard";

/** Only mutation paths create intents. Foreground/reconnect may wake an existing intent. */
export type ProjectionPublicationOrigin = "LOCAL_STATE_CHANGE" | "EXPLICIT_TERMINAL_RECONCILIATION";
export type ProjectionPublicationWake = ProjectionPublicationOrigin | "APPSTATE_RESUME" | "REALTIME_RECONNECT" | "BACKGROUND_FLUSH";
export type ProjectionPublicationIntent = Readonly<{
  intentId: string;
  origin: ProjectionPublicationOrigin;
  createdAtMs: number;
  stamp: ProjectionPublicationStamp;
}>;
export type ProjectionPublicationDiagnostic = Readonly<{
  intentId: string;
  event: "QUEUED" | "WAKE" | "REJECTED" | "SENT" | "ACK" | "FAILED";
  atMs: number;
  createdAtMs: number;
  origin: ProjectionPublicationOrigin;
  wake?: ProjectionPublicationWake;
  exerciseId: string;
  lifecycleState: string;
  authGeneration: number;
  cloudGeneration: number;
  runtimeGeneration: number;
  readerGeneration?: number;
  exerciseBindingGeneration?: number;
  writerGeneration?: number;
  publicationGeneration: number;
  sourceSyncVersion: number;
  sendAttempt: number;
  reason?: ProjectionPublicationRejectionReason | "PUBLICATION_FENCED" | "TERMINAL_STATE_DOMINATES" | "AUTH_USER_MISMATCH" | "PACKAGE_DIVERGENCE";
  httpStatus?: number;
}>;

const MAX_EVENTS = 128;
let sequence = 0;
const events: ProjectionPublicationDiagnostic[] = [];

export function createProjectionPublicationIntent(
  stamp: ProjectionPublicationStamp,
  origin: ProjectionPublicationOrigin,
  now = Date.now(),
): ProjectionPublicationIntent {
  sequence += 1;
  return Object.freeze({ intentId: `projection-${now}-${sequence}`, origin, createdAtMs: now, stamp });
}

/** Fixed-field serialization deliberately cannot accept tokens, credentials, payloads or headers. */
export function recordProjectionPublicationDiagnostic(
  intent: ProjectionPublicationIntent,
  event: ProjectionPublicationDiagnostic["event"],
  options: Readonly<{ wake?: ProjectionPublicationWake; sendAttempt?: number; reason?: ProjectionPublicationDiagnostic["reason"]; httpStatus?: number }> = {},
): ProjectionPublicationDiagnostic {
  const diagnostic: ProjectionPublicationDiagnostic = Object.freeze({
    intentId: intent.intentId, event, atMs: Date.now(), createdAtMs: intent.createdAtMs, origin: intent.origin,
    wake: options.wake, exerciseId: intent.stamp.exerciseId, lifecycleState: intent.stamp.lifecycleState,
    authGeneration: intent.stamp.authGeneration, cloudGeneration: intent.stamp.cloudGeneration,
    runtimeGeneration: intent.stamp.runtimeGeneration,
    readerGeneration: intent.stamp.readerGeneration, exerciseBindingGeneration: intent.stamp.readerGeneration,
    writerGeneration: intent.stamp.writerGeneration,
    publicationGeneration: intent.stamp.mutationGeneration, sourceSyncVersion: intent.stamp.syncVersion,
    sendAttempt: options.sendAttempt ?? 0, reason: options.reason, httpStatus: options.httpStatus,
  });
  events.push(diagnostic);
  if (events.length > MAX_EVENTS) events.shift();
  console.info("EXERCISE_STATE_PUBLICATION", JSON.stringify(diagnostic));
  return diagnostic;
}

export function getProjectionPublicationDiagnostics(): readonly ProjectionPublicationDiagnostic[] {
  return Object.freeze(events.map(event => Object.freeze({ ...event })));
}
