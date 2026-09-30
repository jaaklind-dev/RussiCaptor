import type { SharedExerciseState } from "@/models/SharedExerciseState";
import {
  createRuntimeCheckpoint,
  resolveWriterCandidateCheckpoint,
} from "../RuntimeCheckpointAuthorityService";
import { prepareRuntimeWriterCandidateBeforeLease } from "@/services/RuntimeCheckpointSyncService";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import fs from "node:fs";
import path from "node:path";

function state(
  lifecycleState: "RUNNING" | "PAUSED",
  location: string,
  timelineEventIds: readonly string[],
): SharedExerciseState {
  const runtimePayload = { simulationTimeSec: 120 };
  return {
    exerciseSession: {
      exerciseId: "EX-EQUAL-REVISION",
      lifecycleState,
      simulationTimeSec: 120,
      startedAtSimulationSec: 0,
    } as never,
    patients: [{ id: "PT-PELVIC-001", name: "P01", location } as never],
    assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
    scenarioEvents: [],
    timelineEvents: timelineEventIds.map(id => ({ id } as never)),
    persistedRuntimeStates: [{
      schemaVersion: 1,
      provenance: {
        exerciseId: "EX-EQUAL-REVISION",
        patientId: "PT-PELVIC-001",
        packageId: "russicaptor.narva-trauma",
        packageVersion: "1.0.5",
        packageHash: "package-hash",
        definitionHash: "definition-hash",
        moduleCompositionHash: "module-hash",
      },
      capturedAtSimulationTimeSec: 120,
      payload: runtimePayload,
      payloadHash: sha256Text(stableJson(runtimePayload)),
    } as never],
    runtimePatientCommandCursor: 1,
  };
}

