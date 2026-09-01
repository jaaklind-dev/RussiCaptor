import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";

/**
 * Android is only a transport/scheduler here.  Server-side renew_runtime_writer
 * remains the sole authority for writer identity, lease validity and expiry.
 */
export type NativeLeaseHeartbeatContext = Readonly<{
  leaseId: string;
  exerciseId: string;
  writerInstanceId: string;
  leaseSeconds: number;
  heartbeatGeneration: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  accessToken: string;
}>;

export type NativeLeaseHeartbeatDiagnostic = Readonly<{
  state: "IDLE" | "ACTIVE" | "RENEWING" | "STOPPED" | "FAILED";
  event?: string;
  result?: string;
  heartbeatGeneration?: string;
  lastSuccessExpiresAt?: string;
  lastFailure?: string;
}>;

type NativeLeaseHeartbeatModule = Readonly<{
  start(context: NativeLeaseHeartbeatContext): Promise<NativeLeaseHeartbeatDiagnostic>;
  updateAccessToken(heartbeatGeneration: string, accessToken: string): Promise<void>;
  stop(heartbeatGeneration: string, reason: string): Promise<void>;
  getDiagnosticState(): Promise<NativeLeaseHeartbeatDiagnostic>;
}>;

const nativeModule = NativeModules.RuntimeNativeLeaseHeartbeat as NativeLeaseHeartbeatModule | undefined;
const eventName = "RuntimeNativeLeaseHeartbeat";

export const isNativeLeaseHeartbeatAvailable = (): boolean => Platform.OS === "android" && Boolean(nativeModule);

export async function startNativeLeaseHeartbeat(context: NativeLeaseHeartbeatContext): Promise<NativeLeaseHeartbeatDiagnostic | undefined> {
  if (!isNativeLeaseHeartbeatAvailable()) return undefined;
  return nativeModule!.start(context);
}

export async function updateNativeLeaseHeartbeatToken(heartbeatGeneration: string, accessToken: string): Promise<void> {
  if (!isNativeLeaseHeartbeatAvailable()) return;
  await nativeModule!.updateAccessToken(heartbeatGeneration, accessToken);
}

export async function stopNativeLeaseHeartbeat(heartbeatGeneration: string, reason: string): Promise<void> {
  if (!isNativeLeaseHeartbeatAvailable()) return;
  await nativeModule!.stop(heartbeatGeneration, reason);
}

export async function getNativeLeaseHeartbeatDiagnostic(): Promise<NativeLeaseHeartbeatDiagnostic | undefined> {
  if (!isNativeLeaseHeartbeatAvailable()) return undefined;
  return nativeModule!.getDiagnosticState();
}

export function subscribeToNativeLeaseHeartbeat(
  listener: (value: NativeLeaseHeartbeatDiagnostic) => void,
): (() => void) {
  if (!isNativeLeaseHeartbeatAvailable()) return () => {};
  const subscription = new NativeEventEmitter(nativeModule as never).addListener(eventName, listener);
  return () => subscription.remove();
}

export function nativeLeaseHeartbeatContext(
  lease: RuntimeWriterLease,
  heartbeatGeneration: string,
  leaseSeconds: number,
  session: Readonly<{ accessToken: string; supabaseUrl: string; supabasePublishableKey: string }>,
): NativeLeaseHeartbeatContext {
  return Object.freeze({
    leaseId: lease.leaseId,
    exerciseId: lease.exerciseId,
    writerInstanceId: lease.writerInstanceId,
    leaseSeconds,
    heartbeatGeneration,
    accessToken: session.accessToken,
    supabaseUrl: session.supabaseUrl,
    supabasePublishableKey: session.supabasePublishableKey,
  });
}
