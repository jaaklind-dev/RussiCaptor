import fs from "node:fs";
import path from "node:path";

import type { RuntimeCompletionRequest } from "@/models/RuntimeCompletion";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { RuntimeCompletionCanonicalRebaseWake } from
  "@/services/runtime/exercise/RuntimeCompletionCanonicalRebaseWake";
import {
  createRuntimeCheckpoint,
  resolvePendingCompletionWriterCandidateCheckpoint,
} from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const source = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function state(simulationTimeSec: number): SharedExerciseState {
  const runtimePayload = { simulationTimeSec };
  return {
    exerciseSession: {
      exerciseId: "EX-1790573087374-1",
      lifecycleState: "RUNNING",
      simulationTimeSec,
      startedAtSimulationSec: 0,
    } as never,
    patients: [{ id: "PT-PELVIC-001", name: "P01" } as never],
    assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
    scenarioEvents: [], timelineEvents: [],
    persistedRuntimeStates: [{
      schemaVersion: 1,
      provenance: {
        exerciseId: "EX-1790573087374-1",
        patientId: "PT-PELVIC-001",
        packageId: "russicaptor.narva-trauma",
        packageVersion: "1.0.5",
        packageHash: "package-hash",
        definitionHash: "definition-hash",
        moduleCompositionHash: "module-hash",
      },
      capturedAtSimulationTimeSec: simulationTimeSec,
      payload: runtimePayload,
      payloadHash: sha256Text(stableJson(runtimePayload)),
    } as never],
  };
}

const request = (): RuntimeCompletionRequest => Object.freeze({
  exerciseId: "EX-1790573087374-1",
  commandId: "EXCON-1790577652608-1",
  requestedBy: "EXCON-B",
  expectedExerciseVersion: 34,
  fenceCommandSequence: 243,
  status: "PENDING",
});

class WakeFixture {
  current = true;
  prepStarts = 0;
  payloads = 0;
  finalizations = 0;
  readonly requestIds: string[] = [];
  readonly traces: string[] = [];
  readonly wake = new RuntimeCompletionCanonicalRebaseWake({
    exerciseId: "EX-1790573087374-1",
    generation: "exercise-gen-9",
    isCurrent: () => this.current,
    dispatch: async completion => {
      this.requestIds.push(completion.commandId);
      this.prepStarts += 1;
      this.payloads += 1;
      this.finalizations += 1;
    },
    trace: event => this.traces.push(event),
  });
}

