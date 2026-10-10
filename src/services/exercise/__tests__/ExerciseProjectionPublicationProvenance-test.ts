import fs from "node:fs";
import path from "node:path";

import { captureProjectionPublicationStamp, projectionPublicationRejectionReason,
  sendCurrentProjectionPublication, type ProjectionPublicationContext } from "../ExerciseProjectionPublicationGuard";
import { createProjectionPublicationIntent, recordProjectionPublicationDiagnostic } from "../ExerciseProjectionPublicationDiagnostics";
import { getRuntimeWriterPublicationGeneration, getRuntimeWriterPublicationLeaseId,
  setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";

const cloudSource = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");

function context(overrides: Partial<ProjectionPublicationContext> = {}): ProjectionPublicationContext {
  return {
    exerciseId: "EX-1", lifecycleState: "RUNNING", selectedMode: "EXCON", writerAuthority: "WRITER",
    reader: { exerciseId: "EX-1", phase: "WRITER" }, readerGeneration: 7, runtimeGeneration: 9,
    writerGeneration: 5, writerLeaseId: "lease-A", authGeneration: 3, cloudGeneration: 2,
    syncVersion: 11, mutationGeneration: 1, publishedMutationGeneration: 0, ...overrides,
  };
}

describe("secret-free exercise-state publication provenance", () => {
  const log = jest.spyOn(console, "info").mockImplementation(() => {});
  afterAll(() => log.mockRestore());

  test("EXSTATE-PROV-01/02/03/04 intent records actual origin, exercise and generations", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    const intent = createProjectionPublicationIntent(stamp, "LOCAL_STATE_CHANGE", 1234);
    expect(intent).toMatchObject({ origin: "LOCAL_STATE_CHANGE", createdAtMs: 1234,
      stamp: { exerciseId: "EX-1", authGeneration: 3, cloudGeneration: 2, runtimeGeneration: 9,
        readerGeneration: 7, writerGeneration: 5, writerLeaseId: "lease-A", mutationGeneration: 1 } });
    expect(intent.intentId).toMatch(/^projection-1234-\d+$/);
    expect(cloudSource).toContain('recordLocalProjectionMutation("EXPLICIT_TERMINAL_RECONCILIATION")');
    expect(cloudSource).toContain('scheduleCloudSave("APPSTATE_RESUME")');
    expect(cloudSource).toContain('scheduleCloudSave("REALTIME_RECONNECT")');
  });

  test("EXSTATE-PROV-05 serialized diagnostics cannot carry a token or lease identifier", () => {
    const intent = createProjectionPublicationIntent(captureProjectionPublicationStamp(context())!, "LOCAL_STATE_CHANGE");
    const serialized = JSON.stringify(recordProjectionPublicationDiagnostic(intent, "REJECTED", {
      reason: "STALE_WRITER_GENERATION", sendAttempt: 1,
    }));
    expect(serialized).toContain('"reason":"STALE_WRITER_GENERATION"');
    expect(serialized).not.toContain("lease-A");
    expect(serialized).not.toMatch(/access_token|refresh_token|authorization|password|service_role/i);
    expect(Object.keys(JSON.parse(serialized))).toEqual(expect.arrayContaining(["intentId", "origin", "createdAtMs", "sendAttempt"]));
  });
});

