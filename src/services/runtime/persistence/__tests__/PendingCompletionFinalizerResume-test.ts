import fs from "node:fs";
import path from "node:path";

import type { RuntimeCompletionRequest } from "@/models/RuntimeCompletion";
import {
  RuntimeCompletionFinalizerResumeCoordinator,
} from "@/services/runtime/exercise/RuntimeCompletionFinalizerResumeCoordinator";
import {
  isRuntimeCompletionPublicationFenced,
  setRuntimeCompletionPhase,
} from "@/services/runtime/exercise/RuntimeCompletionService";

const syncSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"),
  "utf8",
);

const pendingRequest = (commandId = "EXCON-1790577652608-1"): RuntimeCompletionRequest => Object.freeze({
  exerciseId: "EX-1790573087374-1",
  commandId,
  requestedBy: "EXCON-B",
  expectedExerciseVersion: 34,
  fenceCommandSequence: 243,
  status: "PENDING",
});

class FinalizerResumeFixture {
  current = true;
  ready = false;
  failBeforeAtomicFinalize = false;
  dispatchAttempts = 0;
  atomicFinalizations = 0;
  terminalCheckpoints = 0;
  writerReleases = 0;
  requests = [pendingRequest()];
  readonly traces: string[] = [];
  readonly coordinator: RuntimeCompletionFinalizerResumeCoordinator;

  constructor(generation = "exercise-gen-2") {
    this.coordinator = new RuntimeCompletionFinalizerResumeCoordinator({
      exerciseId: "EX-1790573087374-1",
      generation,
      isCurrent: () => this.current,
      isWriterReady: () => this.ready,
      dispatch: async request => {
        this.dispatchAttempts += 1;
        if (this.failBeforeAtomicFinalize) {
          this.failBeforeAtomicFinalize = false;
          throw new Error("WRITER_NOT_READY");
        }
        this.atomicFinalizations += 1;
        this.terminalCheckpoints += 1;
        this.writerReleases += 1;
        this.requests[0] = Object.freeze({
          ...request,
          status: "COMPLETED",
          terminalCheckpointRevision: 224,
          terminalPayloadHash: "terminal-hash",
        });
        this.coordinator.completed(request.commandId);
      },
      trace: event => this.traces.push(event),
    });
  }
}

