import type { ExerciseControlCommand, ExerciseControlCommandType } from "@/models/exercise/ExerciseControlCommand";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { advanceExerciseClockByWallSeconds } from "@/services/ClockService";
import { stopClockRunner } from "@/services/ClockRunner";
import { AuthoritativeExerciseRuntime } from "../AuthoritativeExerciseRuntime";
import { clearExerciseClockTargets } from "../ExerciseClockTargetRegistry";
import { getExerciseControlAudit, getExerciseControlReplayHash, handleExerciseControlCommand, resetExerciseControlCommandHandler, restoreExerciseControlAudit } from "../ExerciseControlCommandHandler";
import { clearExerciseRuntimeOwner, registerExerciseRuntimeOwner } from "../ExerciseRuntimeOwnerRegistry";
import { setRuntimeWriterAuthorityState } from "../../persistence/RuntimeWriterAuthorityState";
import { installRuntimeCompletionIntentListener } from "../../persistence/RuntimeCheckpointLifecycleIntent";

let sequence = 0;
const command = (commandType: ExerciseControlCommandType, extras: Partial<ExerciseControlCommand> = {}): ExerciseControlCommand => ({
  commandId: `CMD-${++sequence}`, exerciseId: "demo", commandType, issuedBy: "Exercise Controller",
  issuedAtWallClock: "2026-08-03T10:00:00.000Z", expectedVersion: getCanonicalExerciseSnapshot().version, ...extras,
});

