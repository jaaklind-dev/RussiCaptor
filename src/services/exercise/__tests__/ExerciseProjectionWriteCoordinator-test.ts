import {
  EXERCISE_PROJECTION_COALESCE_INTERVAL_MS,
  ExerciseProjectionWriteCoordinator,
  estimateStableProjectionTraffic,
  exerciseProjectionIdentity,
} from "../ExerciseProjectionWriteCoordinator";

describe("WP-EGRESS-06 projection write coordinator", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("projection identity is stable across object key ordering", () => {
    expect(exerciseProjectionIdentity({ exercise: "E", nested: { b: 2, a: 1 } }).identity)
      .toBe(exerciseProjectionIdentity({ nested: { a: 1, b: 2 }, exercise: "E" }).identity);
  });

  test("stable mutations coalesce from five seconds to one minute", async () => {
    const publish = jest.fn(async () => true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "A", payloadBytes: 1000, value: "A" }), publish, jest.fn(),
    );
    for (let index = 0; index < 12; index += 1) coordinator.schedule();
    expect(publish).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(EXERCISE_PROJECTION_COALESCE_INTERVAL_MS);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(estimateStableProjectionTraffic(1000)).toEqual({
      beforeWrites: 720, afterWrites: 60, beforeBytes: 720_000, afterBytes: 60_000, reductionPercent: 91.7,
    });
  });

  test("identical canonical identity is not rewritten", async () => {
    const publish = jest.fn(async () => true); const instrument = jest.fn();
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "SAME", payloadBytes: 321, value: "value" }), publish, instrument,
    );
    await coordinator.flush(); await coordinator.flush();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(instrument).toHaveBeenCalledWith(expect.objectContaining({
      operation: "PROJECTION_WRITE_IDENTICAL_AVOIDED", avoidedRequests: 1, estimatedBytesSaved: 321,
    }));
  });

  test("semantic change writes and immediate lifecycle flush bypasses delay", async () => {
    let identity = "READY";
    const publish = jest.fn(async () => true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity, payloadBytes: 100, value: identity }), publish, jest.fn(),
    );
    coordinator.schedule(); identity = "RUNNING"; coordinator.schedule(true);
    await Promise.resolve(); await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ identity: "RUNNING" }));
  });

  test("one write is in flight and newest pending projection wins", async () => {
    let identity = "ONE"; let release = () => {};
    const first = new Promise<boolean>(resolve => { release = () => resolve(true); });
    const publish = jest.fn().mockImplementationOnce(() => first).mockResolvedValue(true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity, payloadBytes: 100, value: identity }), publish, jest.fn(),
    );
    const active = coordinator.flush(); identity = "TWO"; void coordinator.flush(); identity = "LATEST"; void coordinator.flush();
    expect(publish).toHaveBeenCalledTimes(1);
    release(); await active; await jest.advanceTimersByTimeAsync(EXERCISE_PROJECTION_COALESCE_INTERVAL_MS);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ identity: "LATEST" }));
  });

  test("routine ticks during a write start a new bounded window instead of a write chain", async () => {
    let identity = "ONE"; let release = () => {};
    const first = new Promise<boolean>(resolve => { release = () => resolve(true); });
    const publish = jest.fn().mockImplementationOnce(() => first).mockResolvedValue(true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity, payloadBytes: 100, value: identity }), publish, jest.fn(),
    );
    const active = coordinator.flush(); identity = "LATEST";
    for (let index = 0; index < 20; index += 1) coordinator.schedule();
    release(); await active;
    await jest.advanceTimersByTimeAsync(EXERCISE_PROJECTION_COALESCE_INTERVAL_MS - 1);
    expect(publish).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  test("failed publication remains retryable", async () => {
    const publish = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "A", payloadBytes: 100, value: "A" }), publish, jest.fn(),
    );
    await coordinator.flush(); await coordinator.flush();
    expect(publish).toHaveBeenCalledTimes(2);
  });

  test("reset cancels a pending startup write", async () => {
    const publish = jest.fn(async () => true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "A", payloadBytes: 100, value: "A" }), publish, jest.fn(),
    );
    coordinator.schedule(); coordinator.reset();
    await jest.advanceTimersByTimeAsync(EXERCISE_PROJECTION_COALESCE_INTERVAL_MS);
    expect(publish).not.toHaveBeenCalled();
  });
});
