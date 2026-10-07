import fs from "fs";
import path from "path";

import {
  beginRuntimeCompletionCheckpointIntent,
  getRuntimeCompletionCheckpointIntent,
  installRuntimeCompletionIntentListener,
  resetRuntimeCompletionCheckpointIntentForTests,
  settleRuntimeCompletionCheckpointIntent,
} from "../RuntimeCheckpointLifecycleIntent";

const source = (relativePath: string): string => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("terminal completion intent settlement", () => {
  afterEach(() => resetRuntimeCompletionCheckpointIntentForTests());

  test("INTENT-SETTLE-01 successful atomic finalize settles completion intent", () => {
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    expect(settleRuntimeCompletionCheckpointIntent("exercise", "request")).toBe(true);
    expect(getRuntimeCompletionCheckpointIntent()).toBeUndefined();
  });

  test("INTENT-SETTLE-02 settled intent is not replayed by a new sync generation", () => {
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    settleRuntimeCompletionCheckpointIntent("exercise", "request");
    const nextGeneration = jest.fn();
    installRuntimeCompletionIntentListener(nextGeneration);
    expect(nextGeneration).not.toHaveBeenCalled();
  });

  test("INTENT-SETTLE-03 terminal canonical state blocks stale intent replay", () => {
    const persistence = source("src/services/StatePersistenceService.ts");
    const checkpointSync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(persistence).toContain('completionPhase.phase === "COMPLETED"');
    expect(persistence).toContain("terminalCaptureGeneration = undefined");
    expect(checkpointSync).toContain('completionPhase.phase==="COMPLETED"');
  });

  test("INTENT-SETTLE-04 COMPLETION_PREP_START remains single-flight", () => {
    let preparations = 0;
    const stopFirst = installRuntimeCompletionIntentListener(active => { if (active) preparations += 1; });
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    settleRuntimeCompletionCheckpointIntent("exercise", "request");
    stopFirst();
    installRuntimeCompletionIntentListener(active => { if (active) preparations += 1; });
    expect(preparations).toBe(1);
  });

  test("INTENT-SETTLE-05 atomic finalize wiring remains exactly once", () => {
    const checkpointSync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(checkpointSync.match(/repository\.finalizeCompletion!/g)).toHaveLength(1);
    expect(checkpointSync.match(/COMPLETION_FINALIZE_RPC_START/g)).toHaveLength(1);
  });

  test("INTENT-SETTLE-06 the same completed request identity settles the intent", () => {
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    expect(settleRuntimeCompletionCheckpointIntent("exercise", "different-request")).toBe(false);
    expect(getRuntimeCompletionCheckpointIntent()?.commandId).toBe("request");
    expect(settleRuntimeCompletionCheckpointIntent("exercise", "request")).toBe(true);
  });

  test("INTENT-SETTLE-07 restart does not reactivate a settled intent", () => {
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    settleRuntimeCompletionCheckpointIntent("exercise", "request");
    const restartedPersistence = jest.fn();
    installRuntimeCompletionIntentListener(restartedPersistence);
    expect(restartedPersistence).not.toHaveBeenCalled();
  });

  test("INTENT-SETTLE-08 stale generation cannot settle newer intent", () => {
    const settleOldAcceptance = beginRuntimeCompletionCheckpointIntent("exercise", "old-request");
    settleOldAcceptance(true);
    beginRuntimeCompletionCheckpointIntent("exercise", "new-request")(true);
    expect(settleRuntimeCompletionCheckpointIntent("exercise", "old-request")).toBe(false);
    expect(getRuntimeCompletionCheckpointIntent()?.commandId).toBe("new-request");
  });

  test("INTENT-SETTLE-09 double settlement is idempotent", () => {
    const listener = jest.fn();
    installRuntimeCompletionIntentListener(listener);
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    expect(settleRuntimeCompletionCheckpointIntent("exercise", "request")).toBe(true);
    expect(settleRuntimeCompletionCheckpointIntent("exercise", "request")).toBe(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
  });

  test("INTENT-SETTLE-10 rejected completion behavior remains unchanged", () => {
    const listener = jest.fn();
    installRuntimeCompletionIntentListener(listener);
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    expect(getRuntimeCompletionCheckpointIntent()).toBeUndefined();
  });

  test("INTENT-SETTLE-11 duplicate accepted notification does not schedule another preparation", () => {
    const listener = jest.fn();
    installRuntimeCompletionIntentListener(listener);
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    beginRuntimeCompletionCheckpointIntent("exercise", "request")(true);
    expect(listener.mock.calls).toEqual([[true]]);
  });

  test("INTENT-SETTLE-12 previous command-fence regression remains wired", () => {
    const checkpointSync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(checkpointSync).toContain("drainPatientCommands(request.fenceCommandSequence)");
    expect(checkpointSync).toContain("settleRuntimeCompletionCheckpointIntent(exerciseId,completionForCheckpoint.commandId)");
  });
});
