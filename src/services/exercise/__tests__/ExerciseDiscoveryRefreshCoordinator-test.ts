import {
  EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS,
  ExerciseDiscoveryRefreshCoordinator,
  avoidedLegacyPollsPerSafetyInterval,
  estimateStableDiscoveryTraffic,
} from "../ExerciseDiscoveryRefreshCoordinator";

describe("WP-EGRESS-05 exercise discovery refresh policy", () => {
  test("stable safety polling replaces the perpetual five-second cadence", () => {
    expect(EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS).toBe(60_000);
    expect(avoidedLegacyPollsPerSafetyInterval()).toBe(11);
    expect(estimateStableDiscoveryTraffic(535)).toEqual({
      beforeRequests: 720, afterRequests: 60, beforeBytes: 385_200, afterBytes: 32_100, reductionPercent: 91.7,
    });
  });

  test("startup performs discovery and duplicate invalidations share one request", async () => {
    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const refresh = jest.fn(async () => pending);
    const instrument = jest.fn();
    const coordinator = new ExerciseDiscoveryRefreshCoordinator(refresh, instrument, () => 535);
    const startup = coordinator.request("startup");
    const duplicate = coordinator.request("foreground");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(duplicate).toBe(startup);
    expect(instrument).toHaveBeenCalledWith(expect.objectContaining({ operation: "DISCOVERY_REFRESH_COALESCED", avoidedRequests: 1 }));
    release(); await startup;
  });

  test("foreground, reconnect and safety refresh after the previous request completes", async () => {
    let now = 0;
    const refresh = jest.fn(async () => {}); const instrument = jest.fn();
    const coordinator = new ExerciseDiscoveryRefreshCoordinator(refresh, instrument, () => 535, () => now);
    await coordinator.request("foreground");
    now += 2_001;
    await coordinator.request("reconnect");
    now += 2_001;
    await coordinator.safetyPoll();
    expect(refresh).toHaveBeenNthCalledWith(1, "foreground");
    expect(refresh).toHaveBeenNthCalledWith(2, "reconnect");
    expect(refresh).toHaveBeenNthCalledWith(3, "safety_poll");
    expect(instrument).toHaveBeenCalledWith(expect.objectContaining({ operation: "DISCOVERY_REQUESTS_AVOIDED", avoidedRequests: 11, estimatedBytesSaved: 5_885 }));
  });

  test("foreground and reconnect invalidations in one resume burst avoid a second query", async () => {
    let now = 10_000;
    const refresh = jest.fn(async () => {}); const instrument = jest.fn();
    const coordinator = new ExerciseDiscoveryRefreshCoordinator(refresh, instrument, () => 541, () => now);
    await coordinator.request("foreground");
    now += 50;
    await coordinator.request("reconnect");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(instrument).toHaveBeenCalledWith(expect.objectContaining({
      operation: "DISCOVERY_REFRESH_COALESCED", avoidedRequests: 1, estimatedBytesSaved: 541,
    }));
  });

  test("a failed refresh does not block missed-event recovery", async () => {
    const refresh = jest.fn()
      .mockRejectedValueOnce(new Error("OFFLINE"))
      .mockResolvedValueOnce(undefined);
    const coordinator = new ExerciseDiscoveryRefreshCoordinator(refresh, jest.fn(), () => 535);
    await expect(coordinator.request("startup")).rejects.toThrow("OFFLINE");
    await expect(coordinator.request("reconnect")).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("24-hour estimate is explicitly extrapolated from the stable policy", () => {
    expect(estimateStableDiscoveryTraffic(535, 24)).toEqual({
      beforeRequests: 17_280, afterRequests: 1_440, beforeBytes: 9_244_800, afterBytes: 770_400, reductionPercent: 91.7,
    });
  });
});
