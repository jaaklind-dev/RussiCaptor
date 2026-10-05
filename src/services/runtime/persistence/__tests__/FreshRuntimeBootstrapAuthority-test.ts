import fs from "node:fs";
import path from "node:path";
import {
  acquireRuntimeWriterTerminal,
  shouldRetryFreshRuntimeBootstrap,
  type RuntimeBootstrapRetrySignal,
} from "@/services/RuntimeCheckpointSyncService";
import { shouldPreserveFreshRuntimeBootstrapSeed } from "@/services/StatePersistenceService";

const signal = (overrides: Partial<RuntimeBootstrapRetrySignal> = {}): RuntimeBootstrapRetrySignal => ({
  exerciseId: "EX-FRESH",
  activeLifecycle: true,
  scopedAuthorityReady: false,
  packageBindingVersion: 7,
  cloudConnected: false,
  foregroundEpoch: 0,
  ...overrides,
});

describe("FRESH-RUNTIME-BOOTSTRAP-AUTHORITY-01", () => {
  test("BOOT-G01/G09 concurrent eligible clients still elect exactly one writer", async () => {
    let owner: string | undefined;
    let maxWriters = 0;
    const repository = {
      acquireWriter: async (exerciseId: string, writerInstanceId: string) => {
        if (!owner) {
          owner = writerInstanceId;
          maxWriters = Math.max(maxWriters, 1);
          return { status: "ACQUIRED" as const, checkpointRevision: 0, lease: {
            leaseId: "LEASE-1", exerciseId, writerInstanceId, userId: `USER-${writerInstanceId}`,
            expiresAt: "2099-01-01T00:00:00.000Z",
          } };
        }
        return { status: "HELD_BY_OTHER_WRITER" as const, code: "WRITER_AUTHORITY_HELD" as const };
      },
      loadWriterLease: async () => undefined,
      releaseWriter: jest.fn(async () => undefined),
    };

    const results = await Promise.all([
      acquireRuntimeWriterTerminal(repository, "EX-FRESH", "A", 0, 60),
      acquireRuntimeWriterTerminal(repository, "EX-FRESH", "B", 0, 60),
    ]);
    expect(results.filter(result => "lease" in result)).toHaveLength(1);
    expect(maxWriters).toBe(1);
  });

  test("BOOT-G02/G03/G07 discovery identity cannot erase an exact prepared bootstrap seed", () => {
    const exact = {
      authority: "UNRESOLVED" as const,
      localExerciseId: "EX-FRESH",
      remoteExerciseId: "EX-FRESH",
      localPackageId: "russicaptor.narva-trauma",
      localPackageVersion: "1.0.5",
      remotePackageId: "russicaptor.narva-trauma",
      remotePackageVersion: "1.0.5",
      patientMaterializationReady: true,
      runtimeReady: true,
    };
    expect(shouldPreserveFreshRuntimeBootstrapSeed(exact)).toBe(true);
    expect(shouldPreserveFreshRuntimeBootstrapSeed({ ...exact, runtimeReady: false })).toBe(false);
    expect(shouldPreserveFreshRuntimeBootstrapSeed({ ...exact, patientMaterializationReady: false })).toBe(false);
    expect(shouldPreserveFreshRuntimeBootstrapSeed({ ...exact, remotePackageVersion: "1.0.4" })).toBe(false);
    expect(shouldPreserveFreshRuntimeBootstrapSeed({ ...exact, remoteExerciseId: "EX-OTHER" })).toBe(false);
    expect(shouldPreserveFreshRuntimeBootstrapSeed({ ...exact, authority: "READER" })).toBe(false);
  });

  test("BOOT-G05/G06 role and package readiness changes retrigger once", () => {
    const initial = signal();
    const roleReady = signal({ scopedAuthorityReady: true });
    const packageReady = signal({ packageBindingVersion: 8 });
    expect(shouldRetryFreshRuntimeBootstrap(initial, roleReady, { state: "READER" })).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap(initial, packageReady, { state: "DISABLED" })).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap(initial, packageReady,
      { state: "READER", code: "AUTHORITATIVE_CHECKPOINT_PENDING" })).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap(initial, packageReady, { state: "READER", revision: 447 })).toBe(false);
    expect(shouldRetryFreshRuntimeBootstrap(roleReady, roleReady, { state: "READER" })).toBe(false);
  });

  test("BOOT-G07/G08/G10 reconnect, foreground and restart signals are bounded and idempotent", () => {
    const initial = signal();
    expect(shouldRetryFreshRuntimeBootstrap(initial, signal({ cloudConnected: true }), { state: "OFFLINE" })).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap(initial, signal({ foregroundEpoch: 1 }), { state: "FAILED" })).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap(initial, initial, { state: "READER" })).toBe(false);
    expect(shouldRetryFreshRuntimeBootstrap(initial, signal({ cloudConnected: true }), { state: "WRITER" })).toBe(false);
  });

  test("BOOT-G04/G11/G12 reader, stale-writer and terminal fences remain explicit", () => {
    expect(shouldRetryFreshRuntimeBootstrap(signal(), signal({ scopedAuthorityReady: true, activeLifecycle: false }), { state: "READER" })).toBe(false);
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain("publicationResultRevokesWriter");
    expect(source).toContain('state === "STALE_WRITER"');
    expect(source).toContain('setRuntimeReaderConvergenceUnavailable(exerciseId,"AUTHORITATIVE_CHECKPOINT_PENDING")');
    expect(source).toContain('if (!next.activeLifecycle || currentStatus.state === "WRITER") return false;');
  });

  test("bootstrap retry uses readiness events and does not add a polling loop", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const coordinator = source.slice(source.indexOf("async function startRuntimeCheckpointSyncOnce"));
    expect(coordinator).toContain("subscribeOperatorSession(queueBootstrapRetry)");
    expect(coordinator).toContain("subscribeToExercisePackageBindings(queueBootstrapRetry)");
    expect(coordinator).toContain("subscribeToCloudSyncStatus(()=>queueBootstrapRetry())");
    expect(coordinator).toContain('AppState.addEventListener("change"');
    expect(coordinator).not.toContain("setInterval");
  });
});
