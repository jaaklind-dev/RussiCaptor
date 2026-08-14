import fs from "node:fs";
import path from "node:path";
import {
  acquireRuntimeWriterTerminal,
  checkpointForExercise,
  isWriterCheckpointEcho,
  publicationResultRevokesWriter,
  renewRuntimeWriterTerminal,
  resolveRuntimeAuthSession,
  shouldResetRuntimeCheckpointSyncForPrincipal,
  shouldRestartRuntimeCheckpointSync,
} from "@/services/RuntimeCheckpointSyncService";
import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import { isRemoteRuntimeLifecycleActive } from "@/services/CloudSyncService";

describe("WP-44B checkpoint startup coordination", () => {
  const writerLease = Object.freeze({
    leaseId: "LEASE-A",
    exerciseId: "EX-1",
    writerInstanceId: "WRITER-A",
    userId: "USER-A",
    expiresAt: "2099-08-14T12:00:00.000Z",
  });

  test("transient renewal failure preserves the exact active canonical lease", async () => {
    const refreshedLease = Object.freeze({ ...writerLease, expiresAt: "2099-08-14T12:01:00.000Z" });
    const repository = {
      renewWriter: jest.fn(async () => ({
        status: "AUTHORITY_UNAVAILABLE",
        code: "WRITER_AUTHORITY_UNAVAILABLE",
      })),
      loadWriterLease: jest.fn(async () => refreshedLease),
    };

    await expect(renewRuntimeWriterTerminal(repository as never, writerLease, 60))
      .resolves.toMatchObject({ status: "ALREADY_OWNED", lease: refreshedLease });
    expect(repository.renewWriter).toHaveBeenCalledTimes(1);
    expect(repository.loadWriterLease).toHaveBeenCalledWith("EX-1");
  });

  test("transient renewal failure never adopts a replacement lease or writer", async () => {
    const repository = {
      renewWriter: jest.fn(async () => ({
        status: "AUTHORITY_UNAVAILABLE",
        code: "WRITER_AUTHORITY_UNAVAILABLE",
      })),
      loadWriterLease: jest.fn(async () => ({ ...writerLease, leaseId: "LEASE-B" })),
    };

    await expect(renewRuntimeWriterTerminal(repository as never, writerLease, 60))
      .resolves.toEqual({ status: "AUTHORITY_UNAVAILABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" });
  });

  test("true stale-writer renewal demotes without reconciliation", async () => {
    const stale = { status: "AUTHORITY_UNAVAILABLE", code: "STALE_WRITER" };
    const repository = {
      renewWriter: jest.fn(async () => stale),
      loadWriterLease: jest.fn(),
    };

    await expect(renewRuntimeWriterTerminal(repository as never, writerLease, 60)).resolves.toBe(stale);
    expect(repository.loadWriterLease).not.toHaveBeenCalled();
  });

  test("renewal lifecycle remains service-owned and has exactly one loop", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const lifecycle = source.slice(
      source.indexOf("async function startRuntimeCheckpointSyncForExercise"),
      source.indexOf("async function startRuntimeCheckpointSyncOnce"),
    );
    expect(lifecycle.match(/renewal=setInterval/g)).toHaveLength(1);
    expect(lifecycle).toContain("renewRuntimeWriterTerminal(repository,renewingLease,LEASE_SECONDS)");
    expect(lifecycle).toContain("clearInterval(renewal)");
  });

  test("lost same-writer acquisition response reconciles from the authoritative lease", async () => {
    const lease = {
      leaseId: "LEASE-A",
      exerciseId: "EX-1",
      writerInstanceId: "WRITER-A",
      userId: "USER-A",
      expiresAt: "2026-08-14T12:00:00.000Z",
    };
    const repository = {
      acquireWriter: jest.fn(() => new Promise(() => undefined)),
      loadWriterLease: jest.fn(async () => lease),
    };

    await expect(acquireRuntimeWriterTerminal(
      repository as never,
      "EX-1",
      "WRITER-A",
      717,
      60,
    )).resolves.toEqual({
      status: "ALREADY_OWNED",
      checkpointRevision: 717,
      lease,
    });
    expect(repository.acquireWriter).toHaveBeenCalledTimes(1);
    expect(repository.loadWriterLease).toHaveBeenCalledWith("EX-1");
  }, 18_000);

  test("successful writer acquisition is not repeated", async () => {
    const result = { status: "HELD_BY_OTHER_WRITER", code: "WRITER_AUTHORITY_HELD" };
    const repository = {
      acquireWriter: jest.fn(async () => result),
      loadWriterLease: jest.fn(),
    };

    await expect(acquireRuntimeWriterTerminal(repository as never, "EX-1", "WRITER-A", 717, 60))
      .resolves.toBe(result);
    expect(repository.acquireWriter).toHaveBeenCalledTimes(1);
    expect(repository.loadWriterLease).not.toHaveBeenCalled();
  });

  test("lost acquisition response never adopts another writer's lease", async () => {
    const repository = {
      acquireWriter: jest.fn(() => new Promise(() => undefined)),
      loadWriterLease: jest.fn(async () => ({
        leaseId: "LEASE-B",
        exerciseId: "EX-1",
        writerInstanceId: "WRITER-B",
        userId: "USER-B",
        expiresAt: "2026-08-14T12:00:00.000Z",
      })),
    };

    await expect(acquireRuntimeWriterTerminal(repository as never, "EX-1", "WRITER-A", 717, 60))
      .resolves.toEqual({ status: "HELD_BY_OTHER_WRITER", code: "WRITER_AUTHORITY_HELD" });
  }, 18_000);

  test("cold auth initialization serializes persisted-session recovery before proactive refresh", async () => {
    const order: string[] = [];
    const auth = {
      stopAutoRefresh: jest.fn(async () => { order.push("stop"); }),
      getSession: jest.fn(async () => {
        order.push("session");
        return { data: { session: { user: { id: "USER-A" } } }, error: null };
      }),
      startAutoRefresh: jest.fn(async () => { order.push("start"); }),
    };

    await expect(resolveRuntimeAuthSession(auth as never)).resolves.toEqual({
      data: { session: { user: { id: "USER-A" } } },
      error: null,
    });
    expect(order).toEqual(["stop", "session", "start"]);
  });

  test("cold auth failure remains terminal and restores proactive refresh", async () => {
    const auth = {
      stopAutoRefresh: jest.fn(async () => undefined),
      getSession: jest.fn(async () => { throw new Error("AUTH_FAILED"); }),
      startAutoRefresh: jest.fn(async () => undefined),
    };

    await expect(resolveRuntimeAuthSession(auth as never)).rejects.toThrow("AUTH_FAILED");
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  test("completed canonical exercise cannot be revived by an older running checkpoint", () => {
    expect(isRemoteRuntimeLifecycleActive("UNKNOWN")).toBeUndefined();
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"), source.indexOf("function setAndReturn"));
    const startup = source.slice(source.indexOf("async function startRuntimeCheckpointSyncForExercise"), source.indexOf("async function startRuntimeCheckpointSyncOnce"));
    expect(takeover).toContain("isRemoteRuntimeLifecycleActive(exerciseId) === false");
    expect(takeover).toContain('code:"EXERCISE_NOT_ACTIVE"');
    expect(startup).toContain("isRemoteRuntimeLifecycleActive(exerciseId) === false");
    expect(startup).toContain('code:"EXERCISE_NOT_ACTIVE"');
  });
  test("only proven authority loss revokes writer after publication", () => {
    expect(publicationResultRevokesWriter("PUBLISHED")).toBe(false);
    expect(publicationResultRevokesWriter("TRANSPORT_TIMEOUT")).toBe(false);
    expect(publicationResultRevokesWriter("BACKEND_ERROR")).toBe(false);
    expect(publicationResultRevokesWriter("AUTH_UNAVAILABLE")).toBe(false);
    expect(publicationResultRevokesWriter("STALE_WRITER")).toBe(true);
    expect(publicationResultRevokesWriter("REVISION_CONFLICT")).toBe(true);
  });

  test("writer realtime self-echo does not revoke its own authority", () => {
    const envelope = { exerciseId: "EX-1", payloadHash: "HASH" } as RuntimeCheckpointEnvelope<never>;
    const lease = { exerciseId: "EX-1", writerInstanceId: "WRITER-A" } as RuntimeWriterLease;
    expect(isWriterCheckpointEcho(envelope, envelope, lease)).toBe(true);
    expect(isWriterCheckpointEcho({ ...envelope, payloadHash: "OLDER" }, envelope, lease, "WRITER-A")).toBe(true);
    expect(isWriterCheckpointEcho({ ...envelope, payloadHash: "OTHER" }, envelope, lease, "WRITER-B")).toBe(false);
    expect(isWriterCheckpointEcho({ ...envelope, payloadHash: "OTHER" }, envelope, lease)).toBe(false);
    expect(isWriterCheckpointEcho(envelope, envelope, { ...lease, exerciseId: "EX-2" })).toBe(false);
  });

  test("same exercise entering a live lifecycle re-evaluates writer acquisition", () => {
    expect(shouldRestartRuntimeCheckpointSync(
      { exerciseId: "EX-1", activeLifecycle: false },
      { exerciseId: "EX-1", activeLifecycle: true },
    )).toBe(true);
    expect(shouldRestartRuntimeCheckpointSync(
      { exerciseId: "EX-1", activeLifecycle: true },
      { exerciseId: "EX-1", activeLifecycle: true },
    )).toBe(false);
  });

  test("writer acquisition after process recreation restores canonical Runtime owners", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const startup = source.slice(source.indexOf("async function startRuntimeCheckpointSyncForExercise"), source.indexOf("let publishInFlight=false"));
    const acquisition = startup.indexOf('if ("lease" in acquired)');
    const lease = startup.indexOf("lease=acquired.lease", acquisition);
    const authority = startup.indexOf('setRuntimeWriterAuthorityState("WRITER")', acquisition);
    const writer = startup.indexOf('setStatus({state:"WRITER"', authority);
    const restore = startup.indexOf("acceptAuthoritativeRuntimeCheckpoint(resolved.checkpoint, true)", acquisition);
    expect(acquisition).toBeGreaterThan(-1);
    expect(lease).toBeGreaterThan(acquisition);
    expect(authority).toBeGreaterThan(lease);
    expect(writer).toBeGreaterThan(authority);
    expect(restore).toBeGreaterThan(writer);
    expect(source.match(/renewal=setInterval/g)).toHaveLength(1);
  });

  test("acquired authority protects restored Runtime owners from a concurrent cloud echo", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"), source.indexOf("function setAndReturn"));
    const lease = takeover.indexOf("lease=acquired.lease");
    const authority = takeover.indexOf('setRuntimeWriterAuthorityState("WRITER")');
    const writer = takeover.indexOf('setStatus({state:"WRITER"');
    const restore = takeover.indexOf("acceptAuthoritativeRuntimeCheckpoint(resolved.checkpoint, true)");
    expect(lease).toBeGreaterThan(-1);
    expect(authority).toBeGreaterThan(lease);
    expect(authority).toBeGreaterThan(-1);
    expect(writer).toBeGreaterThan(authority);
    expect(restore).toBeGreaterThan(writer);
  });

  test("checkpoint authority resolves current auth before cloud projection startup", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    const cloudStart = layout.indexOf("startCloudSync().then");
    const runtimeStart = layout.indexOf("startRuntimeCheckpointSync().then");
    expect(cloudStart).toBeGreaterThan(-1);
    expect(runtimeStart).toBeGreaterThan(-1);
    expect(runtimeStart).toBeLessThan(cloudStart);
    expect(layout.match(/startRuntimeCheckpointSync\(\)/g)).toHaveLength(1);
  });

  test("cloud restart tears down stale subscriptions before creating a channel", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    const start = source.indexOf("export async function startCloudSync");
    const remove = source.indexOf("await supabase.removeChannel(channel)", start);
    const create = source.indexOf("supabase\n    .channel", start);
    expect(remove).toBeGreaterThan(start);
    expect(create).toBeGreaterThan(remove);
  });

  test("logout and user change reset writer/checkpoint ownership, same principal does not", () => {
    expect(shouldResetRuntimeCheckpointSyncForPrincipal("USER-A", undefined)).toBe(true);
    expect(shouldResetRuntimeCheckpointSyncForPrincipal("USER-A", "USER-B")).toBe(true);
    expect(shouldResetRuntimeCheckpointSyncForPrincipal("USER-A", "USER-A")).toBe(false);
  });

  test("checkpoint from another exercise cannot participate in remote authority startup", () => {
    const stale = { exerciseId: "EX-OLD" } as never;
    expect(checkpointForExercise(stale, "EX-NEW")).toBeUndefined();
    expect(checkpointForExercise(stale, "EX-OLD")).toBe(stale);
    const statePersistence = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const ensure = statePersistence.slice(
      statePersistence.indexOf("export function ensureLocalRuntimeCheckpoint"),
      statePersistence.indexOf("export function acceptAuthoritativeRuntimeCheckpoint"),
    );
    expect(ensure).toContain("current?.exerciseId === exerciseId");
    expect(ensure).toContain("localRuntimeCheckpointStore.capture(collectSharedExerciseState())");
  });

  test("remote exercise discovery disposes unresolved live Runtime, including same-exercise stale state", () => {
    const statePersistence = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const restore = statePersistence.indexOf("export function restoreRemoteExerciseIdentity");
    const authorityCheck = statePersistence.indexOf('getRuntimeWriterAuthorityState() !== "WRITER"', restore);
    const clear = statePersistence.indexOf("clearActiveClinicalReferenceRuntime();", authorityCheck);
    const restoreIdentity = statePersistence.indexOf("restoreExerciseIdentity(restored);", clear);
    expect(authorityCheck).toBeGreaterThan(restore);
    expect(clear).toBeGreaterThan(authorityCheck);
    expect(restoreIdentity).toBeGreaterThan(clear);
  });

  test("checkpoint publication is serialized and coalesces overlapping local ticks", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const publish = source.slice(source.indexOf("let publishInFlight=false"), source.indexOf("const stopLocal="));
    expect(publish).toContain("const runPublish=async()=>{");
    expect(publish).toContain("if(publishInFlight){publishQueued=true;return;}");
    expect(publish).toContain("do {");
    expect(publish).toContain("while(publishQueued)");
    expect(publish).toContain("Promise.race([publishRuntimeCheckpointTerminal");
    expect(publish).toContain("echoAcknowledgement");
    expect(publish).toContain("publicationBarrier=task.then(()=>undefined,()=>undefined)");
  });

  test("a replacement sync generation waits for the prior publication terminal state", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const startup = source.slice(source.indexOf("async function startRuntimeCheckpointSyncForExercise"), source.indexOf("let local:", source.indexOf("async function startRuntimeCheckpointSyncForExercise")));
    expect(startup).toContain("await publicationBarrier;");
    expect(startup.indexOf("await publicationBarrier;")).toBeLessThan(startup.indexOf("repository.loadLatest(exerciseId)"));
  });

  test("only the latest exercise sync generation may publish, renew or apply Realtime", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const generation = source.indexOf("const generation = ++exerciseSyncGeneration;");
    const fence = source.indexOf("const generationStopped = () => stopped || generation !== exerciseSyncGeneration;", generation);
    const publishFence = source.indexOf("if(generationStopped())return;", source.indexOf("const publish=()=>", fence));
    const renewalFence = source.indexOf("if(generationStopped())return;", source.indexOf("renewal=setInterval", publishFence));
    const realtimeFence = source.indexOf("if(generationStopped())return;", source.indexOf("const channel:", renewalFence));
    const guardedRelease = source.indexOf("if(generation===exerciseSyncGeneration&&lease)", realtimeFence);
    expect(generation).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(generation);
    expect(publishFence).toBeGreaterThan(fence);
    expect(renewalFence).toBeGreaterThan(publishFence);
    expect(realtimeFence).toBeGreaterThan(renewalFence);
    expect(guardedRelease).toBeGreaterThan(realtimeFence);
  });

  test("a stopped sync generation ignores late publication, renewal and realtime outcomes", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain("let stopped=false;");
    expect(source).toContain("if(stopped)return;");
    expect(source).toContain("return()=>{stopped=true;stopLocal();stopPrepared();if(renewal)clearInterval(renewal)");
  });

  test("explicit Resume attaches the acquired writer to the canonical renewal lifecycle", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"), source.indexOf("function setAndReturn"));
    const installLease = takeover.indexOf("lease=acquired.lease");
    const writer = takeover.indexOf('setStatus({state:"WRITER"');
    const ensure = takeover.indexOf("ensureLeaseRenewalForCurrentWriter?.()", writer);
    expect(installLease).toBeGreaterThan(-1);
    expect(writer).toBeGreaterThan(installLease);
    expect(ensure).toBeGreaterThan(writer);
  });

  test("renewal attachment is idempotent and stale generation cleanup cannot clear its replacement", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain('if(generationStopped() || renewal || !lease || status.state!=="WRITER")return;');
    expect(source.match(/renewal=setInterval/g)).toHaveLength(1);
    expect(source).toContain("if(ensureLeaseRenewalForCurrentWriter===ensureRenewal)ensureLeaseRenewalForCurrentWriter=undefined");
  });

  test("cold-start authority awaits terminate with a typed timeout instead of permanent CONNECTING", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain('new Error("AUTHORITY_STARTUP_TIMEOUT")');
    expect(source).toContain("resolveRuntimeAuthSession(supabase.auth)");
    expect(source).toContain("startupAwait(auth.getSession())");
    expect(source).toContain("startupAwait(getRuntimeWriterInstanceId())");
    expect(source).toContain("startupAwait(repository.loadLatest(exerciseId))");
    expect(source).toContain("acquireRuntimeWriterTerminal(repository,exerciseId,writerId,remoteRevision,LEASE_SECONDS)");
    expect(source).toContain('setStatus({state:"FAILED",code:error instanceof Error ? error.message');
  });
});
