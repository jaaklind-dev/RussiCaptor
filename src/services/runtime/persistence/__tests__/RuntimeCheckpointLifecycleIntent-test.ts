import {
  beginRuntimeCompletionCheckpointIntent,
  getRuntimeCompletionCheckpointIntent,
  installRuntimeCompletionIntentListener,
  resetRuntimeCompletionCheckpointIntentForTests,
  settleRuntimeCompletionCheckpointIntent,
} from "../RuntimeCheckpointLifecycleIntent";

describe("Runtime checkpoint lifecycle intent", () => {
  afterEach(() => resetRuntimeCompletionCheckpointIntentForTests());

  test("announces one terminal intent and keeps it active after acceptance", () => {
    const listener = jest.fn();
    const stop = installRuntimeCompletionIntentListener(listener);
    const settle = beginRuntimeCompletionCheckpointIntent("exercise", "command");
    settle(true);
    settle(false);
    expect(listener.mock.calls).toEqual([[true]]);
    expect(getRuntimeCompletionCheckpointIntent()).toMatchObject({ state: "ACCEPTED" });
    stop();
  });

  test("cancels a terminal intent when Runtime rejects the command", () => {
    const listener = jest.fn();
    const stop = installRuntimeCompletionIntentListener(listener);
    beginRuntimeCompletionCheckpointIntent("exercise", "command")(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    stop();
  });

  test("notifies every independent checkpoint coordinator and detaches them independently", () => {
    const older = jest.fn();
    const newer = jest.fn();
    const stopOlder = installRuntimeCompletionIntentListener(older);
    const stopNewer = installRuntimeCompletionIntentListener(newer);
    beginRuntimeCompletionCheckpointIntent("exercise", "command-1")(true);
    expect(older).toHaveBeenCalledWith(true);
    expect(newer).toHaveBeenCalledWith(true);
    stopOlder();
    beginRuntimeCompletionCheckpointIntent("exercise", "command-2")(true);
    expect(older).toHaveBeenCalledTimes(1);
    expect(newer).toHaveBeenCalledTimes(2);
    stopNewer();
  });

  test("consumes an accepted terminal intent after canonical finalization", () => {
    const listener = jest.fn();
    installRuntimeCompletionIntentListener(listener);
    beginRuntimeCompletionCheckpointIntent("exercise", "command")(true);
    expect(settleRuntimeCompletionCheckpointIntent("exercise", "command")).toBe(true);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    expect(getRuntimeCompletionCheckpointIntent()).toBeUndefined();
  });
});
