import type { ExerciseControlCommand, ExerciseControlCommandType } from "@/models/exercise/ExerciseControlCommand";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { advanceExerciseClockByWallSeconds } from "@/services/ClockService";
import { stopClockRunner } from "@/services/ClockRunner";
import { AuthoritativeExerciseRuntime } from "../AuthoritativeExerciseRuntime";
import { clearExerciseClockTargets } from "../ExerciseClockTargetRegistry";
import { getExerciseControlAudit, getExerciseControlReplayHash, handleExerciseControlCommand, resetExerciseControlCommandHandler, restoreExerciseControlAudit } from "../ExerciseControlCommandHandler";
import { clearExerciseRuntimeOwner, registerExerciseRuntimeOwner } from "../ExerciseRuntimeOwnerRegistry";

let sequence = 0;
const command = (commandType: ExerciseControlCommandType, extras: Partial<ExerciseControlCommand> = {}): ExerciseControlCommand => ({
  commandId: `CMD-${++sequence}`, exerciseId: "demo", commandType, issuedBy: "Exercise Controller",
  issuedAtWallClock: "2026-08-03T10:00:00.000Z", expectedVersion: getCanonicalExerciseSnapshot().version, ...extras,
});

describe("WP-22 authoritative exercise controls", () => {
  beforeEach(() => { stopClockRunner(); clearExerciseRuntimeOwner(); clearExerciseClockTargets(); resetExerciseControlCommandHandler();
    replaceCanonicalExerciseSnapshot({ exerciseId: "demo", lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: 0 });
    registerExerciseRuntimeOwner(new AuthoritativeExerciseRuntime("demo")); });
  afterEach(stopClockRunner);

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
});