describe("WP-22 authoritative exercise controls", () => {
  beforeEach(() => { stopClockRunner(); clearExerciseRuntimeOwner(); clearExerciseClockTargets(); resetExerciseControlCommandHandler();
    replaceCanonicalExerciseSnapshot({ exerciseId: "demo", lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: 0 });
    registerExerciseRuntimeOwner(new AuthoritativeExerciseRuntime("demo")); });
  afterEach(() => { stopClockRunner(); setRuntimeWriterAuthorityState("UNRESOLVED"); });

  it("enforces the lifecycle and freezes the canonical clock while paused and completed", () => {
    expect(handleExerciseControlCommand(command("START_EXERCISE")).ok).toBe(true);
    const controlVersion = getCanonicalExerciseSnapshot().version;
    advanceExerciseClockByWallSeconds(2); expect(getCanonicalExerciseSnapshot()).toMatchObject({ simulationTimeSec: 2, version: controlVersion });
    expect(handleExerciseControlCommand(command("PAUSE_EXERCISE")).ok).toBe(true);
    advanceExerciseClockByWallSeconds(5); expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(2);
    expect(handleExerciseControlCommand(command("RESUME_EXERCISE")).ok).toBe(true);
    expect(handleExerciseControlCommand(command("SET_EXERCISE_SPEED", { payload: { speed: 4 } })).ok).toBe(true);
    advanceExerciseClockByWallSeconds(2); expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(10);
    expect(handleExerciseControlCommand(command("COMPLETE_EXERCISE")).ok).toBe(true);
    advanceExerciseClockByWallSeconds(10); expect(getCanonicalExerciseSnapshot()).toMatchObject({ lifecycleState: "COMPLETED", simulationTimeSec: 10 });
  });

  it("is idempotent and rejects stale, unauthorized and ownerless commands without state mutation", () => {
    const start = command("START_EXERCISE"); const first = handleExerciseControlCommand(start); const second = handleExerciseControlCommand(start);
    expect(second).toEqual(first); expect(getExerciseControlAudit()).toHaveLength(1);
    const before = getCanonicalExerciseSnapshot();
    expect(handleExerciseControlCommand(command("PAUSE_EXERCISE", { commandId: "STALE", expectedVersion: 0 }))).toMatchObject({ ok: false, errorCode: "VERSION_CONFLICT" });
    expect(handleExerciseControlCommand(command("PAUSE_EXERCISE", { commandId: "UNAUTH", issuedBy: "CM" }))).toMatchObject({ ok: false, errorCode: "UNAUTHORIZED" });
    clearExerciseRuntimeOwner();
    expect(handleExerciseControlCommand(command("PAUSE_EXERCISE", { commandId: "NO-OWNER" }))).toMatchObject({ ok: false, errorCode: "NO_AUTHORITATIVE_OWNER" });
    expect(getCanonicalExerciseSnapshot()).toEqual(before);
  });

  it("produces an identical hash for an identical command sequence", () => {
    const run = () => { handleExerciseControlCommand(command("START_EXERCISE", { commandId: "REPLAY-START" })); handleExerciseControlCommand(command("PAUSE_EXERCISE", { commandId: "REPLAY-PAUSE" })); return getExerciseControlReplayHash(); };
    const first = run(); stopClockRunner(); clearExerciseRuntimeOwner(); resetExerciseControlCommandHandler();
    replaceCanonicalExerciseSnapshot({ exerciseId: "demo", lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: 0 });
    registerExerciseRuntimeOwner(new AuthoritativeExerciseRuntime("demo"));
    expect(run()).toBe(first);
  });

  it("preserves idempotency after audit restoration", () => {
    const start = command("START_EXERCISE", { commandId: "RESTORED-COMMAND" });
    const first = handleExerciseControlCommand(start); const savedAudit = getExerciseControlAudit(); const savedSnapshot = getCanonicalExerciseSnapshot();
    resetExerciseControlCommandHandler(); replaceCanonicalExerciseSnapshot(savedSnapshot); restoreExerciseControlAudit(savedAudit);
    expect(handleExerciseControlCommand(start)).toEqual(first);
    expect(getExerciseControlAudit()).toHaveLength(1);
  });

  it("materializes an accepted pending completion once after writer recovery", () => {
    setRuntimeWriterAuthorityState("WRITER");
    const start = command("START_EXERCISE", { commandId: "RECOVERY-START" });
    expect(handleExerciseControlCommand(start).ok).toBe(true);
    const running = getCanonicalExerciseSnapshot();
    const complete = command("COMPLETE_EXERCISE", { commandId: "RECOVERY-COMPLETE" });
    expect(handleExerciseControlCommand(complete)).toMatchObject({ ok: true, snapshot: { lifecycleState: "COMPLETED" } });
    const acceptedAudit = getExerciseControlAudit();

    resetExerciseControlCommandHandler();
    replaceCanonicalExerciseSnapshot(running);
    restoreExerciseControlAudit(acceptedAudit);
    const intents: boolean[] = [];
    const stopIntent = installRuntimeCompletionIntentListener(active => intents.push(active));
    try {
      const resumed = handleExerciseControlCommand(complete);
      expect(resumed).toMatchObject({ ok: true, snapshot: { lifecycleState: "COMPLETED" } });
      expect(getCanonicalExerciseSnapshot()).toMatchObject({ lifecycleState: "COMPLETED", lastCommandId: "RECOVERY-COMPLETE" });
      expect(getExerciseControlAudit()).toEqual(acceptedAudit);
      expect(intents).toEqual([true]);

      expect(handleExerciseControlCommand(complete)).toEqual(resumed);
      expect(getExerciseControlAudit()).toEqual(acceptedAudit);
      expect(intents).toEqual([true]);
    } finally {
      stopIntent();
    }
  });

  it("does not materialize an accepted completion replay without writer authority", () => {
    setRuntimeWriterAuthorityState("WRITER");
    expect(handleExerciseControlCommand(command("START_EXERCISE", { commandId: "READER-START" })).ok).toBe(true);
    const running = getCanonicalExerciseSnapshot();
    const complete = command("COMPLETE_EXERCISE", { commandId: "READER-RECOVERY-COMPLETE" });
    expect(handleExerciseControlCommand(complete).ok).toBe(true);
    const acceptedAudit = getExerciseControlAudit();

    resetExerciseControlCommandHandler();
    replaceCanonicalExerciseSnapshot(running);
    restoreExerciseControlAudit(acceptedAudit);
    setRuntimeWriterAuthorityState("READER");
    expect(handleExerciseControlCommand(complete)).toMatchObject({ ok: false, errorCode: "NO_AUTHORITATIVE_OWNER" });
    expect(getCanonicalExerciseSnapshot().lifecycleState).toBe("RUNNING");
  });

  it("uses canonical writer authority consistently for Complete authorization", () => {
    expect(handleExerciseControlCommand(command("START_EXERCISE", { commandId: "AUTH-START" })).ok).toBe(true);
    setRuntimeWriterAuthorityState("READER");
    expect(handleExerciseControlCommand(command("COMPLETE_EXERCISE", { commandId: "READER-COMPLETE" }))).toMatchObject({
      ok: false,
      errorCode: "NO_AUTHORITATIVE_OWNER",
      message: "Runtime active on another device",
    });
    setRuntimeWriterAuthorityState("WRITER");
    expect(handleExerciseControlCommand(command("COMPLETE_EXERCISE", { commandId: "WRITER-COMPLETE" }))).toMatchObject({
      ok: true,
      snapshot: { lifecycleState: "COMPLETED" },
    });
  });
});
