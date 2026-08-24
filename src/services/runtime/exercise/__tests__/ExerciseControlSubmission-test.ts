import type { ExerciseControlCommand } from "@/models/exercise/ExerciseControlCommand";
import { prepareExerciseControlSubmission } from "../ExerciseControlSubmission";

describe("WP-45C1 Complete terminal convergence", () => {
  test("one confirmed Complete intent reuses one commandId across duplicate callback delivery", () => {
    const created: ExerciseControlCommand = {
      commandId: "COMPLETE-ONE",
      exerciseId: "EX-1",
      commandType: "COMPLETE_EXERCISE",
      issuedBy: "Exercise Controller",
      issuedAtWallClock: "2026-08-24T12:00:00.000Z",
      expectedVersion: 7,
    };
    const create = jest.fn(() => created);
    const handle = jest.fn((_command: ExerciseControlCommand) => ({
      ok: true as const,
      commandId: created.commandId,
      snapshot: { exerciseId: "EX-1", lifecycleState: "COMPLETED" as const, simulationTimeSec: 10, speed: 1 as const, version: 8 },
      eventType: "ExerciseCompleted" as const,
    }));
    const submit = prepareExerciseControlSubmission("COMPLETE_EXERCISE", undefined, {
      snapshot: () => ({ exerciseId: "EX-1", lifecycleState: "RUNNING", simulationTimeSec: 10, speed: 1, version: 7 }),
      create,
      handle,
    });

    expect(submit()).toMatchObject({ ok: true, commandId: "COMPLETE-ONE" });
    expect(submit()).toMatchObject({ ok: true, commandId: "COMPLETE-ONE" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toBe(handle.mock.calls[1][0]);
  });

  test("a genuinely new Complete intent creates a new command for normal terminal guarding", () => {
    let sequence = 0;
    const create = jest.fn(input => ({
      commandId: `COMPLETE-${++sequence}`,
      exerciseId: input.exerciseId,
      commandType: input.commandType,
      issuedBy: "Exercise Controller" as const,
      issuedAtWallClock: "2026-08-24T12:00:00.000Z",
      expectedVersion: input.expectedVersion,
    }));
    const dependencies = {
      snapshot: () => ({ exerciseId: "EX-1", lifecycleState: "COMPLETED" as const, simulationTimeSec: 10, speed: 1 as const, version: 8 }),
      create,
      handle: jest.fn(command => ({ ok: false as const, commandId: command.commandId, errorCode: "INVALID_TRANSITION" as const, message: "already completed" })),
    };

    const first = prepareExerciseControlSubmission("COMPLETE_EXERCISE", undefined, dependencies);
    const second = prepareExerciseControlSubmission("COMPLETE_EXERCISE", undefined, dependencies);
    expect(first()).toMatchObject({ ok: false, commandId: "COMPLETE-1" });
    expect(second()).toMatchObject({ ok: false, commandId: "COMPLETE-2" });
  });
});
