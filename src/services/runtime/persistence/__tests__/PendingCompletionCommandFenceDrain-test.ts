import fs from "node:fs";
import path from "node:path";

import { drainRuntimePatientCommandsThroughFence } from
  "@/services/runtime/commands/RuntimePatientCommandFenceDrain";

const source = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), "utf8");

class CompletionFenceFixture {
  cursor = 243;
  fence = 243;
  currentWriter = true;
  currentGeneration = true;
  drainCalls = 0;
  handlerEnters = 0;
  prepStarts = 0;
  atomicFinalizations = 0;
  readonly requestIds: string[] = [];
  readonly traces: string[] = [];
  private processing: Promise<void> | undefined;
  private completed = false;
  drainResult: Promise<number> | number = 243;

  resume(requestId = "EXCON-1790577652608-1"): Promise<void> {
    if (this.completed) return Promise.resolve();
    if (this.processing) return this.processing;
    const task = (async () => {
      await drainRuntimePatientCommandsThroughFence({
        fence: this.fence,
        currentCursor: () => this.cursor,
        drain: async () => {
          this.drainCalls += 1;
          const result = await this.drainResult;
          this.cursor = result;
          return result;
        },
        isCurrentWriter: () => this.currentWriter && this.currentGeneration,
        trace: event => this.traces.push(event),
      });
      if (!this.currentWriter || !this.currentGeneration) return;
      this.requestIds.push(requestId);
      this.handlerEnters += 1;
      this.prepStarts += 1;
      this.atomicFinalizations += 1;
      this.completed = true;
    })();
    this.processing = task;
    void task.finally(() => {
      if (this.processing === task) this.processing = undefined;
    }).catch(() => undefined);
    return task;
  }
}

