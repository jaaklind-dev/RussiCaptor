import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

export const LEGACY_EXERCISE_PROJECTION_INTERVAL_MS = 5_000;
export const EXERCISE_PROJECTION_COALESCE_INTERVAL_MS = 60_000;

export type ExerciseProjectionCandidate<T> = Readonly<{
  identity: string;
  payloadBytes: number;
  value: T;
}>;

export type ProjectionWriteInstrumentation = Readonly<{
  operation: string;
  endpoint: string;
  avoidedRequests?: number;
  estimatedBytesSaved?: number;
}>;

export function exerciseProjectionIdentity(value: unknown): Readonly<{ identity: string; payloadBytes: number }> {
  const canonical = stableJson(value);
  return Object.freeze({ identity: sha256Text(canonical), payloadBytes: new TextEncoder().encode(canonical).byteLength });
}

/**
 * Owns projection publication timing without owning projection semantics.
 * At most one write is active; mutations received during it collapse into one
 * follow-up publication of the newest locally prepared projection.
 */
export class ExerciseProjectionWriteCoordinator<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeWrite: Promise<void> | undefined;
  private pendingAfterActive = false;
  private pendingImmediateAfterActive = false;
  private lastSuccessfulIdentity: string | undefined;

  constructor(
    private readonly prepare: () => ExerciseProjectionCandidate<T> | undefined,
    private readonly publish: (candidate: ExerciseProjectionCandidate<T>) => Promise<boolean>,
    private readonly instrument: (metric: ProjectionWriteInstrumentation) => void,
    private readonly delayMs = EXERCISE_PROJECTION_COALESCE_INTERVAL_MS,
  ) {}

  schedule(immediate = false): void {
    if (immediate && this.activeWrite) {
      this.pendingAfterActive = true;
      this.pendingImmediateAfterActive = true;
      this.instrument({ operation: "PROJECTION_WRITE_COALESCED", endpoint: "exercise_states.projection", avoidedRequests: 1 });
      return;
    }
    if (immediate) {
      this.clearTimer();
      void this.flush();
      return;
    }
    if (this.timer || this.activeWrite) {
      if (this.activeWrite) this.pendingAfterActive = true;
      this.instrument({ operation: "PROJECTION_WRITE_COALESCED", endpoint: "exercise_states.projection", avoidedRequests: 1 });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (this.activeWrite) {
      this.pendingAfterActive = true;
      this.instrument({ operation: "PROJECTION_WRITE_COALESCED", endpoint: "exercise_states.projection", avoidedRequests: 1 });
      return this.activeWrite;
    }
    const candidate = this.prepare();
    if (!candidate) return;
    if (candidate.identity === this.lastSuccessfulIdentity) {
      this.instrument({ operation: "PROJECTION_WRITE_IDENTICAL_AVOIDED", endpoint: "exercise_states.projection",
        avoidedRequests: 1, estimatedBytesSaved: candidate.payloadBytes });
      return;
    }
    const task = this.publish(candidate).then(success => {
      if (success) this.lastSuccessfulIdentity = candidate.identity;
    }).finally(() => {
      if (this.activeWrite === task) this.activeWrite = undefined;
      if (this.pendingAfterActive) {
        const immediate = this.pendingImmediateAfterActive;
        this.pendingAfterActive = false;
        this.pendingImmediateAfterActive = false;
        if (immediate) void this.flush();
        else this.schedule();
      }
    });
    this.activeWrite = task;
    return task;
  }

  reset(): void {
    this.clearTimer();
    this.pendingAfterActive = false;
    this.pendingImmediateAfterActive = false;
    this.lastSuccessfulIdentity = undefined;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function estimateStableProjectionTraffic(payloadBytes: number, hours = 1): Readonly<{
  beforeWrites: number;
  afterWrites: number;
  beforeBytes: number;
  afterBytes: number;
  reductionPercent: number;
}> {
  const durationMs = Math.max(0, hours) * 60 * 60 * 1_000;
  const beforeWrites = Math.floor(durationMs / LEGACY_EXERCISE_PROJECTION_INTERVAL_MS);
  const afterWrites = Math.floor(durationMs / EXERCISE_PROJECTION_COALESCE_INTERVAL_MS);
  const beforeBytes = beforeWrites * Math.max(0, payloadBytes);
  const afterBytes = afterWrites * Math.max(0, payloadBytes);
  return Object.freeze({ beforeWrites, afterWrites, beforeBytes, afterBytes,
    reductionPercent: beforeBytes === 0 ? 0 : Number(((1 - afterBytes / beforeBytes) * 100).toFixed(1)) });
}