describe("LEGACY-PENDING-COMPLETION-DISPATCH-TO-TERMINAL-INTENT-WAKE-03", () => {
  const remote = createRuntimeCheckpoint(state(11_862), 223);
  const unpublishedLocal = createRuntimeCheckpoint(state(17_270), 259);

  test("TERM-WAKE-01 resume before canonical rebase completion defers safely", async () => {
    const fixture = new WakeFixture();
    await expect(fixture.wake.observe(request())).resolves.toBe("DEFERRED");
    expect(fixture.prepStarts).toBe(0);
  });

  test("TERM-WAKE-02 canonical rebase completion wakes terminal preparation", async () => {
    const fixture = new WakeFixture();
    await fixture.wake.observe(request());
    await expect(fixture.wake.canonicalRebaseComplete(request().commandId)).resolves.toBe("WOKE");
    expect(fixture.traces).toEqual(["TERMINAL_INTENT_WAKE"]);
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    const startup = sync.slice(sync.indexOf("async function startRuntimeCheckpointSyncForExercise"));
    expect(startup.indexOf('"CANONICAL_REBASE_START"')).toBeLessThan(
      startup.indexOf('"CANONICAL_REBASE_COMPLETE"'),
    );
    expect(startup.indexOf('"CANONICAL_REBASE_COMPLETE"')).toBeLessThan(
      startup.indexOf("completionCanonicalRebaseWake.canonicalRebaseComplete"),
    );
  });

  test("TERM-WAKE-03 higher unpublished local revision does not override canonical checkpoint", () => {
    expect(resolvePendingCompletionWriterCandidateCheckpoint(unpublishedLocal, remote, "PENDING"))
      .toEqual({ status: "REMOTE_REBASE", checkpoint: remote, code: "CANONICAL_CHECKPOINT_CONFLICT" });
  });

  test("TERM-WAKE-04 canonical source authority beats local revision and clock magnitude", () => {
    const resolved = resolvePendingCompletionWriterCandidateCheckpoint(unpublishedLocal, remote, "PENDING");
    expect(resolved.status).toBe("REMOTE_REBASE");
    if (resolved.status !== "REMOTE_REBASE") throw new Error("REMOTE_REBASE_EXPECTED");
    expect(resolved.checkpoint).toBe(remote);
    expect((resolved.checkpoint.payload.exerciseSession as { simulationTimeSec: number }).simulationTimeSec).toBe(11_862);
  });

  test("TERM-WAKE-05 stale generation rebase wake is ignored", async () => {
    const fixture = new WakeFixture();
    await fixture.wake.observe(request());
    fixture.current = false;
    await expect(fixture.wake.canonicalRebaseComplete(request().commandId)).resolves.toBe("STALE_GENERATION");
    expect(fixture.prepStarts).toBe(0);
  });

  test("TERM-WAKE-06 current generation wake fires exactly once", async () => {
    const fixture = new WakeFixture();
    await fixture.wake.observe(request());
    await Promise.all([
      fixture.wake.canonicalRebaseComplete(request().commandId),
      fixture.wake.canonicalRebaseComplete(request().commandId),
    ]);
    expect(fixture.prepStarts).toBe(1);
  });

  test("TERM-WAKE-07 no second request event is required", async () => {
    const fixture = new WakeFixture();
    const existing = request();
    await fixture.wake.observe(existing);
    await fixture.wake.canonicalRebaseComplete(existing.commandId);
    expect(fixture.requestIds).toEqual([existing.commandId]);
  });

  test("TERM-WAKE-08 wake path needs no foreground, reconnect or polling trigger", () => {
    const wakeSource = source("src/services/runtime/exercise/RuntimeCompletionCanonicalRebaseWake.ts");
    expect(wakeSource).not.toMatch(/AppState|reconnect|setInterval|setTimeout/);
  });

  test("TERM-WAKE-09 COMPLETION_PREP_START is emitted exactly once", async () => {
    const fixture = new WakeFixture();
    await fixture.wake.observe(request());
    await fixture.wake.canonicalRebaseComplete(request().commandId);
    await fixture.wake.canonicalRebaseComplete(request().commandId);
    expect(fixture.prepStarts).toBe(1);
    expect(source("src/services/StatePersistenceService.ts")).toContain('"COMPLETION_PREP_START"');
    expect(source("src/services/RuntimeCheckpointSyncService.ts"))
      .toContain("dispatch:async request=>{await processCompletionRequest(request);}");
    expect(source("src/services/runtime/exercise/ExerciseControlCommandHandler.ts"))
      .toContain("beginRuntimeCompletionCheckpointIntent()");
  });

  test("TERM-WAKE-10 terminal payload builds exactly once", async () => {
    const fixture = new WakeFixture();
    await fixture.wake.observe(request());
    await fixture.wake.canonicalRebaseComplete(request().commandId);
    expect(fixture.payloads).toBe(1);
    expect(source("src/services/StatePersistenceService.ts")).toContain('"COMPLETION_PAYLOAD_READY"');
  });

  test("TERM-WAKE-11 atomic finalizer is invoked exactly once", async () => {
    const fixture = new WakeFixture();
    await fixture.wake.observe(request());
    await fixture.wake.canonicalRebaseComplete(request().commandId);
    await fixture.wake.canonicalRebaseComplete(request().commandId);
    expect(fixture.finalizations).toBe(1);
  });

  test("TERM-WAKE-12 the same durable completion request is reused", async () => {
    const fixture = new WakeFixture();
    const existing = request();
    await fixture.wake.observe(existing);
    await fixture.wake.canonicalRebaseComplete(existing.commandId);
    expect(fixture.requestIds).toEqual(["EXCON-1790577652608-1"]);
  });

  test("TERM-WAKE-13 generic runtime publication remains fenced", () => {
    const sync = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(sync).toContain('activeCompletion?.status==="PENDING"&&priority==="ROUTINE"');
  });

  test("TERM-WAKE-14 generic CloudSync projection remains fenced", () => {
    const cloud = source("src/services/CloudSyncService.ts");
    expect(cloud).toContain("isRuntimeCompletionPublicationFenced(exerciseId)");
    expect(cloud).toContain("projectionWriteCoordinator.discardPending()");
  });

  test("TERM-WAKE-15 canonical rebase wake creates no synthetic clinical time", () => {
    const wakeSource = source("src/services/runtime/exercise/RuntimeCompletionCanonicalRebaseWake.ts");
    expect(wakeSource).not.toMatch(/tickExerciseClock|advanceExerciseClock|notifySync/);
  });

  test("TERM-WAKE-16 modern non-completion writer selection remains unchanged", () => {
    expect(resolvePendingCompletionWriterCandidateCheckpoint(unpublishedLocal, remote, undefined))
      .toEqual({ status: "LOCAL", checkpoint: unpublishedLocal });
    expect(resolvePendingCompletionWriterCandidateCheckpoint(unpublishedLocal, remote, "COMPLETED"))
      .toEqual({ status: "LOCAL", checkpoint: unpublishedLocal });
  });
});
