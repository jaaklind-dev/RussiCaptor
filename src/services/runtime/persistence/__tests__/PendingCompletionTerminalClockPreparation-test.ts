import fs from "node:fs";
import path from "node:path";

import {
  RuntimeCheckpointClockMismatchError,
  terminalClockReconciliationDecision,
} from "@/services/runtime/persistence/RuntimeTerminalClockReconciliation";
import { LatestGenerationPipeline } from "@/services/runtime/persistence/LatestGenerationPipeline";

const source = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const decision = (overrides: Partial<Parameters<typeof terminalClockReconciliationDecision>[0]> = {}) =>
  terminalClockReconciliationDecision({
    lifecycleState: "COMPLETED",
    preparationClockSec: 11_862,
    canonicalClockSec: 11_863,
    detachedRuntimeClocks: [11_862, 11_863],
    liveRuntimeClocks: [11_863, 11_863],
    retryAlreadyScheduled: false,
    ...overrides,
  });

describe("LEGACY-PENDING-COMPLETION-TERMINAL-CHECKPOINT-PREPARATION-WAKE-02", () => {
  test("TERM-CLOCK-01 legacy cooperative capture mismatch is explicit and bounded", () => {
    const error = new RuntimeCheckpointClockMismatchError(11_862, [11_862, 11_863]);
    expect(error.message).toBe("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
    expect(error).toMatchObject({ expectedSimulationTimeSec: 11_862, observedRuntimeClocks: [11_862, 11_863] });
  });

  test("TERM-CLOCK-02 reconcilable detached/runtime mismatch requests one canonical recapture", async () => {
    let captures = 0;
    let payloads = 0;
    let retryScheduled = false;
    let pipeline!: LatestGenerationPipeline;
    pipeline = new LatestGenerationPipeline(async () => {
      captures += 1;
      if (captures === 1) {
        const result = decision({ retryAlreadyScheduled: retryScheduled });
        expect(result.state).toBe("RETRY_FROM_CANONICAL_CLOCK");
        retryScheduled = true;
        pipeline.request();
        return;
      }
      payloads += 1;
    }, async () => undefined);
    pipeline.request();
    await pipeline.idle();
    expect({ captures, payloads }).toEqual({ captures: 2, payloads: 1 });
  });

  test("TERM-CLOCK-03 terminal payload is rebuilt by the existing preparation pipeline", () => {
    const persistence = source("src/services/StatePersistenceService.ts");
    expect(persistence).toContain("terminalCaptureGeneration = pipeline.request()");
    expect(persistence).toContain('"COMPLETION_PAYLOAD_READY"');
  });

  test("TERM-CLOCK-04 reconciliation creates no synthetic clinical tick or event", () => {
    const reconciliation = source("src/services/runtime/persistence/RuntimeTerminalClockReconciliation.ts");
    expect(reconciliation).not.toContain("tickExerciseClock");
    expect(reconciliation).not.toContain("notifySync");
    expect(reconciliation).not.toContain("advanceExerciseClock");
  });

  test("TERM-CLOCK-05 canonical time is never advanced by reconciliation", () => {
    expect(decision()).toMatchObject({ canonicalClockSec: 11_863, deltaSec: 1 });
    expect(decision({ canonicalClockSec: 11_861 }).state).toBe("UNSAFE_MISMATCH");
  });

  test("TERM-CLOCK-06 atomic finalizer handoff remains the single terminal RPC path", () => {
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(sync).toContain('"COMPLETION_FINALIZE_RPC_START"');
    expect(sync).toContain("repository.finalizeCompletion!(completionForCheckpoint.commandId");
  });

  test("TERM-CLOCK-07 same completion request identity is reused", () => {
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(sync).toContain("completionForCheckpoint.commandId");
    expect(sync).not.toContain("submit_runtime_completion_request");
  });

  test("TERM-CLOCK-08 terminal recapture does not invoke generic runtime publication", () => {
    const persistence = source("src/services/StatePersistenceService.ts");
    expect(persistence).not.toContain("publish_runtime_checkpoint");
  });

  test("TERM-CLOCK-09 terminal recapture does not invoke CloudSync projection", () => {
    const reconciliation = source("src/services/runtime/persistence/RuntimeTerminalClockReconciliation.ts");
    expect(reconciliation).not.toContain("exercise_states");
    expect(reconciliation).not.toContain("publishCloudProjection");
  });

  test.each([
    ["running lifecycle", { lifecycleState: "RUNNING" }],
    ["live clocks disagree", { liveRuntimeClocks: [11_862, 11_863] }],
    ["runtime is ahead of canonical", { detachedRuntimeClocks: [11_864, 11_864] }],
    ["runtime is behind preparation", { detachedRuntimeClocks: [11_861, 11_863] }],
  ])("TERM-CLOCK-10 true unsafe mismatch fails closed: %s", (_label, overrides) => {
    expect(decision(overrides).state).toBe("UNSAFE_MISMATCH");
  });

  test("TERM-CLOCK-11 failed preparation receives at most one same-generation-family retry", () => {
    expect(decision({ retryAlreadyScheduled: true }).state).toBe("UNSAFE_MISMATCH");
  });

  test("TERM-CLOCK-12 stale capture generations remain preempted", () => {
    const persistence = source("src/services/StatePersistenceService.ts");
    expect(persistence).toContain("generation < terminalCaptureGeneration");
    expect(persistence).toContain("RuntimeCheckpointPreparationSupersededError");
  });

  test("TERM-CLOCK-13 recapture does not add a reconnect or restart finalizer", () => {
    const reconciliation = source("src/services/runtime/persistence/RuntimeTerminalClockReconciliation.ts");
    expect(reconciliation).not.toMatch(/reconnect|restart|setInterval/);
  });

  test("TERM-CLOCK-14 modern equal-clock capture remains unchanged", () => {
    expect(decision({ canonicalClockSec: 11_862, detachedRuntimeClocks: [11_862, 11_862],
      liveRuntimeClocks: [11_862, 11_862] }).state).toBe("UNSAFE_MISMATCH");
  });

  test("TERM-CLOCK-15 writer-READY resume remains connected", () => {
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(sync).toContain("completionResumeCoordinator?.writerReady()");
    expect(sync).toContain("writerReadyGeneration.resumePendingCompletion");
  });

  test("TERM-CLOCK-16 terminal publication fence remains intact", () => {
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(sync).toContain('activeCompletion?.status==="PENDING"&&priority==="ROUTINE"');
  });

  test("TERM-CLOCK-17 CloudSync completion fence remains intact", () => {
    const cloud = source("src/services/CloudSyncService.ts");
    expect(cloud).toContain("isRuntimeCompletionPublicationFenced(exerciseId)");
    expect(cloud).toContain("projectionWriteCoordinator.discardPending()");
  });
});
