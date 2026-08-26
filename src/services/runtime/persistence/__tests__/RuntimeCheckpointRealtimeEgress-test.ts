import { getSupabaseTrafficMetrics, recordSupabaseTraffic, resetSupabaseTrafficMetrics, setSupabaseTrafficMetricsEnabledForTests } from "@/services/SupabaseTrafficMetrics";

describe("WP-EGRESS-01 deterministic Realtime egress profile", () => {
  beforeEach(() => { resetSupabaseTrafficMetrics(); setSupabaseTrafficMetricsEnabledForTests(true); });
  afterEach(() => { resetSupabaseTrafficMetrics(); setSupabaseTrafficMetricsEnabledForTests(undefined); });

  test("metadata invalidation substantially reduces a representative 12-publication sequence", () => {
    const fullRow = { exercise_id: "EX-1", checkpoint_revision: 12, payload_hash: "H12", provenance_hash: "P", writer_instance_id: "W", payload: { compactRuntime: "x".repeat(60_000) } };
    const metadataRow = { exercise_id: "EX-1", checkpoint_revision: 12, payload_hash: "H12", provenance_hash: "P", writer_instance_id: "W", updated_at: "2026-08-26T00:00:00Z" };

    for (let revision = 1; revision <= 12; revision += 1) recordSupabaseTraffic({ operation: "BEFORE_REALTIME", endpoint: "runtime_checkpoints", data: { ...fullRow, checkpoint_revision: revision }, fullSnapshot: true });
    const beforeBytes = getSupabaseTrafficMetrics()[0].bytesReceived;
    resetSupabaseTrafficMetrics();

    for (let revision = 1; revision <= 12; revision += 1) recordSupabaseTraffic({ operation: "REALTIME_METADATA", endpoint: "runtime_checkpoint_notifications", data: { ...metadataRow, checkpoint_revision: revision } });
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_checkpoints.conditional_payload", data: { payload: fullRow.payload }, fullSnapshot: true });
    const after = getSupabaseTrafficMetrics();
    const afterBytes = after.reduce((sum, metric) => sum + metric.bytesReceived, 0);
    const reductionPercent = Number(((1 - afterBytes / beforeBytes) * 100).toFixed(1));

    expect(after.find(metric => metric.endpoint === "runtime_checkpoint_notifications")?.requestCount).toBe(12);
    expect(after.find(metric => metric.endpoint === "runtime_checkpoints.conditional_payload")?.fullSnapshotFetchCount).toBe(1);
    expect(reductionPercent).toBeGreaterThan(90);
    console.info("WP_EGRESS_01_PROFILE", JSON.stringify({ publications: 12, fullCheckpointBytes: JSON.stringify(fullRow).length, metadataNotificationBytes: JSON.stringify(metadataRow).length, beforeBytes, afterBytes, conditionalFullFetches: 1, reductionPercent }));
  });
});