describe("writer handoff at the final network send boundary", () => {
  test("EXSTATE-HANDOFF-01 old A intent is rejected when B takes over", () => {
    const stampA = captureProjectionPublicationStamp(context())!;
    const send = jest.fn();
    const result = sendCurrentProjectionPublication(stampA,
      context({ writerGeneration: 6, writerLeaseId: "lease-B" }), send);
    expect(result).toEqual({ outcome: "REJECTED", reason: "STALE_WRITER_GENERATION" });
    expect(send).not.toHaveBeenCalled();
  });

  test("EXSTATE-HANDOFF-02 takeover during async preparation emits no POST", async () => {
    const stampA = captureProjectionPublicationStamp(context())!;
    let current = context();
    let resume!: () => void;
    const preparation = new Promise<void>(resolve => { resume = resolve; });
    const post = jest.fn(() => Promise.resolve({ status: 200 }));
    const flush = (async () => {
      await preparation;
      return sendCurrentProjectionPublication(stampA, current, post);
    })();
    current = context({ writerGeneration: 6, writerLeaseId: "lease-B" });
    resume();
    expect(await flush).toEqual({ outcome: "REJECTED", reason: "STALE_WRITER_GENERATION" });
    expect(post).not.toHaveBeenCalled();
    expect(cloudSource.indexOf("sendCurrentProjectionPublication(publicationStamp")).toBeLessThan(
      cloudSource.indexOf('.upsert(projectionRow, { onConflict: "exercise_id" })'));
  });

  test("EXSTATE-HANDOFF-03/04 B can publish but A cannot overwrite B", () => {
    const stampA = captureProjectionPublicationStamp(context())!;
    const b = context({ writerGeneration: 6, writerLeaseId: "lease-B", mutationGeneration: 2 });
    const stampB = captureProjectionPublicationStamp(b)!;
    const post = jest.fn(() => "POST");
    expect(sendCurrentProjectionPublication(stampA, b, post).outcome).toBe("REJECTED");
    expect(sendCurrentProjectionPublication(stampB, b, post)).toEqual({ outcome: "SENT", result: "POST" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("EXSTATE-HANDOFF-05 same current writer still publishes", () => {
    const current = context();
    expect(sendCurrentProjectionPublication(captureProjectionPublicationStamp(current)!, current, () => 200))
      .toEqual({ outcome: "SENT", result: 200 });
  });

  test("EXSTATE-HANDOFF-06 signout invalidates queued intent", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationRejectionReason(stamp, context({ authGeneration: 4, writerAuthority: "READER" })))
      .toBe("STALE_AUTH_GENERATION");
  });

  test("runtime generation change invalidates an old intent independently of the lease", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationRejectionReason(stamp, context({ runtimeGeneration: 10 })))
      .toBe("STALE_RUNTIME_GENERATION");
  });

  test("EXSTATE-HANDOFF-07 mode switch invalidates writer-bound intent", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationRejectionReason(stamp, context({ selectedMode: "CM" }))).toBe("WRITER_NOT_READY");
  });

  test("EXSTATE-HANDOFF-08 canonical rebase invalidates queued intent", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationRejectionReason(stamp, context({ syncVersion: 12 }))).toBe("CANONICAL_REBASE_INVALIDATED");
  });

  test("EXSTATE-HANDOFF-09 finalization invalidates old RUNNING projection", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationRejectionReason(stamp, context({ lifecycleState: "COMPLETED" })))
      .toBe("CANONICAL_REBASE_INVALIDATED");
    expect(cloudSource).toContain("shouldSuppressCloudProjectionWrite(exerciseId)");
  });

  test("EXSTATE-HANDOFF-10 read-only mount does not create an intent", () => {
    expect(captureProjectionPublicationStamp(context({ mutationGeneration: 0 }))).toBeUndefined();
    expect(cloudSource).toContain('if (source === "local") {');
    expect(cloudSource).not.toMatch(/workbench.*recordLocalProjectionMutation/i);
  });

  test("same WRITER status with a new lease advances generation; renewal does not", () => {
    setRuntimeWriterAuthorityState("WRITER", "lease-A");
    const a = getRuntimeWriterPublicationGeneration();
    expect(getRuntimeWriterPublicationLeaseId()).toBe("lease-A");
    setRuntimeWriterAuthorityState("WRITER", "lease-A");
    expect(getRuntimeWriterPublicationGeneration()).toBe(a);
    setRuntimeWriterAuthorityState("WRITER", "lease-B");
    expect(getRuntimeWriterPublicationGeneration()).toBe(a + 1);
    setRuntimeWriterAuthorityState("READER");
    expect(getRuntimeWriterPublicationLeaseId()).toBeUndefined();
  });
});
