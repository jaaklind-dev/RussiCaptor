import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import {
  nativeLeaseHeartbeatContext,
  startNativeLeaseHeartbeat,
  stopNativeLeaseHeartbeat,
  subscribeToNativeLeaseHeartbeat,
  updateNativeLeaseHeartbeatToken,
  type NativeLeaseHeartbeatDiagnostic,
} from "@/services/runtime/persistence/RuntimeNativeLeaseHeartbeat";
import { nextRuntimeLeaseTraceLabel, traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

export type NativeLeaseHeartbeatSession = Readonly<{
  accessToken: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}>;

/** Coordinates native transport without granting it any local writer authority. */
export class RuntimeNativeLeaseHeartbeatController {
  private generation: string | undefined;
  private unsubscribe = () => {};

  constructor(private readonly onDiagnostic?: (diagnostic: NativeLeaseHeartbeatDiagnostic) => void) {}

  async start(lease: RuntimeWriterLease, leaseSeconds: number, session: NativeLeaseHeartbeatSession): Promise<void> {
    const generation = nextRuntimeLeaseTraceLabel("native-heartbeat");
    if (this.generation) await this.stop("REPLACED");
    this.generation = generation;
    this.unsubscribe = subscribeToNativeLeaseHeartbeat(event => this.record(event, generation));
    traceRuntimeLeaseLifecycle("NATIVE_HEARTBEAT_CREATED", { scheduler: generation, detail: { leaseSeconds } });
    const diagnostic = await startNativeLeaseHeartbeat(nativeLeaseHeartbeatContext(lease, generation, leaseSeconds, session));
    if (this.generation !== generation) return;
    this.record(diagnostic, generation);
    traceRuntimeLeaseLifecycle("NATIVE_HEARTBEAT_STARTED", { scheduler: generation, detail: {} });
  }

  async updateToken(session: NativeLeaseHeartbeatSession): Promise<void> {
    if (!this.generation) return;
    await updateNativeLeaseHeartbeatToken(this.generation, session.accessToken);
  }

  async stop(reason: string): Promise<void> {
    const generation = this.generation;
    this.generation = undefined;
    this.unsubscribe();
    this.unsubscribe = () => {};
    if (!generation) return;
    await stopNativeLeaseHeartbeat(generation, reason);
    traceRuntimeLeaseLifecycle("NATIVE_HEARTBEAT_STOPPED", { scheduler: generation, detail: { reason } });
  }

  private record(diagnostic: NativeLeaseHeartbeatDiagnostic | undefined, generation: string): void {
    if (!diagnostic || this.generation !== generation) return;
    this.onDiagnostic?.(diagnostic);
    if (!diagnostic.event && !diagnostic.lastSuccessExpiresAt && !diagnostic.lastFailure) return;
    const event = diagnostic.event === "NATIVE_HEARTBEAT_STARTED" || diagnostic.event === "NATIVE_HEARTBEAT_STOPPED"
      ? diagnostic.event
      : diagnostic.event === "NATIVE_HEARTBEAT_TICK" || diagnostic.state === "RENEWING"
        ? "NATIVE_HEARTBEAT_TICK"
        : diagnostic.event === "NATIVE_RENEW_RPC_SUCCESS" || diagnostic.lastSuccessExpiresAt
          ? "NATIVE_RENEW_RPC_SUCCESS"
          : "NATIVE_RENEW_RPC_FAILURE";
    const result = diagnostic.result ?? (event === "NATIVE_RENEW_RPC_SUCCESS" ? "SUCCESS" : diagnostic.lastFailure ?? diagnostic.state);
    traceRuntimeLeaseLifecycle(
      event,
      { scheduler: generation, detail: { result, expiresAtPresent: Boolean(diagnostic.lastSuccessExpiresAt) } },
    );
  }
}
