export type ExerciseDiscoveryRefreshTrigger = "startup" | "manual" | "foreground" | "reconnect" | "safety_poll";

export type DiscoveryInstrumentation = Readonly<{
  operation: string;
  endpoint: string;
  reconnect?: boolean;
  avoidedRequests?: number;
  estimatedBytesSaved?: number;
}>;

export const LEGACY_EXERCISE_DISCOVERY_INTERVAL_MS = 5_000;
export const EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS = 60_000;
export const EXERCISE_DISCOVERY_RECENT_INVALIDATION_WINDOW_MS = 2_000;

export function avoidedLegacyPollsPerSafetyInterval(): number {
  return EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS / LEGACY_EXERCISE_DISCOVERY_INTERVAL_MS - 1;
}

export function estimateStableDiscoveryTraffic(responseBytes: number, hours = 1): Readonly<{
  beforeRequests: number;
  afterRequests: number;
  beforeBytes: number;
  afterBytes: number;
  reductionPercent: number;
}> {
  const durationMs = Math.max(0, hours) * 60 * 60 * 1_000;
  const beforeRequests = Math.floor(durationMs / LEGACY_EXERCISE_DISCOVERY_INTERVAL_MS);
  const afterRequests = Math.floor(durationMs / EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS);
  const beforeBytes = beforeRequests * Math.max(0, responseBytes);
  const afterBytes = afterRequests * Math.max(0, responseBytes);
  return Object.freeze({ beforeRequests, afterRequests, beforeBytes, afterBytes,
    reductionPercent: beforeBytes === 0 ? 0 : Number(((1 - afterBytes / beforeBytes) * 100).toFixed(1)) });
}

/** Coalesces startup, foreground, reconnect, manual and safety refreshes onto
 * one authoritative discovery query. Realtime is only a reconnect signal;
 * durable exercise selection continues to come from the database query. */
export class ExerciseDiscoveryRefreshCoordinator {
  private activeRefresh: Promise<void> | undefined;
  private lastCompletedAtMs: number | undefined;

  constructor(
    private readonly refresh: (trigger: ExerciseDiscoveryRefreshTrigger) => Promise<void>,
    private readonly instrument: (metric: DiscoveryInstrumentation) => void,
    private readonly lastResponseBytes: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  request(trigger: ExerciseDiscoveryRefreshTrigger): Promise<void> {
    if (this.activeRefresh) {
      this.instrument({ operation: "DISCOVERY_REFRESH_COALESCED", endpoint: `exercise_states.discovery_${trigger}`,
        avoidedRequests: 1, estimatedBytesSaved: this.lastResponseBytes() });
      return this.activeRefresh;
    }
    const isAutomaticInvalidation = trigger === "foreground" || trigger === "reconnect";
    if (isAutomaticInvalidation && this.lastCompletedAtMs !== undefined
      && this.now() - this.lastCompletedAtMs < EXERCISE_DISCOVERY_RECENT_INVALIDATION_WINDOW_MS) {
      this.instrument({ operation: "DISCOVERY_REFRESH_COALESCED", endpoint: `exercise_states.discovery_${trigger}`,
        avoidedRequests: 1, estimatedBytesSaved: this.lastResponseBytes() });
      return Promise.resolve();
    }
    this.instrument({ operation: "DISCOVERY_REFRESH_TRIGGER", endpoint: `exercise_states.discovery_${trigger}`,
      reconnect: trigger === "reconnect" });
    const task = this.refresh(trigger);
    const tracked = task.then(() => {
      this.lastCompletedAtMs = this.now();
    }).finally(() => {
      if (this.activeRefresh === tracked) {
        this.activeRefresh = undefined;
      }
    });
    this.activeRefresh = tracked;
    return tracked;
  }

  safetyPoll(): Promise<void> {
    const avoided = avoidedLegacyPollsPerSafetyInterval();
    this.instrument({ operation: "DISCOVERY_REQUESTS_AVOIDED", endpoint: "exercise_states.discovery_stable",
      avoidedRequests: avoided, estimatedBytesSaved: avoided * this.lastResponseBytes() });
    return this.request("safety_poll");
  }
}
