import {
  beginRuntimeCompletionCheckpointIntent,
  installRuntimeCompletionIntentListener,
} from "../RuntimeCheckpointLifecycleIntent";

describe("Runtime checkpoint lifecycle intent", () => {
  test("announces one terminal intent and keeps it active after acceptance", () => {
    const listener = jest.fn();
    const stop = installRuntimeCompletionIntentListener(listener);
    const settle = beginRuntimeCompletionCheckpointIntent();
    settle(true);
    settle(false);
    expect(listener.mock.calls).toEqual([[true]]);
    stop();
  });

  test("cancels a terminal intent when Runtime rejects the command", () => {
    const listener = jest.fn();
    const stop = installRuntimeCompletionIntentListener(listener);
    beginRuntimeCompletionCheckpointIntent()(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    stop();
  });

  test("notifies every independent checkpoint coordinator and detaches them independently", () => {
    const older = jest.fn();
    const newer = jest.fn();
    const stopOlder = installRuntimeCompletionIntentListener(older);
    const stopNewer = installRuntimeCompletionIntentListener(newer);
    beginRuntimeCompletionCheckpointIntent()(true);
    expect(older).toHaveBeenCalledWith(true);
    expect(newer).toHaveBeenCalledWith(true);
    stopOlder();
    beginRuntimeCompletionCheckpointIntent()(true);
    expect(older).toHaveBeenCalledTimes(1);
    expect(newer).toHaveBeenCalledTimes(2);
    stopNewer();
  });
});
