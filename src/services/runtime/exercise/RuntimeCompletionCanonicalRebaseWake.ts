import type { RuntimeCompletionRequest } from "@/models/RuntimeCompletion";

export type RuntimeCompletionCanonicalRebaseWakeOutcome =
  | "DEFERRED"
  | "WOKE"
  | "ALREADY_WOKE"
  | "STALE_GENERATION";

type RuntimeCompletionCanonicalRebaseWakeOptions = Readonly<{
  exerciseId: string;
  generation: string;
  isCurrent: () => boolean;
  dispatch: (request: RuntimeCompletionRequest) => Promise<void>;
  trace?: (event: string, detail: Readonly<Record<string, string | number | boolean | undefined>>) => void;
}>;

/**
 * One-shot join between two independently ordered startup facts: the durable
 * completion request has been discovered and the canonical checkpoint has
 * replaced any unpublished local envelope. Whichever arrives second wakes
 * terminal preparation for the current writer generation exactly once.
 */
export class RuntimeCompletionCanonicalRebaseWake {
  private request: RuntimeCompletionRequest | undefined;
  private rebasedRequestId: string | undefined;
  private wokeRequestId: string | undefined;
  private stopped = false;

  constructor(private readonly options: RuntimeCompletionCanonicalRebaseWakeOptions) {}

  observe(request: RuntimeCompletionRequest): Promise<RuntimeCompletionCanonicalRebaseWakeOutcome> {
    if (request.exerciseId !== this.options.exerciseId || request.status !== "PENDING") {
      return Promise.resolve("DEFERRED");
    }
    this.request = request;
    return this.tryWake();
  }

  canonicalRebaseComplete(requestId: string): Promise<RuntimeCompletionCanonicalRebaseWakeOutcome> {
    this.rebasedRequestId = requestId;
    return this.tryWake();
  }

  stop(): void {
    this.stopped = true;
    this.request = undefined;
    this.rebasedRequestId = undefined;
  }

  private tryWake(): Promise<RuntimeCompletionCanonicalRebaseWakeOutcome> {
    if (this.stopped || !this.options.isCurrent()) return Promise.resolve("STALE_GENERATION");
    const request = this.request;
    if (!request || this.rebasedRequestId !== request.commandId) return Promise.resolve("DEFERRED");
    if (this.wokeRequestId === request.commandId) return Promise.resolve("ALREADY_WOKE");
    this.wokeRequestId = request.commandId;
    this.options.trace?.("TERMINAL_INTENT_WAKE", {
      generation: this.options.generation,
      requestId: request.commandId,
      reason: "CANONICAL_REBASE_COMPLETE",
    });
    return this.options.dispatch(request).then(() => "WOKE" as const);
  }
}