describe("equal-revision writer takeover checkpoint authority", () => {
  test("CHK-G01/G02/G04: equal hash is safe while divergent equal revision rebases to remote canonical", () => {
    const remote = createRuntimeCheckpoint(state("PAUSED", "NARVA_ED", ["P01-MOVE-ED"]), 42);
    const equivalent = structuredClone(remote);
    const divergent = createRuntimeCheckpoint(state("RUNNING", "NARVA_ED", []), 42);

    expect(resolveWriterCandidateCheckpoint(equivalent, remote)).toEqual({
      status: "EQUIVALENT",
      checkpoint: equivalent,
    });
    expect(resolveWriterCandidateCheckpoint(divergent, remote)).toEqual({
      status: "REMOTE_REBASE",
      checkpoint: remote,
      code: "CANONICAL_CHECKPOINT_CONFLICT",
    });
  });

  test("CHK-G05/G06/G07/G08: remote rebase preserves evidence, lifecycle, patient and command lineage", () => {
    const remote = createRuntimeCheckpoint(state("PAUSED", "NARVA_ED", ["P01-MOVE-ED"]), 42);
    const divergent = createRuntimeCheckpoint(state("RUNNING", "NARVA_HOSPITAL_OUTDOOR", []), 42);
    const resolved = resolveWriterCandidateCheckpoint(divergent, remote);

    expect(resolved.status).toBe("REMOTE_REBASE");
    if (resolved.status !== "REMOTE_REBASE") throw new Error("REMOTE_REBASE_EXPECTED");
    expect(resolved.checkpoint.payload.timelineEvents).toHaveLength(1);
    expect((resolved.checkpoint.payload.exerciseSession as { lifecycleState: string }).lifecycleState).toBe("PAUSED");
    expect(resolved.checkpoint.payload.patients[0]).toMatchObject({ location: "NARVA_ED" });
    expect(resolved.checkpoint.payload.runtimePatientCommandCursor).toBe(1);
  });

  test("case matrix preserves older/newer behavior and rejects unrelated conflicts", () => {
    const remote = createRuntimeCheckpoint(state("PAUSED", "NARVA_ED", ["P01-MOVE-ED"]), 42);
    const older = createRuntimeCheckpoint(state("RUNNING", "NARVA_HOSPITAL_OUTDOOR", []), 41);
    const newer = createRuntimeCheckpoint(state("RUNNING", "NARVA_HOSPITAL_OUTDOOR", []), 43);

    expect(resolveWriterCandidateCheckpoint(older, remote)).toEqual({ status: "REMOTE", checkpoint: remote });
    expect(resolveWriterCandidateCheckpoint(newer, remote)).toEqual({ status: "LOCAL", checkpoint: newer });
    expect(resolveWriterCandidateCheckpoint(undefined, undefined)).toEqual({ status: "NONE" });
  });

  test("CHK-G03/G09: divergent state is adopted before lease eligibility and failed rebase stays closed", async () => {
    const remote = createRuntimeCheckpoint(state("PAUSED", "NARVA_ED", ["P01-MOVE-ED"]), 42);
    const divergent = createRuntimeCheckpoint(state("RUNNING", "NARVA_HOSPITAL_OUTDOOR", []), 42);
    const resolution = resolveWriterCandidateCheckpoint(divergent, remote);
    let current = divergent;
    const accept = jest.fn(async checkpoint => { current = checkpoint; });

    await expect(prepareRuntimeWriterCandidateBeforeLease(resolution, accept, () => current))
      .resolves.toEqual({ state: "READY", checkpoint: remote, rebased: true });
    expect(accept).toHaveBeenCalledWith(remote);

    const failedAccept = jest.fn(async () => { throw new Error("RESTORE_FAILED"); });
    await expect(prepareRuntimeWriterCandidateBeforeLease(resolution, failedAccept, () => divergent))
      .resolves.toEqual({ state: "REJECTED", code: "CANONICAL_CHECKPOINT_CONFLICT" });
  });

  test("CHK-G10/G12: restart and stale-writer takeover paths reconcile before acquisition/publication", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"),
      source.indexOf("/** Explicit user recovery"));
    expect(takeover.indexOf("prepareRuntimeWriterCandidateBeforeLease")).toBeLessThan(
      takeover.indexOf("acquireRuntimeWriterTerminal"),
    );
    expect(takeover.indexOf("acceptAuthoritativeRuntimeCheckpointForReaderAsync")).toBeLessThan(
      takeover.indexOf("acquireRuntimeWriterTerminal"),
    );
    expect(takeover.indexOf("acquireRuntimeWriterTerminal")).toBeLessThan(
      takeover.indexOf("wakeCheckpointPublicationForCurrentWriter"),
    );
    const startup = source.slice(source.indexOf("async function startRuntimeCheckpointSyncForExercise"),
      source.indexOf("let publishInFlight=false"));
    expect(startup.indexOf("prepareRuntimeWriterCandidateBeforeLease")).toBeLessThan(
      startup.indexOf("acquireRuntimeWriterTerminal"),
    );
  });

  test("CHK-G11: repeated and concurrent preparation converges on one immutable canonical lineage", async () => {
    const remote = createRuntimeCheckpoint(state("PAUSED", "NARVA_ED", ["P01-MOVE-ED"]), 42);
    const divergent = createRuntimeCheckpoint(state("RUNNING", "NARVA_HOSPITAL_OUTDOOR", []), 42);
    const resolution = resolveWriterCandidateCheckpoint(divergent, remote);
    let current = divergent;
    const accept = jest.fn(async checkpoint => { current = checkpoint; });
    const results = await Promise.all([
      prepareRuntimeWriterCandidateBeforeLease(resolution, accept, () => current),
      prepareRuntimeWriterCandidateBeforeLease(resolution, accept, () => current),
    ]);
    expect(results).toEqual([
      { state: "READY", checkpoint: remote, rebased: true },
      { state: "READY", checkpoint: remote, rebased: true },
    ]);
    expect(current).toBe(remote);
    expect(new Set(results.map(result => result.state === "READY" ? result.checkpoint.payloadHash : "REJECTED")).size).toBe(1);
  });
});
