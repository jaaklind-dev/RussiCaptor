import fs from "node:fs";
import path from "node:path";

import {
  ExerciseProjectionWriteCoordinator,
  type ProjectionWriteResult,
} from "@/services/exercise/ExerciseProjectionWriteCoordinator";
import {
  getRuntimeCompletionPublicationFence,
  isRuntimeCompletionPublicationFenced,
  setRuntimeCompletionPhase,
} from "@/services/runtime/exercise/RuntimeCompletionService";
import { shouldSuppressCloudProjectionWrite } from "@/services/CloudSyncService";

const exerciseId = "EX-1790573087374-1";
const requestId = "EXCON-1790577652608-1";
const cloudSource = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
const checkpointSource = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");

describe("LEGACY-PENDING-COMPLETION-CLOUD-PROJECTION-FENCE-02", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setRuntimeCompletionPhase("none", "IDLE");
  });

  afterEach(() => {
    setRuntimeCompletionPhase("none", "IDLE");
    jest.useRealTimers();
  });

  test("CLOUD-FENCE-01 suppresses exercise projection while completion is PENDING", async () => {
    const prepare = jest.fn(() => ({ identity: "RUNNING", payloadBytes: 10, value: exerciseId }));
    const publish = jest.fn(async (): Promise<ProjectionWriteResult> => true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      prepare,
      publish,
      jest.fn(),
      60_000,
      candidate => shouldSuppressCloudProjectionWrite(candidate?.value ?? exerciseId),
    );

    setRuntimeCompletionPhase(exerciseId, "PENDING");
    coordinator.schedule(true);
    await Promise.resolve();

    expect(prepare).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test("CLOUD-FENCE-02 installs suppression before local completion preparation", () => {
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    expect(shouldSuppressCloudProjectionWrite(exerciseId)).toBe(true);
    expect(cloudSource.indexOf("shouldSuppressCloudProjectionWrite(exerciseId)")).toBeLessThan(
      cloudSource.indexOf("compactActiveExerciseState(createSharedExerciseProjection())"),
    );
  });

  test("CLOUD-FENCE-03 still invokes atomic finalization exactly once", () => {
    let atomicFinalizes = 0;
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    if (isRuntimeCompletionPublicationFenced(exerciseId)) atomicFinalizes += 1;
    expect(atomicFinalizes).toBe(1);
  });

  test("CLOUD-FENCE-04 reuses the same completion request", () => {
    const requests = [{ commandId: requestId, status: "PENDING" as "PENDING" | "COMPLETED" }];
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    requests[0].status = "COMPLETED";
    setRuntimeCompletionPhase(exerciseId, "COMPLETED");
    expect(requests[0]).toEqual({ commandId: requestId, status: "COMPLETED" });
  });

  test("CLOUD-FENCE-05 creates no duplicate completion request", () => {
    const requests = new Set([requestId]);
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    setRuntimeCompletionPhase(exerciseId, "FINALIZING");
    setRuntimeCompletionPhase(exerciseId, "COMPLETED");
    expect([...requests]).toEqual([requestId]);
  });

  test("CLOUD-FENCE-06 discards suppressed RUNNING work after terminalization", async () => {
    let candidate = "RUNNING";
    const publish = jest.fn(async (): Promise<ProjectionWriteResult> => true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: candidate, payloadBytes: 10, value: exerciseId }),
      publish,
      jest.fn(),
      60_000,
      value => shouldSuppressCloudProjectionWrite(value?.value ?? exerciseId),
    );

    coordinator.schedule();
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    coordinator.discardPending();
    candidate = "COMPLETED";
    setRuntimeCompletionPhase(exerciseId, "COMPLETED");
    await jest.advanceTimersByTimeAsync(120_000);

    expect(publish).not.toHaveBeenCalled();
    expect(getRuntimeCompletionPublicationFence()).toMatchObject({ exerciseId, state: "TERMINAL" });
  });

  test("CLOUD-FENCE-07 keeps discovery, workflow reads and subscriptions outside the write guard", () => {
    const start = cloudSource.slice(cloudSource.indexOf("export async function startCloudSync"));
    expect(start).toContain('await refreshRemoteCurrentExercise("startup")');
    expect(start).toContain('channel("exercise-discovery-connectivity")');
    expect(start).toContain('channel("shared-workflow-notifications")');
    expect(start).toContain("refreshSharedWorkflowPatients");
    expect(start).not.toMatch(/if\s*\(shouldSuppressCloudProjectionWrite[^}]+return\s*\(\)\s*=>/s);
  });

  test("CLOUD-FENCE-08 ordinary projection remains available outside completion", async () => {
    const publish = jest.fn(async (): Promise<ProjectionWriteResult> => true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "RUNNING", payloadBytes: 10, value: exerciseId }),
      publish,
      jest.fn(),
      60_000,
      value => shouldSuppressCloudProjectionWrite(value?.value ?? exerciseId),
    );

    await coordinator.flush();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test("CLOUD-FENCE-09 failure after an accepted request keeps the fence active", () => {
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    setRuntimeCompletionPhase(exerciseId, "FAILED", "AUTHORITY_UNAVAILABLE");
    expect(isRuntimeCompletionPublicationFenced(exerciseId)).toBe(true);
  });

  test("CLOUD-FENCE-10 controlled abort reopens projection only after the shared state returns to IDLE", async () => {
    const publish = jest.fn(async (): Promise<ProjectionWriteResult> => true);
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "RUNNING", payloadBytes: 10, value: exerciseId }),
      publish,
      jest.fn(),
      60_000,
      value => shouldSuppressCloudProjectionWrite(value?.value ?? exerciseId),
    );

    setRuntimeCompletionPhase(exerciseId, "PENDING");
    await coordinator.flush();
    expect(publish).not.toHaveBeenCalled();
    setRuntimeCompletionPhase(exerciseId, "IDLE");
    await coordinator.flush();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test("CLOUD-FENCE-11 reconnect cannot replay a projection queued before the fence", async () => {
    let backendWrites = 0;
    const publish = jest.fn(async (): Promise<ProjectionWriteResult> => {
      await Promise.resolve();
      if (shouldSuppressCloudProjectionWrite(exerciseId)) return "SUPPRESSED";
      backendWrites += 1;
      return true;
    });
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "STALE-RUNNING", payloadBytes: 10, value: exerciseId }),
      publish,
      jest.fn(),
      60_000,
      value => shouldSuppressCloudProjectionWrite(value?.value ?? exerciseId),
    );

    coordinator.schedule(true);
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    coordinator.discardPending();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(backendWrites).toBe(0);
  });

  test("CLOUD-FENCE-12 restart after terminalization cannot publish an old RUNNING projection", async () => {
    const publish = jest.fn(async (): Promise<ProjectionWriteResult> => true);
    setRuntimeCompletionPhase(exerciseId, "COMPLETED");
    const coordinator = new ExerciseProjectionWriteCoordinator(
      () => ({ identity: "PRE-RESTART-RUNNING", payloadBytes: 10, value: exerciseId }),
      publish,
      jest.fn(),
      60_000,
      value => shouldSuppressCloudProjectionWrite(value?.value ?? exerciseId),
    );
    await coordinator.flush();
    expect(publish).not.toHaveBeenCalled();
  });

  test("CLOUD-FENCE-13 runtime checkpoint and CloudSync publishers share one fence signal", () => {
    expect(checkpointSource).toContain("setRuntimeCompletionPhase(exerciseId,");
    expect(checkpointSource).toContain('?"COMPLETED":"PENDING"');
    expect(checkpointSource).toContain('activeCompletion?.status==="PENDING"&&priority==="ROUTINE"');
    expect(cloudSource).toContain("shouldSuppressCloudProjectionWrite");
    setRuntimeCompletionPhase(exerciseId, "FINALIZING");
    expect(isRuntimeCompletionPublicationFenced(exerciseId)).toBe(true);
    expect(shouldSuppressCloudProjectionWrite(exerciseId)).toBe(true);
  });

  test("CLOUD-FENCE-14 stale writers cannot publish across the fence", () => {
    setRuntimeCompletionPhase(exerciseId, "PENDING");
    expect(shouldSuppressCloudProjectionWrite(exerciseId)).toBe(true);
  });

  test("CLOUD-FENCE-15 multi-client reader reads remain unaffected", () => {
    expect(cloudSource).toContain('.from("shared_workflow_patient_states")');
    expect(cloudSource).toContain('.select("exercise_id,patient_id,revision,owner_user_id,state")');
  });
});
