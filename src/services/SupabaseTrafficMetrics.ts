export type SupabaseTrafficMetric = Readonly<{
  category: SupabaseTrafficCategory;
  operation: string;
  endpoint: string;
  requestCount: number;
  rowsReceived: number;
  bytesReceived: number;
  bytesSent: number;
  maxBytesReceived: number;
  maxBytesSent: number;
  repeatedRequestCount: number;
  fullSnapshotFetchCount: number;
  reconnectCount: number;
  avoidedRequestCount: number;
  estimatedBytesSaved: number;
}>;

export type SupabaseTrafficCategory =
  | "CHECKPOINT_FULL_IN"
  | "CHECKPOINT_DELTA_IN"
  | "CHECKPOINT_METADATA_IN"
  | "CHECKPOINT_OUT"
  | "DISCOVERY_IN"
  | "PROJECTION_OUT"
  | "TERMINAL_ARCHIVE_OUT"
  | "AUTH_OR_MISC"
  | "UNKNOWN";

const metrics = new Map<string, SupabaseTrafficMetric>();
const lastResponseFingerprints = new Map<string, string>();
let forcedEnabled: boolean | undefined;

function enabled(): boolean {
  if (forcedEnabled !== undefined) return forcedEnabled;
  return __DEV__ || process.env.EXPO_PUBLIC_SUPABASE_EGRESS_DEBUG === "1";
}

function debugLoggingEnabled(): boolean {
  return process.env.EXPO_PUBLIC_SUPABASE_EGRESS_DEBUG === "1";
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function estimateSupabasePayloadBytes(value: unknown): number {
  if (value === undefined || value === null) return 0;
  try { return utf8ByteLength(JSON.stringify(value)); }
  catch { return 0; }
}

export function classifySupabaseTraffic(operation: string, endpoint: string): SupabaseTrafficCategory {
  if (endpoint === "exercise_states.projection") return "PROJECTION_OUT";
  if (endpoint === "exercise_states.terminal_archive") return "TERMINAL_ARCHIVE_OUT";
  if (endpoint.includes("discovery_")) return "DISCOVERY_IN";
  if (endpoint === "runtime_checkpoint_deltas.hydration") return "CHECKPOINT_DELTA_IN";
  if (endpoint.includes("runtime_checkpoint_notifications") || endpoint.includes("deltas.cost") || endpoint.includes("checkpoint") && endpoint.includes("metadata")) return "CHECKPOINT_METADATA_IN";
  if (operation === "RPC" && endpoint.startsWith("publish_runtime_checkpoint")) return "CHECKPOINT_OUT";
  if (endpoint === "exercise_states.full_state" || endpoint === "exercise_states.conflict_selected_full_state") return "DISCOVERY_IN";
  if (endpoint.includes("runtime_checkpoints") && (endpoint.includes("payload") || endpoint.includes("full_state"))) return "CHECKPOINT_FULL_IN";
  if (endpoint.includes("authorization") || endpoint.includes("writer") || endpoint.includes("evaluation")) return "AUTH_OR_MISC";
  return "UNKNOWN";
}

function responseFingerprint(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index += 1) {
      hash ^= serialized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${serialized.length}:${hash >>> 0}`;
  } catch { return undefined; }
}

function rowCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value === undefined || value === null ? 0 : 1;
}

export function recordSupabaseTraffic(input: Readonly<{
  operation: string;
  endpoint: string;
  data?: unknown;
  requestBytes?: number;
  fullSnapshot?: boolean;
  reconnect?: boolean;
  avoidedRequests?: number;
  estimatedBytesSaved?: number;
}>): void {
  if (!enabled()) return;
  const key = `${input.operation}:${input.endpoint}`;
  const previous = metrics.get(key);
  const fingerprint = responseFingerprint(input.data);
  const repeated = fingerprint !== undefined && lastResponseFingerprints.get(key) === fingerprint;
  const responseBytes = estimateSupabasePayloadBytes(input.data);
  const requestBytes = Math.max(0, Math.floor(input.requestBytes ?? 0));
  if (fingerprint !== undefined) lastResponseFingerprints.set(key, fingerprint);
  const metric = Object.freeze({
    category: classifySupabaseTraffic(input.operation, input.endpoint),
    operation: input.operation,
    endpoint: input.endpoint,
    requestCount: (previous?.requestCount ?? 0) + 1,
    rowsReceived: (previous?.rowsReceived ?? 0) + rowCount(input.data),
    bytesReceived: (previous?.bytesReceived ?? 0) + responseBytes,
    bytesSent: (previous?.bytesSent ?? 0) + requestBytes,
    maxBytesReceived: Math.max(previous?.maxBytesReceived ?? 0, responseBytes),
    maxBytesSent: Math.max(previous?.maxBytesSent ?? 0, requestBytes),
    repeatedRequestCount: (previous?.repeatedRequestCount ?? 0) + (repeated ? 1 : 0),
    fullSnapshotFetchCount: (previous?.fullSnapshotFetchCount ?? 0) + (input.fullSnapshot ? 1 : 0),
    reconnectCount: (previous?.reconnectCount ?? 0) + (input.reconnect ? 1 : 0),
    avoidedRequestCount: (previous?.avoidedRequestCount ?? 0) + Math.max(0, Math.floor(input.avoidedRequests ?? 0)),
    estimatedBytesSaved: (previous?.estimatedBytesSaved ?? 0) + Math.max(0, Math.floor(input.estimatedBytesSaved ?? 0)),
  });
  metrics.set(key, metric);
  if (debugLoggingEnabled()) console.info("SUPABASE_TRAFFIC_METRIC", JSON.stringify(metric));
}

export function getSupabaseTrafficMetrics(): readonly SupabaseTrafficMetric[] {
  return Object.freeze([...metrics.values()].sort((a, b) => b.bytesReceived - a.bytesReceived || a.endpoint.localeCompare(b.endpoint)));
}

export function resetSupabaseTrafficMetrics(): void { metrics.clear(); lastResponseFingerprints.clear(); }

/** Test/debug override; production callers must not enable metrics through this API. */
export function setSupabaseTrafficMetricsEnabledForTests(value: boolean | undefined): void { forcedEnabled = value; }
