import type { ExerciseControlCommand } from "@/models/exercise/ExerciseControlCommand";
import type { RuntimeCompletionGateway } from "../RuntimeCompletionService";
import { getRuntimeCompletionPhase, setRuntimeCompletionGateway, submitRuntimeCompletion } from "../RuntimeCompletionService";

const command: ExerciseControlCommand = Object.freeze({ commandId: "COMPLETE-1", exerciseId: "demo",
  commandType: "COMPLETE_EXERCISE", issuedBy: "Exercise Controller",
  issuedAtWallClock: "2026-09-07T10:00:00.000Z", expectedVersion: 0 });

describe("WP-NARVA-06 completion submission", () => {
  afterEach(() => setRuntimeCompletionGateway(undefined));

  test("does not report success before atomic terminal completion is observed", async () => {
    let loads = 0;
    const gateway: RuntimeCompletionGateway = {
      submit: async () => ({ status: "PENDING", fenceCommandSequence: 4 }),
      load: async () => ({ exerciseId: "demo", commandId: "COMPLETE-1", requestedBy: "EXCON",
        expectedExerciseVersion: 0, fenceCommandSequence: 4, status: ++loads > 1 ? "COMPLETED" : "PENDING",
        terminalCheckpointRevision: loads > 1 ? 75 : undefined }),
    };
    setRuntimeCompletionGateway(gateway);
    const result = await submitRuntimeCompletion(command, 2_000);
    expect(result).toMatchObject({ ok: true, snapshot: { lifecycleState: "COMPLETED" } });
    expect(loads).toBe(2);
    expect(getRuntimeCompletionPhase()).toMatchObject({ exerciseId: "demo", phase: "COMPLETED" });
  });

  test("failure stays explicit and recoverable instead of presenting COMPLETED", async () => {
    setRuntimeCompletionGateway({ submit: async () => ({ status: "REJECTED", code: "VERSION_CONFLICT" }),
      load: async () => undefined });
    await expect(submitRuntimeCompletion(command, 1)).resolves.toMatchObject({ ok: false, errorCode: "VERSION_CONFLICT" });
    expect(getRuntimeCompletionPhase()).toMatchObject({ phase: "FAILED", code: "VERSION_CONFLICT" });
  });

  test("already completed request is idempotent", async () => {
    const submit = jest.fn(async () => ({ status: "COMPLETED" as const, fenceCommandSequence: 4, terminalCheckpointRevision: 75 }));
    setRuntimeCompletionGateway({ submit, load: async () => undefined });
    expect((await submitRuntimeCompletion(command, 1)).ok).toBe(true);
    expect((await submitRuntimeCompletion(command, 1)).ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  test("lost reconciliation response stays pending and never reports false success", async () => {
    setRuntimeCompletionGateway({ submit: async () => ({ status: "PENDING", fenceCommandSequence: 4 }),
      load: async () => { throw new Error("NETWORK_UNAVAILABLE"); } });
    await expect(submitRuntimeCompletion(command, 1_000)).resolves.toMatchObject({ ok: false, errorCode: "RUNTIME_FAILURE" });
    expect(getRuntimeCompletionPhase()).toMatchObject({ phase: "PENDING", code: "COMPLETION_RECONCILIATION_UNAVAILABLE" });
  });
});
