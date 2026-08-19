import {
  currentExerciseDiscoveryAllowsRuntime,
  startAfterCurrentExerciseDiscovery,
} from "@/services/exercise/StartupOrchestrationService";
import { canPublishCloudProjection } from "@/services/CloudSyncService";

describe("current-exercise startup orchestration", () => {
  test("stale local RUNNING cannot acquire writer before remote discovery resolves", async () => {
    const order: string[] = [];
    let resolveDiscovery!: (value: { state: "synced" }) => void;
    const discovery = new Promise<{ state: "synced" }>(resolve => { resolveDiscovery = resolve; });
    const startup = startAfterCurrentExerciseDiscovery({
      discover: async () => { order.push("DISCOVERY_STARTED"); return discovery; },
      startRuntime: async () => { order.push("WRITER_ACQUISITION_STARTED"); return () => {}; },
    });
    await Promise.resolve();
    expect(order).toEqual(["DISCOVERY_STARTED"]);
    resolveDiscovery({ state: "synced" });
    await startup;
    expect(order).toEqual(["DISCOVERY_STARTED", "WRITER_ACQUISITION_STARTED"]);
  });

  test("multiple authoritative RUNNING exercises remain typed conflict and never start Runtime", async () => {
    const startRuntime = jest.fn(async () => () => {});
    await expect(startAfterCurrentExerciseDiscovery({
      discover: async () => ({ state: "error", message: "MULTIPLE_ACTIVE_EXERCISES:EX-A,EX-B" }),
      startRuntime,
    })).rejects.toThrow("MULTIPLE_ACTIVE_EXERCISES:EX-A,EX-B");
    expect(startRuntime).not.toHaveBeenCalled();
  });

  test("authoritative terminal local exercise plus one remote RUNNING selects before acquisition", async () => {
    const order: string[] = [];
    await startAfterCurrentExerciseDiscovery({
      discover: async () => { order.push("REMOTE_EX-B_SELECTED"); return { state: "synced" }; },
      startRuntime: async () => { order.push("EX-B_AUTHORITY_STARTED"); return () => {}; },
    });
    expect(order).toEqual(["REMOTE_EX-B_SELECTED", "EX-B_AUTHORITY_STARTED"]);
  });

  test("one unambiguous remote RUNNING permits authority only after discovery", async () => {
    const startRuntime = jest.fn(async () => () => {});
    await startAfterCurrentExerciseDiscovery({
      discover: async () => ({ state: "synced", syncedAt: "2026-08-18T00:00:00.000Z" }),
      startRuntime,
    });
    expect(startRuntime).toHaveBeenCalledTimes(1);
  });

  test("no configured remote preserves existing local recovery policy", async () => {
    const startRuntime = jest.fn(async () => () => {});
    await startAfterCurrentExerciseDiscovery({
      discover: async () => ({ state: "disabled" }),
      startRuntime,
    });
    expect(startRuntime).toHaveBeenCalledTimes(1);
    expect(currentExerciseDiscoveryAllowsRuntime({ state: "disabled" })).toBe(true);
  });

  test.each([
    [{ state: "connecting" as const }, "CURRENT_EXERCISE_DISCOVERY_CONNECTING"],
    [{ state: "offline" as const, message: "DISCOVERY_NETWORK_FAILURE" }, "DISCOVERY_NETWORK_FAILURE"],
    [{ state: "error" as const, message: "DISCOVERY_CANCELLED" }, "DISCOVERY_CANCELLED"],
  ])("discovery cancellation/error %p never starts writer or checkpoint publication", async (status, code) => {
    const startRuntime = jest.fn(async () => () => {});
    await expect(startAfterCurrentExerciseDiscovery({
      discover: async () => status,
      startRuntime,
    })).rejects.toThrow(code);
    expect(startRuntime).not.toHaveBeenCalled();
  });

  test("checkpoint/projection publication remains disabled until selection is resolved", () => {
    expect(canPublishCloudProjection("UNRESOLVED")).toBe(false);
    expect(canPublishCloudProjection("CONFLICT")).toBe(false);
    expect(canPublishCloudProjection("RESOLVED")).toBe(true);
  });
});