describe("LEGACY-PENDING-COMPLETION-DISPATCH-COMMAND-FENCE-04", () => {
  test("CMD-FENCE-01 cursor equal to the inclusive fence is already satisfied", async () => {
    const fixture = new CompletionFenceFixture();
    await fixture.resume();
    expect(fixture.drainCalls).toBe(0);
    expect(fixture.traces).toEqual([
      "COMPLETION_COMMAND_FENCE_CHECK",
      "COMPLETION_COMMAND_DRAIN_COMPLETE",
    ]);
  });

  test("CMD-FENCE-02 cursor below fence waits for the real drain", async () => {
    const fixture = new CompletionFenceFixture();
    fixture.cursor = 242;
    let release!: (cursor: number) => void;
    fixture.drainResult = new Promise<number>(resolve => { release = resolve; });
    const resumed = fixture.resume();
    await Promise.resolve();
    expect(fixture.handlerEnters).toBe(0);
    expect(fixture.traces).toContain("COMPLETION_COMMAND_DRAIN_WAIT");
    release(243);
    await resumed;
    expect(fixture.handlerEnters).toBe(1);
  });

  test("CMD-FENCE-03 cursor above fence continues immediately", async () => {
    const fixture = new CompletionFenceFixture();
    fixture.cursor = 244;
    await fixture.resume();
    expect(fixture.drainCalls).toBe(0);
    expect(fixture.handlerEnters).toBe(1);
  });

  test("CMD-FENCE-04 already-satisfied fence requires no later command event", async () => {
    const fixture = new CompletionFenceFixture();
    await fixture.resume();
    expect(fixture.handlerEnters).toBe(1);
    expect(fixture.traces).not.toContain("COMPLETION_COMMAND_DRAIN_WAIT");
  });

  test("CMD-FENCE-05 recognition creates no command and does not advance the cursor", async () => {
    const fixture = new CompletionFenceFixture();
    await fixture.resume();
    expect(fixture.cursor).toBe(243);
    expect(fixture.drainCalls).toBe(0);
    const fenceSource = source("src/services/runtime/commands/RuntimePatientCommandFenceDrain.ts");
    expect(fenceSource).not.toMatch(/advanceRuntimePatientCommandCursor|restoreRuntimePatientCommandCursor|submitPatientRuntimeCommand/);
  });

  test("CMD-FENCE-06 completion handler enters exactly once", async () => {
    const fixture = new CompletionFenceFixture();
    await Promise.all([fixture.resume(), fixture.resume()]);
    expect(fixture.handlerEnters).toBe(1);
  });

  test("CMD-FENCE-07 terminal preparation starts exactly once", async () => {
    const fixture = new CompletionFenceFixture();
    await Promise.all([fixture.resume(), fixture.resume()]);
    expect(fixture.prepStarts).toBe(1);
    expect(source("src/services/StatePersistenceService.ts")).toContain('"COMPLETION_PREP_START"');
  });

  test("CMD-FENCE-08 duplicate drain completion cannot duplicate continuation", async () => {
    const fixture = new CompletionFenceFixture();
    fixture.cursor = 242;
    fixture.drainResult = 243;
    await Promise.all([fixture.resume(), fixture.resume(), fixture.resume()]);
    expect(fixture.drainCalls).toBe(1);
    expect(fixture.handlerEnters).toBe(1);
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("CMD-FENCE-09 stale generation is ignored", async () => {
    const fixture = new CompletionFenceFixture();
    fixture.cursor = 242;
    fixture.currentGeneration = false;
    await expect(fixture.resume()).rejects.toThrow("RUNTIME_COMMAND_FENCE_WRITER_LOST");
    expect(fixture.handlerEnters).toBe(0);
  });

  test("CMD-FENCE-10 writer loss during a real drain fails safely", async () => {
    const fixture = new CompletionFenceFixture();
    fixture.cursor = 242;
    fixture.drainResult = Promise.resolve(243).then(cursor => {
      fixture.currentWriter = false;
      return cursor;
    });
    await expect(fixture.resume()).rejects.toThrow("RUNTIME_COMMAND_FENCE_WRITER_LOST");
    expect(fixture.handlerEnters).toBe(0);
  });

  test("CMD-FENCE-11 restart with an already-satisfied fence resumes immediately", async () => {
    const restarted = new CompletionFenceFixture();
    await restarted.resume();
    expect(restarted.drainCalls).toBe(0);
    expect(restarted.atomicFinalizations).toBe(1);
  });

  test("CMD-FENCE-12 modern non-recovery command drain remains on the ordinary consumer path", () => {
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(sync).toContain("if(throughSequence!==undefined)");
    expect(sync).toContain("return patientCommandConsumer.drain(exerciseId,lease);");
  });

  test("CMD-FENCE-13 the same completion request identity is reused", async () => {
    const fixture = new CompletionFenceFixture();
    await fixture.resume("EXCON-1790577652608-1");
    expect(fixture.requestIds).toEqual(["EXCON-1790577652608-1"]);
  });

  test("CMD-FENCE-14 routine Runtime publication remains fenced", () => {
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(sync).toContain('activeCompletion?.status==="PENDING"&&priority==="ROUTINE"');
  });

  test("CMD-FENCE-15 routine CloudSync projection remains fenced", () => {
    const cloud = source("src/services/CloudSyncService.ts");
    expect(cloud).toContain("isRuntimeCompletionPublicationFenced(exerciseId)");
    expect(cloud).toContain("projectionWriteCoordinator.discardPending()");
  });

  test("CMD-FENCE-16 atomic finalizer is invoked once", async () => {
    const fixture = new CompletionFenceFixture();
    await Promise.all([fixture.resume(), fixture.resume()]);
    expect(fixture.atomicFinalizations).toBe(1);
    expect(source("src/services/RuntimeCheckpointSyncService.ts")).toContain("repository.finalizeCompletion!");
  });

  test("zero command history satisfies a zero fence without a drain", async () => {
    const fixture = new CompletionFenceFixture();
    fixture.cursor = 0;
    fixture.fence = 0;
    await fixture.resume();
    expect(fixture.drainCalls).toBe(0);
    expect(fixture.handlerEnters).toBe(1);
  });
});
