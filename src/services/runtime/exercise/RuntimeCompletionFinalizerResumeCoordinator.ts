import type { RuntimeCompletionRequest } from "@/models/RuntimeCompletion";

export type RuntimeCompletionResumeTrigger =
  | "REQUEST_DISCOVERED"
  | "WRITER_READY"
  | "TAKEOVER_RESUME"
  | "REALTIME_RECONNECT"
  | "APP_FOREGROUND";

export type RuntimeCompletionResumeOutcome =
  | "NO_PENDING_REQUEST"
  | "DEFERRED_WRITER_NOT_READY"
  | "STALE_GENERATION"
  | "DISPATCHED";

type RuntimeCompletionFinalizerResumeOptions = Readonly<{
  exerciseId: string;
  generation: string;
  isCurrent: () => boolean;
  isWriterReady: () => boolean;
  dispatch: (request: RuntimeCompletionRequest) => Promise<void>;
  trace?: (event: string, detail: Readonly<Record<string, string | number | boolean | undefined>>) => void;
}>;

/**
 * Generation-owned event latch for recovered completion work.
 *
 * A request may arrive before writer readiness.  It remains known but is not
 * marked handled.  The matching generation's READY transition re-evaluates
 * the request, and single-flight ownership starts only when dispatch begins.
 */
export class RuntimeCompletionFinalizerResumeCoordinator {
  private pending: RuntimeCompletionRequest | undefined;
  private inFlight: Promise<RuntimeCompletionResumeOutcome> | undefined;
  private stopped = false;

  constructor(private readonly options: RuntimeCompletionFinalizerResumeOptions) {}

  observe(request: RuntimeCompletionRequest): Promise<RuntimeCompletionResumeOutcome> {
    if (request.exerciseId !== this.options.exerciseId || request.status !== "PENDING") {
      if (this.pending?.commandId === request.commandId) this.pending = undefined;
      return Promise.resolve("NO_PENDING_REQUEST");
    }
    this.pending = request;
    this.options.trace?.("COMPLETION_REQUEST_DISCOVERED", {
      generation: this.options.generation,
      requestId: request.commandId,
    });
    return this.resume("REQUEST_DISCOVERED");
  }

  writerReady(): Promise<RuntimeCompletionResumeOutcome> {
    return this.resume("WRITER_READY");
  }

  wake(trigger: Exclude<RuntimeCompletionResumeTrigger, "REQUEST_DISCOVERED" | "WRITER_READY">): Promise<RuntimeCompletionResumeOutcome> {
    return this.resume(trigger);
  }

  completed(commandId: string): void {
    if (this.pending?.commandId === commandId) this.pending = undefined;
  }

  writerUnavailable(): void {
    this.options.trace?.("COMPLETION_RESUME_WRITER_UNAVAILABLE", {
      generation: this.options.generation,
      requestId: this.pending?.commandId,
    });
  }

  stop(): void {
    this.stopped = true;
    this.pending = undefined;
  }

  private resume(trigger: RuntimeCompletionResumeTrigger): Promise<RuntimeCompletionResumeOutcome> {
    if (this.stopped || !this.options.isCurrent()) {
      this.options.trace?.("COMPLETION_RESUME_STALE_GENERATION", {
        generation: this.options.generation,
        trigger,
      });
      return Promise.resolve("STALE_GENERATION");
    }
    const request = this.pending;
    if (!request) return Promise.resolve("NO_PENDING_REQUEST");
    if (!this.options.isWriterReady()) {
      this.options.trace?.("COMPLETION_RESUME_DEFERRED", {
        generation: this.options.generation,
        requestId: request.commandId,
        trigger,
      });
      return Promise.resolve("DEFERRED_WRITER_NOT_READY");
    }
    if (this.inFlight) return this.inFlight;

    const task = (async (): Promise<RuntimeCompletionResumeOutcome> => {
      if (this.stopped || !this.options.isCurrent()) return "STALE_GENERATION";
      if (!this.options.isWriterReady() || this.pending?.commandId !== request.commandId) {
        return "DEFERRED_WRITER_NOT_READY";
      }
      this.options.trace?.("COMPLETION_RESUME_DISPATCHED", {
        generation: this.options.generation,
        requestId: request.commandId,
        trigger,
      });
      await this.options.dispatch(request);
      return "DISPATCHED";
    })();
    this.inFlight = task;
    void task.finally(() => {
      if (this.inFlight === task) this.inFlight = undefined;
    }).catch(() => undefined);
    return task;
  }
}
