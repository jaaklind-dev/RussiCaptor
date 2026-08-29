import { getSupabaseTrafficMetrics, recordSupabaseTraffic, resetSupabaseTrafficMetrics, setSupabaseTrafficMetricsEnabledForTests } from "../SupabaseTrafficMetrics";

describe("development-only Supabase traffic metrics", () => {
  beforeEach(() => { resetSupabaseTrafficMetrics(); setSupabaseTrafficMetricsEnabledForTests(true); });
  afterEach(() => { resetSupabaseTrafficMetrics(); setSupabaseTrafficMetricsEnabledForTests(undefined); });

  test("counts requests, rows, approximate bytes, repeats and snapshot fetches without retaining payloads", () => {
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_checkpoints.payload", data: [{ payload: { revision: 1 } }], fullSnapshot: true });
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_checkpoints.payload", data: [{ payload: { revision: 1 } }], fullSnapshot: true });
    const metric = getSupabaseTrafficMetrics()[0];
    expect(metric).toMatchObject({ requestCount: 2, rowsReceived: 2, repeatedRequestCount: 1, fullSnapshotFetchCount: 2 });
    expect(metric.bytesReceived).toBeGreaterThan(0);
    expect(JSON.stringify(metric)).not.toContain("revision");
  });

  test("records realtime reconnects independently of response rows", () => {
    recordSupabaseTraffic({ operation: "REALTIME_SUBSCRIBE", endpoint: "runtime_checkpoints", reconnect: true, avoidedRequests: 3, estimatedBytesSaved: 2048 });
    expect(getSupabaseTrafficMetrics()[0]).toMatchObject({ requestCount: 1, rowsReceived: 0, reconnectCount: 1, avoidedRequestCount: 3, estimatedBytesSaved: 2048 });
  });

  test("records aggregate request bytes without retaining payload contents", () => {
    recordSupabaseTraffic({ operation: "UPSERT", endpoint: "exercise_states.projection", requestBytes: 1234 });
    expect(getSupabaseTrafficMetrics()[0]).toMatchObject({ requestCount: 1, bytesSent: 1234, bytesReceived: 0 });
  });

  test("does not classify a changed response as an identical repeat", () => {
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.discovery_active", data: [{ revision: 1 }] });
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.discovery_active", data: [{ revision: 2 }] });
    expect(getSupabaseTrafficMetrics()[0]).toMatchObject({ requestCount: 2, repeatedRequestCount: 0 });
  });

  test("stored diagnostics contain aggregates only", () => {
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_checkpoints.payload", data: { patientName: "DO_NOT_RETAIN" }, fullSnapshot: true });
    expect(JSON.stringify(getSupabaseTrafficMetrics())).not.toContain("DO_NOT_RETAIN");
  });
});