describe("LEGACY-PENDING-COMPLETION-FINALIZER-RESUME-01", () => {
  afterEach(() => setRuntimeCompletionPhase("none", "IDLE"));

  test("FINALIZER-RESUME-01 PENDING request discovered before writer READY resumes when READY fires", async () => {
    const fixture = new FinalizerResumeFixture();
    await expect(fixture.coordinator.observe(fixture.requests[0])).resolves.toBe("DEFERRED_WRITER_NOT_READY");
    expect(fixture.atomicFinalizations).toBe(0);
    fixture.ready = true;
    await expect(fixture.coordinator.writerReady()).resolves.toBe("DISPATCHED");
    expect(fixture.atomicFinalizations).toBe(1);
    expect(syncSource).toContain("completionResumeCoordinator?.writerReady()");
  });

  test("FINALIZER-RESUME-02 request discovered after writer READY finalizes normally", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await expect(fixture.coordinator.observe(fixture.requests[0])).resolves.toBe("DISPATCHED");
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("FINALIZER-RESUME-03 takeover generation change does not strand lifecycle work", async () => {
    const stale = new FinalizerResumeFixture("exercise-gen-1");
    await stale.coordinator.observe(stale.requests[0]);
    stale.current = false;
    stale.coordinator.stop();
    const current = new FinalizerResumeFixture("exercise-gen-2");
    current.ready = true;
    await current.coordinator.observe(current.requests[0]);
    expect(stale.atomicFinalizations).toBe(0);
    expect(current.atomicFinalizations).toBe(1);
    expect(syncSource).toContain("writerReadyGeneration.resumePendingCompletion");
  });

  test("FINALIZER-RESUME-04 stale generation callback cannot finalize", async () => {
    const fixture = new FinalizerResumeFixture("exercise-gen-1");
    await fixture.coordinator.observe(fixture.requests[0]);
    fixture.current = false;
    fixture.ready = true;
    await expect(fixture.coordinator.writerReady()).resolves.toBe("STALE_GENERATION");
    expect(fixture.atomicFinalizations).toBe(0);
  });

  test("FINALIZER-RESUME-05 request is not marked handled before finalizer ownership begins", async () => {
    const fixture = new FinalizerResumeFixture();
    const request = fixture.requests[0];
    await fixture.coordinator.observe(request);
    expect(fixture.dispatchAttempts).toBe(0);
    expect(fixture.requests[0]).toBe(request);
    fixture.ready = true;
    await fixture.coordinator.writerReady();
    expect(fixture.dispatchAttempts).toBe(1);
  });

  test("FINALIZER-RESUME-06 failed pre-finalization attempt remains retryable", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    fixture.failBeforeAtomicFinalize = true;
    await expect(fixture.coordinator.observe(fixture.requests[0])).rejects.toThrow("WRITER_NOT_READY");
    expect(fixture.atomicFinalizations).toBe(0);
    await fixture.coordinator.writerReady();
    expect(fixture.dispatchAttempts).toBe(2);
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("FINALIZER-RESUME-07 publication fence does not block atomic finalizer scheduling", async () => {
    const fixture = new FinalizerResumeFixture();
    setRuntimeCompletionPhase("EX-1790573087374-1", "PENDING");
    expect(isRuntimeCompletionPublicationFenced("EX-1790573087374-1")).toBe(true);
    fixture.ready = true;
    await fixture.coordinator.observe(fixture.requests[0]);
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("FINALIZER-RESUME-08 no second request-subscription event is required", async () => {
    const fixture = new FinalizerResumeFixture();
    await fixture.coordinator.observe(fixture.requests[0]);
    fixture.ready = true;
    await fixture.coordinator.writerReady();
    expect(fixture.traces.filter(event => event === "COMPLETION_REQUEST_DISCOVERED")).toHaveLength(1);
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("FINALIZER-RESUME-09 reconnect after READY does not duplicate finalizer", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await fixture.coordinator.observe(fixture.requests[0]);
    await fixture.coordinator.wake("REALTIME_RECONNECT");
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("FINALIZER-RESUME-10 foreground transition does not duplicate finalizer", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await fixture.coordinator.observe(fixture.requests[0]);
    await fixture.coordinator.wake("APP_FOREGROUND");
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("FINALIZER-RESUME-11 finalizeCompletion ownership is exactly once across concurrent wakes", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await Promise.all([
      fixture.coordinator.observe(fixture.requests[0]),
      fixture.coordinator.writerReady(),
      fixture.coordinator.wake("TAKEOVER_RESUME"),
    ]);
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("FINALIZER-RESUME-12 same request identity is reused", async () => {
    const fixture = new FinalizerResumeFixture();
    const request = fixture.requests[0];
    fixture.ready = true;
    await fixture.coordinator.observe(request);
    expect(fixture.requests[0].commandId).toBe(request.commandId);
  });

  test("FINALIZER-RESUME-13 no duplicate completion request is created", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await fixture.coordinator.observe(fixture.requests[0]);
    expect(fixture.requests).toHaveLength(1);
  });

  test("FINALIZER-RESUME-14 terminal checkpoint is committed exactly once", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await fixture.coordinator.observe(fixture.requests[0]);
    await fixture.coordinator.writerReady();
    expect(fixture.terminalCheckpoints).toBe(1);
  });

  test("FINALIZER-RESUME-15 writer is released after finalization", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await fixture.coordinator.observe(fixture.requests[0]);
    expect(fixture.writerReleases).toBe(1);
  });

  test("FINALIZER-RESUME-16 restart after terminalization remains terminal", async () => {
    const fixture = new FinalizerResumeFixture();
    fixture.ready = true;
    await fixture.coordinator.observe(fixture.requests[0]);
    const restarted = new FinalizerResumeFixture("exercise-gen-3");
    restarted.ready = true;
    await restarted.coordinator.observe(fixture.requests[0]);
    expect(fixture.requests[0].status).toBe("COMPLETED");
    expect(restarted.atomicFinalizations).toBe(0);
  });
});
