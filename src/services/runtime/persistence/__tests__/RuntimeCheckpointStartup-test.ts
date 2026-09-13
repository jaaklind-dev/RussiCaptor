import fs from "node:fs";
import path from "node:path";
import {
  acquireRuntimeWriterTerminal,
  checkpointForExercise,
  isWriterCheckpointEcho,
  publicationResultRevokesWriter,
  RuntimeCheckpointRecoveryCoordinator,
  renewalFailureRevokesWriter,
  renewRuntimeWriterTerminal,
  resolveRuntimeAuthSession,
  runtimeWriterAppStateAction,
  shouldResetRuntimeCheckpointSyncForPrincipal,
  shouldRestartRuntimeCheckpointSync,
  startRuntimeWriterRenewalLoop,
} from "@/services/RuntimeCheckpointSyncService";
import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import { isRemoteRuntimeLifecycleActive } from "@/services/CloudSyncService";
import { clearRuntimeLeaseTraceForValidation, getRuntimeLeaseLifecycleTrace } from "../RuntimeLeaseLifecycleTrace";

describe("WP-44B checkpoint startup coordination", () => {
  const writerLease: RuntimeWriterLease = Object.freeze({
    leaseId: "LEASE-A",
    exerciseId: "EX-1",
    writerInstanceId: "WRITER-A",
    userId: "USER-A",
    expiresAt: "2099-08-14T12:00:00.000Z",
  });

  const checkpoint = (exerciseId = "EX-1", checkpointRevision = 10, payloadHash = `HASH-${checkpointRevision}`) => ({
    exerciseId, checkpointRevision, payloadHash,
  }) as RuntimeCheckpointEnvelope<never>;
  const recovery = (remote: RuntimeCheckpointEnvelope<never> | undefined = checkpoint()) => {
    const repository = {
      loadLatest: jest.fn(async () => remote),
      loadLatestMetadata: jest.fn(async () => remote ? ({
        exerciseId: remote.exerciseId, checkpointRevision: remote.checkpointRevision,
        payloadHash: remote.payloadHash, provenanceHash: "PROVENANCE", writerInstanceId: "WRITER-A",
      }) : undefined),
      releaseWriter: jest.fn(async () => undefined),
    };
    const acquire = jest.fn(async () => ({ status:"ACQUIRED" as const, checkpointRevision:remote?.checkpointRevision ?? 0, lease:writerLease }));
    const adopt = jest.fn(async () => undefined);
    return { repository, acquire, adopt, request: { intentId:"INTENT-1", exerciseId:"EX-1", writerInstanceId:"WRITER-A",
      repository, acquire, adopt, validate:(value:RuntimeCheckpointEnvelope<never>|undefined):value is RuntimeCheckpointEnvelope<never>=>Boolean(value) } };
  };

  test("behavior: revision conflict recovery adopts the validated remote checkpoint and active writer lease", async () => {
    const fixture=recovery();
    await expect(new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never)).resolves.toMatchObject({
      state:"RECOVERED", checkpoint:{exerciseId:"EX-1",checkpointRevision:10,payloadHash:"HASH-10"}, lease:writerLease,
    });
    expect(fixture.acquire).toHaveBeenCalledWith(10);
    expect(fixture.adopt).toHaveBeenCalledWith(expect.objectContaining({checkpointRevision:10}),writerLease);
  });

  test("behavior: post-recovery canonical progression preserves lineage and advances revision", async () => {
    let local=checkpoint(); const fixture=recovery(local);
    fixture.adopt.mockImplementation((async (value: RuntimeCheckpointEnvelope<never>)=>{ local=value; }) as never);
    await new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never);
    const progressed=checkpoint("EX-1",local.checkpointRevision+1,"HASH-11"); local=progressed;
    expect(local).toMatchObject({exerciseId:"EX-1",checkpointRevision:11,payloadHash:"HASH-11"});
  });

  test("behavior: duplicate recovery intent is idempotent", async () => {
    const fixture=recovery(); const coordinator=new RuntimeCheckpointRecoveryCoordinator();
    const [first,second]=await Promise.all([coordinator.recover(fixture.request as never),coordinator.recover(fixture.request as never)]);
    expect(second).toBe(first); expect(fixture.repository.loadLatest).toHaveBeenCalledTimes(1);
    expect(fixture.repository.loadLatestMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.acquire).toHaveBeenCalledTimes(1); expect(fixture.adopt).toHaveBeenCalledTimes(1);
  });

  test("behavior: remote change during acquisition fails closed and releases the acquired lease", async () => {
    const fixture=recovery(); fixture.repository.loadLatest.mockResolvedValueOnce(checkpoint("EX-1",10,"HASH-10"));
    fixture.repository.loadLatestMetadata.mockResolvedValueOnce({exerciseId:"EX-1",checkpointRevision:11,payloadHash:"HASH-11",provenanceHash:"P",writerInstanceId:"WRITER-B"});
    await expect(new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never)).resolves.toEqual({
      state:"REJECTED",code:"CHECKPOINT_REVISION_CONFLICT",revision:11,
    });
    expect(fixture.repository.releaseWriter).toHaveBeenCalledWith(writerLease); expect(fixture.adopt).not.toHaveBeenCalled();
  });

  test("behavior: matching post-acquisition metadata adopts the original validated payload without a second full read", async () => {
    const fixture=recovery();
    await expect(new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never)).resolves.toMatchObject({state:"RECOVERED"});
    expect(fixture.repository.loadLatest).toHaveBeenCalledTimes(1);
    expect(fixture.repository.loadLatestMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.adopt).toHaveBeenCalledWith(expect.objectContaining({payloadHash:"HASH-10"}),writerLease);
  });

  test("behavior: active competing writer is never adopted or released", async () => {
    const fixture=recovery(); fixture.acquire.mockResolvedValue({status:"HELD_BY_OTHER_WRITER",code:"WRITER_AUTHORITY_HELD"} as never);
    await expect(new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never)).resolves.toEqual({
      state:"REJECTED",code:"WRITER_AUTHORITY_HELD",revision:undefined,
    });
    expect(fixture.adopt).not.toHaveBeenCalled(); expect(fixture.repository.releaseWriter).not.toHaveBeenCalled();
  });

  test("behavior: checkpoint from another exercise is rejected before acquisition", async () => {
    const fixture=recovery(checkpoint("EX-2"));
    await expect(new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never)).resolves.toEqual({state:"REJECTED",code:"REMOTE_SYNC_CONFLICT"});
    expect(fixture.acquire).not.toHaveBeenCalled(); expect(fixture.adopt).not.toHaveBeenCalled();
  });

  test("behavior: invalid remote checkpoint is rejected without authority or partial adoption", async () => {
    const fixture=recovery(); fixture.request.validate=(() => false) as never;
    await expect(new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never)).resolves.toEqual({state:"REJECTED",code:"CHECKPOINT_HASH_INVALID"});
    expect(fixture.acquire).not.toHaveBeenCalled(); expect(fixture.adopt).not.toHaveBeenCalled();
  });

  test("behavior: failed adoption releases authority and preserves a non-recovered result", async () => {
    const fixture=recovery(); fixture.adopt.mockRejectedValue(new Error("RUNTIME_CHECKPOINT_CLOCK_MISMATCH"));
    await expect(new RuntimeCheckpointRecoveryCoordinator().recover(fixture.request as never)).resolves.toEqual({state:"REJECTED",code:"CHECKPOINT_HASH_INVALID"});
    expect(fixture.repository.releaseWriter).toHaveBeenCalledWith(writerLease);
  });

  test("behavior: restart after recovery continues the same exercise lineage", async () => {
    let remote=checkpoint(); const repository={loadLatest:jest.fn(async()=>remote),loadLatestMetadata:jest.fn(async()=>({exerciseId:remote.exerciseId,checkpointRevision:remote.checkpointRevision,payloadHash:remote.payloadHash,provenanceHash:"P",writerInstanceId:"WRITER-A"})),releaseWriter:jest.fn(async()=>undefined)};
    const run=async(intentId:string)=>new RuntimeCheckpointRecoveryCoordinator().recover({intentId,exerciseId:"EX-1",writerInstanceId:"WRITER-A",repository,
      acquire:async (revision: number)=>({status:"ALREADY_OWNED",checkpointRevision:revision,lease:writerLease}),validate:(value: RuntimeCheckpointEnvelope<never> | undefined):value is RuntimeCheckpointEnvelope<never>=>Boolean(value),adopt:async()=>undefined} as never);
    await expect(run("BEFORE-RESTART")).resolves.toMatchObject({state:"RECOVERED",checkpoint:{checkpointRevision:10}});
    remote=checkpoint("EX-1",11,"HASH-11");
    await expect(run("AFTER-RESTART")).resolves.toMatchObject({state:"RECOVERED",checkpoint:{exerciseId:"EX-1",checkpointRevision:11}});
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
    expect(lifecycle.match(/startRuntimeWriterRenewalLoop\(/g)).toHaveLength(1);
    expect(lifecycle).toContain("renewRuntimeWriterTerminal(repository,currentLease,LEASE_SECONDS)");
    expect(lifecycle).toContain('renewalLoop?.stop("GENERATION_CLEANUP")');
    expect(source).toContain("interval = setInterval(() => {");
    expect(source).toContain("renewalDueInMs -= heartbeatMs");
  });

  test("takeover and recovery confirm a lease and start the service-owned renewal loop before stable WRITER", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"), source.indexOf("/** Explicit user recovery"));
    const recovery = source.slice(source.indexOf("async function reacquireRuntimeFromRemoteCheckpointForIntent"), source.indexOf("function setAndReturn"));
    expect(takeover.indexOf("confirmAcquiredRuntimeWriter")).toBeLessThan(takeover.indexOf('setStatus({state:"WRITER"'));
    expect(recovery.indexOf("confirmAcquiredRuntimeWriter")).toBeLessThan(recovery.indexOf('setStatus({state:"WRITER"'));
    expect(takeover).toContain("WRITER_RENEWAL_NOT_READY");
    expect(recovery).toContain("WRITER_RENEWAL_NOT_READY");
  });

  test("transient renewal failure retains writer and rearms the single loop", async () => {
    jest.useFakeTimers();
    let activeLease = writerLease;
    const renewedLease = Object.freeze({ ...writerLease, expiresAt: "2099-08-14T12:01:00.000Z" });
    const renew = jest.fn()
      .mockResolvedValueOnce({ status: "AUTHORITY_UNAVAILABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" })
      .mockResolvedValueOnce({ status: "RENEWED", lease: renewedLease });
    const onTransientFailure = jest.fn();
    const onRevoked = jest.fn();
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => activeLease,
      isWriter: () => true,
      renew,
      onRenewed: (_current, refreshed) => { activeLease = refreshed; },
      onTransientFailure,
      onRevoked,
      intervalMs: 20,
    });

    await jest.advanceTimersByTimeAsync(20);
    expect(onTransientFailure).toHaveBeenCalledWith(writerLease, "WRITER_AUTHORITY_UNAVAILABLE");
    expect(onRevoked).not.toHaveBeenCalled();
    expect(activeLease).toBe(writerLease);
    await jest.advanceTimersByTimeAsync(20);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(activeLease).toBe(renewedLease);
    loop.stop();
    jest.useRealTimers();
  });

  test("validation trace attributes explicit scheduler stop without changing the persistent interval", () => {
    const savedEnvironment = process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT;
    const savedHarness = process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS;
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = "production";
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = "1";
    clearRuntimeLeaseTraceForValidation();
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => writerLease,
      isWriter: () => true,
      renew: jest.fn(),
      onRenewed: jest.fn(),
      onTransientFailure: jest.fn(),
      onRevoked: jest.fn(),
      intervalMs: 20_000,
    });
    loop.stop();
    expect(getRuntimeLeaseLifecycleTrace()).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "LEASE_SCHEDULER_STOPPED", detail: expect.objectContaining({ reason: "EXPLICIT_STOP" }) }),
    ]));
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = savedEnvironment;
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = savedHarness;
  });

  test("sustained foreground activity renews the same writer for at least three intervals", async () => {
    jest.useFakeTimers();
    let activeLease = writerLease;
    const activities: string[] = [];
    let renewalCount = 0;
    const renew = jest.fn(async (currentLease: RuntimeWriterLease) => {
      renewalCount += 1;
      return {
        status: "ALREADY_OWNED" as const,
        checkpointRevision: renewalCount,
        lease: Object.freeze({ ...currentLease, expiresAt: `2099-08-14T12:0${renewalCount}:00.000Z` }),
      };
    });
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => activeLease,
      isWriter: () => true,
      renew,
      onRenewed: (_current, refreshed) => { activeLease = refreshed; },
      onTransientFailure: jest.fn(),
      onRevoked: jest.fn(),
      intervalMs: 20,
    });

    activities.push("checkpoint", "mtp", "manual-advance", "snapshot", "realtime");
    await jest.advanceTimersByTimeAsync(60);
    expect(activities).toHaveLength(5);
    expect(renew).toHaveBeenCalledTimes(3);
    expect(renew.mock.calls.every(([renewed]) => renewed.writerInstanceId === "WRITER-A")).toBe(true);
    loop.stop();
    jest.useRealTimers();
  });

  test("realtime reconnect wakes a dormant interval and resumes renewal immediately", async () => {
    jest.useFakeTimers();
    let activeLease = writerLease;
    const refreshedLease = Object.freeze({ ...writerLease, expiresAt: "2099-08-14T12:01:00.000Z" });
    const renew = jest.fn(async () => ({ status: "ALREADY_OWNED" as const, checkpointRevision: 1, lease: refreshedLease }));
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => activeLease,
      isWriter: () => true,
      renew,
      onRenewed: (_current, refreshed) => { activeLease = refreshed; },
      onTransientFailure: jest.fn(),
      onRevoked: jest.fn(),
      intervalMs: 20_000,
    });

    loop.wake();
    await Promise.resolve();
    await Promise.resolve();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(activeLease).toBe(refreshedLease);
    await jest.advanceTimersByTimeAsync(19_999);
    expect(renew).toHaveBeenCalledTimes(1);
    loop.stop();
    jest.useRealTimers();
  });

  test("reconnect after authoritative expiry clears stale local writer", async () => {
    jest.useFakeTimers();
    let activeLease: RuntimeWriterLease | undefined = Object.freeze({
      ...writerLease,
      expiresAt: "2026-08-14T12:00:00.000Z",
    });
    let writer = true;
    const onRevoked = jest.fn(() => { activeLease = undefined; writer = false; });
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => activeLease,
      isWriter: () => writer,
      renew: async () => ({ status: "AUTHORITY_UNAVAILABLE" as const, code: "WRITER_AUTHORITY_UNAVAILABLE" as const }),
      onRenewed: jest.fn(),
      onTransientFailure: jest.fn(),
      onRevoked,
      intervalMs: 20_000,
      now: () => Date.parse("2026-08-14T12:00:01.000Z"),
    });

    loop.wake();
    await Promise.resolve();
    await Promise.resolve();
    expect(onRevoked).toHaveBeenCalledWith(expect.objectContaining({ leaseId: "LEASE-A" }), "WRITER_AUTHORITY_UNAVAILABLE");
    expect(activeLease).toBeUndefined();
    expect(writer).toBe(false);
    loop.stop();
    jest.useRealTimers();
  });

  test("repeated reconnect signals never create overlapping renewal attempts", async () => {
    jest.useFakeTimers();
    type RenewalResult = Awaited<ReturnType<typeof renewRuntimeWriterTerminal>>;
    let settle: ((value: RenewalResult) => void) | undefined;
    const renew = jest.fn(() => new Promise<RenewalResult>(resolve => { settle = resolve; }));
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => writerLease,
      isWriter: () => true,
      renew,
      onRenewed: jest.fn(),
      onTransientFailure: jest.fn(),
      onRevoked: jest.fn(),
      intervalMs: 20_000,
    });

    loop.wake();
    loop.wake();
    loop.wake();
    expect(renew).toHaveBeenCalledTimes(1);
    settle?.({ status: "ALREADY_OWNED", checkpointRevision: 1, lease: writerLease });
    await Promise.resolve();
    await Promise.resolve();
    expect(renew).toHaveBeenCalledTimes(1);
    loop.stop();
    jest.useRealTimers();
  });

  test("publication failure retains dirty state and rearms one bounded retry", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const publisher = source.slice(source.indexOf("let publishInFlight=false"), source.indexOf("const stopPrepared="));
    expect(publisher).toContain("let publicationDirty=false");
    expect(publisher).toContain("publicationDirty=true;setStatus");
    expect(publisher).toContain("if(publicationDirty&&terminalIntentGeneration===undefined)schedulePublicationRetry()");
    expect(publisher.match(/publicationRetryTimer=setTimeout/g)).toHaveLength(1);
    expect(publisher).toContain("ROUTINE_CHECKPOINT_PUBLICATION_MS");
  });

  test("a late publication acknowledgement never overwrites a newer local checkpoint", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const publisher = source.slice(source.indexOf("if(result.state===\"PUBLISHED\")"), source.indexOf("else if(publicationResultRevokesWriter"));
    expect(publisher).toContain("currentLocal.checkpointRevision<=result.checkpoint.checkpointRevision");
    expect(publisher).toContain("lastPublishedCheckpoint=result.checkpoint");
    expect(publisher).toContain("remoteRevision=result.checkpoint.checkpointRevision");
    expect(publisher.indexOf("currentLocal.checkpointRevision")).toBeLessThan(publisher.indexOf("localRuntimeCheckpointStore.accept"));
  });

  test("reconnect and legitimate authority acquisition rearm the same publication scheduler", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toMatch(/if\(channelStatus==="SUBSCRIBED"&&!generationStopped\(\)\)\{\s*renewalLoop\?\.wake\(\);requestPublish\(\);/);
    expect(source).toContain('table:"runtime_checkpoint_notifications"');
    expect(source).toContain('"runtime_checkpoint_notifications.reconnect_metadata"');
    expect(source).not.toContain('table:"runtime_checkpoints",filter:');
    expect(source.match(/wakeCheckpointPublicationForCurrentWriter\?\.\(\)/g)).toHaveLength(2);
    expect(source).toContain("if(wakeCheckpointPublicationForCurrentWriter===requestPublish)wakeCheckpointPublicationForCurrentWriter=undefined");
  });

  test("typed stale authority or actual local expiry revokes writer", () => {
    expect(renewalFailureRevokesWriter(
      { status: "AUTHORITY_UNAVAILABLE", code: "STALE_WRITER" },
      writerLease,
      Date.parse("2026-08-14T12:00:00.000Z"),
    )).toBe(true);
    expect(renewalFailureRevokesWriter(
      { status: "AUTHORITY_UNAVAILABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" },
      { ...writerLease, expiresAt: "2026-08-14T12:00:00.000Z" },
      Date.parse("2026-08-14T12:00:01.000Z"),
    )).toBe(true);
  });

  test("a dormant renewal loop is observable so Resume can attach one replacement", async () => {
    jest.useFakeTimers();
    let writer = true;
    const firstLoop = startRuntimeWriterRenewalLoop({
      getLease: () => writerLease,
      isWriter: () => writer,
      renew: jest.fn(),
      onRenewed: jest.fn(),
      onTransientFailure: jest.fn(),
      onRevoked: jest.fn(),
      intervalMs: 20,
    });

    writer = false;
    await jest.advanceTimersByTimeAsync(20);
    expect(firstLoop.isActive()).toBe(false);

    writer = true;
    const replacementRenew = jest.fn(async () => ({
      status: "ALREADY_OWNED" as const,
      checkpointRevision: 1,
      lease: writerLease,
    }));
    const replacementLoop = startRuntimeWriterRenewalLoop({
      getLease: () => writerLease,
      isWriter: () => writer,
      renew: replacementRenew,
      onRenewed: jest.fn(),
      onTransientFailure: jest.fn(),
      onRevoked: jest.fn(),
      intervalMs: 20,
    });
    await jest.advanceTimersByTimeAsync(20);
    expect(replacementRenew).toHaveBeenCalledTimes(1);
    replacementLoop.stop();
    jest.useRealTimers();
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
    expect(startup).toContain("remoteLifecycleActive = await startupAwait(waitForRemoteRuntimeLifecycleActive(exerciseId))");
    expect(startup).toContain("if (remoteLifecycleActive === false)");
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
    const restore = startup.indexOf("acceptAuthoritativeRuntimeCheckpointAsync(resolved.checkpoint, true", acquisition);
    const owner = startup.indexOf("establishRuntimeOwner()", restore);
    expect(acquisition).toBeGreaterThan(-1);
    expect(lease).toBeGreaterThan(acquisition);
    expect(authority).toBeGreaterThan(lease);
    expect(writer).toBeGreaterThan(authority);
    expect(restore).toBeGreaterThan(writer);
    expect(owner).toBeGreaterThan(restore);
    expect(source.match(/startRuntimeWriterRenewalLoop\(/g)).toHaveLength(2);
  });

  test("acquired authority protects restored Runtime owners from a concurrent cloud echo", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"), source.indexOf("function setAndReturn"));
    const lease = takeover.indexOf("lease=acquired.lease");
    const acquiring = takeover.indexOf('setStatus({state:"ACQUIRING"');
    const writer = takeover.indexOf('setStatus({state:"WRITER"');
    const restore = takeover.indexOf("acceptAuthoritativeRuntimeCheckpointAsync(resolved.checkpoint, true");
    const owner = takeover.indexOf("establishExerciseRuntimeOwnerForCurrentWriter", restore);
    const resumeCompletion = takeover.indexOf("resumePendingCompletionForCurrentWriter", owner);
    const routinePublication = takeover.indexOf("wakeCheckpointPublicationForCurrentWriter", resumeCompletion);
    expect(lease).toBeGreaterThan(-1);
    expect(acquiring).toBeGreaterThan(lease);
    expect(writer).toBeGreaterThan(acquiring);
    expect(restore).toBeGreaterThan(writer);
    expect(owner).toBeGreaterThan(restore);
    expect(resumeCompletion).toBeGreaterThan(owner);
    expect(routinePublication).toBeGreaterThan(resumeCompletion);
  });

  test("takeover second freshness check is metadata-only", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"), source.indexOf("function setAndReturn"));
    expect(takeover).toContain('loadRuntimeCheckpointWithCache(repository,exerciseId,localCheckpoint,"takeover")');
    expect(takeover).not.toContain("repository.loadLatest(exerciseId)");
    expect(takeover).toContain('loadCheckpointFreshness(repository,exerciseId,"takeover")');
  });

  test("explicit revision-conflict recovery delegates one user intent to the recovery coordinator", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const recovery = source.slice(source.indexOf("export function reacquireRuntimeFromRemoteCheckpoint"), source.indexOf("function setAndReturn"));
    expect(recovery).toContain("if (activeRecovery) return activeRecovery");
    expect(recovery).toContain("runtimeCheckpointRecoveryCoordinator.recover");
    expect(recovery).toContain("acquireRuntimeWriterTerminal(repository,exerciseId,writerId,expectedRevision");
    expect(recovery).toContain("adopt: () => {}");
    expect(recovery).toContain("acceptAuthoritativeRuntimeCheckpointAsync(recovered.checkpoint,true");
    expect(recovery.indexOf("establishExerciseRuntimeOwnerForCurrentWriter")).toBeGreaterThan(
      recovery.indexOf("acceptAuthoritativeRuntimeCheckpointAsync(recovered.checkpoint,true"),
    );
    expect(recovery.indexOf("resumePendingCompletionForCurrentWriter")).toBeGreaterThan(
      recovery.indexOf("establishExerciseRuntimeOwnerForCurrentWriter"),
    );
    expect(recovery).toContain('loadRuntimeCheckpointWithCache(repository,exerciseId,checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId),"recovery")');
  });

  test("pending completion recovery owns Runtime lifecycle independently of the dashboard", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const dashboard = fs.readFileSync(path.join(process.cwd(), "src/app/excon/dashboard.tsx"), "utf8");
    const ownerRegistration = source.indexOf("const establishRuntimeOwner");
    const completionProcessing = source.indexOf("const processCompletionRequest");
    const initialCompletionLoad = source.lastIndexOf("completionGateway.load(exerciseId).then(processCompletionRequest)");
    expect(ownerRegistration).toBeGreaterThan(-1);
    expect(completionProcessing).toBeGreaterThan(ownerRegistration);
    expect(initialCompletionLoad).toBeGreaterThan(completionProcessing);
    expect(source).toContain("!runtimeOwnerGeneration.isReady()");
    expect(source).toContain('releaseRuntimeOwner("GENERATION_CLEANUP")');
    expect(dashboard).toContain("initializeAuthoritativeExerciseRuntime");
    expect(source).not.toContain("dashboard");
  });

  test("remote current-exercise discovery resolves before checkpoint authority startup", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    const cloudStart = layout.indexOf("startCloudSync()");
    const runtimeStart = layout.indexOf("startRuntime: startRuntimeCheckpointSync");
    expect(cloudStart).toBeGreaterThan(-1);
    expect(runtimeStart).toBeGreaterThan(-1);
    expect(cloudStart).toBeLessThan(runtimeStart);
    expect(layout).toContain("startAfterCurrentExerciseDiscovery");
  });

  test("local checkpoint restoration keeps a visible startup state instead of a blank root", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    expect(layout).toContain('accessibilityLabel="Rakenduse käivitamine"');
    expect(layout).toContain("RussiCaptor käivitub");
    expect(layout).toContain("Taastan turvaliselt seadme kohalikku seisundit…");
    expect(layout).not.toContain('return <View style={{ flex: 1, backgroundColor: "#F6F8FB" }} />;');
  });

  test("cold persisted Runtime remains stopped until discovery and authority resolve", () => {
    const persistence = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const loadStart = persistence.indexOf("export async function loadPersistedState");
    const restoreStart = persistence.indexOf("function restoreCanonicalRuntime", loadStart);
    const load = persistence.slice(loadStart, restoreStart);
    expect(load).toContain("restoreCanonicalRuntimeAsync(runtimeRestore, false");
    expect(load).not.toContain("restoreCanonicalRuntime(restored, true)");
  });

  test("cloud restart tears down stale discovery polling before creating the next poll", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    const start = source.indexOf("export async function startCloudSync");
    const remove = source.indexOf("clearInterval(remotePollTimer)", start);
    const create = source.indexOf("remotePollTimer = setInterval", start);
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

  test("accepted authoritative checkpoint is queued unchanged for durable warm-restart cache", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const start = source.indexOf("export function acceptAuthoritativeRuntimeCheckpoint");
    const end = source.indexOf("export function assertRuntimeCheckpointClockConsistency", start);
    const accept = source.slice(start, end);
    const restore = accept.indexOf("localRuntimeCheckpointStore.restore(checkpoint)");
    const durable = accept.indexOf("runtimeCheckpoint: checkpoint", restore);
    const flush = accept.indexOf("void flushLatestSnapshot()", durable);
    expect(restore).toBeGreaterThan(-1);
    expect(durable).toBeGreaterThan(restore);
    expect(flush).toBeGreaterThan(durable);
  });

  test("transient discovery save cannot erase a validated same-exercise checkpoint cache", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const persistence = source.slice(source.indexOf("export function startStatePersistence"));
    expect(persistence).toContain("const acceptedCheckpoint = preparedCheckpoint ?? localRuntimeCheckpointStore.get()");
    expect(persistence).toContain("acceptedCheckpoint?.exerciseId === shared.exerciseSession.exerciseId");
    expect(persistence).toContain("checkpointForSnapshot ? { runtimeCheckpoint: checkpointForSnapshot }");
  });

  test("remote exercise discovery preserves only validated same-exercise reader Runtime", () => {
    const statePersistence = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const restore = statePersistence.indexOf("export function restoreRemoteExerciseIdentity");
    const readReady = statePersistence.indexOf("isClinicalReferenceRuntimeReadReady", restore);
    const clearDecision = statePersistence.indexOf("shouldClearRuntimeForRemoteIdentity", readReady);
    const clear = statePersistence.indexOf("clearActiveClinicalReferenceRuntime();", clearDecision);
    const restoreIdentity = statePersistence.indexOf("restoreExerciseIdentity(restored, false);", clear);
    expect(readReady).toBeGreaterThan(restore);
    expect(clearDecision).toBeGreaterThan(readReady);
    expect(clear).toBeGreaterThan(clearDecision);
    expect(restoreIdentity).toBeGreaterThan(clear);
  });

  test("reader hydration is re-established after writer contention without acquiring write authority", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const startup = source.slice(
      source.indexOf("async function startRuntimeCheckpointSyncForExercise"),
      source.indexOf("let publishInFlight=false"),
    );
    const rejectedAcquisition = startup.indexOf("else {", startup.indexOf('if ("lease" in acquired)'));
    const reader = startup.indexOf('setStatus({state:"READER",code:"READER_CHECKPOINT_SYNCHRONIZING"', rejectedAcquisition);
    const durableSelection = startup.indexOf("if(remote)", reader);
    const hydrate = startup.indexOf("acceptReaderCheckpoint(remote", durableSelection);
    const stop = startup.indexOf("stopClockRunner()", hydrate);
    expect(rejectedAcquisition).toBeGreaterThan(-1);
    expect(reader).toBeGreaterThan(rejectedAcquisition);
    expect(durableSelection).toBeGreaterThan(reader);
    expect(hydrate).toBeGreaterThan(durableSelection);
    expect(stop).toBeGreaterThan(hydrate);
    expect(startup.slice(rejectedAcquisition, stop)).not.toContain('setRuntimeWriterAuthorityState("WRITER")');
  });

  test("reader persistence keeps the accepted durable envelope and never mints a local-only revision", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const asyncAccept = source.slice(
      source.indexOf("export async function acceptAuthoritativeRuntimeCheckpointAsync"),
      source.indexOf("export async function acceptAuthoritativeRuntimeCheckpointForReaderAsync"),
    );
    expect(asyncAccept).toContain("runtimeCheckpoint: checkpoint");
    expect(asyncAccept).toContain("void flushLatestSnapshot()");
    const persistence = source.slice(source.indexOf("export function startStatePersistence"));
    expect(persistence).toContain("hasCanonicalRuntime && runtimeWritesAllowed()");
    expect(persistence).toContain("preparedCheckpoint ?? localRuntimeCheckpointStore.get()");
  });

  test("reader checkpoint hydration is protected from same-exercise discovery echoes", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const helper = source.slice(
      source.indexOf("export async function acceptAuthoritativeRuntimeCheckpointForReaderAsync"),
      source.indexOf("export function assertRuntimeCheckpointClockConsistency"),
    );
    expect(helper).toContain("readerRuntimeHydrationCounts.set(exerciseId");
    expect(helper).toContain("acceptAuthoritativeRuntimeCheckpointAsync(checkpoint, false");
    expect(helper).toContain("readerRuntimeHydrationCounts.delete(exerciseId)");
    const restore = source.slice(
      source.indexOf("export function restoreRemoteExerciseIdentity"),
      source.indexOf("export function getLocalRuntimeCheckpoint"),
    );
    expect(restore).toContain("isReaderRuntimeHydrationInProgress(restored.exerciseSession.exerciseId)");
    expect(restore).toContain("shouldPreserveValidatedReaderIdentity(authority, sameExerciseReaderIsHydrated)");
    expect(restore.indexOf("shouldPreserveValidatedReaderIdentity")).toBeLessThan(
      restore.indexOf("restoreExerciseIdentity(restored, false)"));
    const syncSource = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const realtimeReader = syncSource.slice(syncSource.indexOf("const metadataCoordinator"));
    expect(realtimeReader).toContain("acceptReaderCheckpoint(decision.checkpoint");
  });

  test("checkpoint publication is serialized and coalesces overlapping local ticks", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const publish = source.slice(source.indexOf("let publishInFlight=false"), source.indexOf("const stopLocal="));
    expect(publish).toContain("const runPublish=async()=>{");
    expect(publish).toContain("if(publishInFlight){publishQueued=true;return;}");
    expect(publish).toContain("do {");
    expect(publish).toContain("while(publishQueued)");
    expect(publish).toContain("Promise.race([publication,echoAcknowledgement]");
    expect(publish).toContain("echoAcknowledgement");
    expect(publish).toContain("publicationBarrier=task.then(()=>undefined,()=>undefined)");
  });

  test("terminal lifecycle publication supersedes one active routine preparation before RPC", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const publish = source.slice(source.indexOf("let publishInFlight=false"), source.indexOf("const stopPrepared="));
    expect(publish).toContain('checkpointPublicationPriority(checkpoint)==="LIFECYCLE_CRITICAL"');
    expect(publish).toContain("const registerLifecycleCriticalIntent=(fromCommandIntent=false)=>{");
    expect(publish).toContain("terminalIntentGeneration=++publicationIntentGeneration");
    expect(publish).toContain("subscribeToSync(()=>registerLifecycleCriticalIntent(false))");
    expect(publish).toContain('priority==="LIFECYCLE_CRITICAL"||terminalIntentGeneration===undefined');
    expect(publish).toContain('if(result.state==="GENERATION_STOPPED")');
    expect(publish).toContain('CHECKPOINT_PUBLICATION_PREEMPTED');
    expect(publish).toContain("installRuntimeCompletionIntentListener");
    expect(source).toContain("if(terminalTransition)await publicationBarrier");
    expect(publish).toContain("resolveTerminalPublication?.()");
    expect(publish).toContain("publishQueued=true");
    expect(publish).not.toContain("pendingPublicationQueue");
  });

  test("completion intent also supersedes an obsolete local checkpoint preparation generation", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/StatePersistenceService.ts"), "utf8");
    const persistence = source.slice(source.indexOf("export function startStatePersistence"));
    expect(persistence).toContain("installRuntimeCompletionIntentListener");
    expect(persistence).toContain("terminalCaptureGeneration = pipeline.request()");
    expect(persistence).toContain("generation < terminalCaptureGeneration");
    expect(persistence).toContain("RuntimeCheckpointPreparationSupersededError");
    expect(persistence).toContain('startRuntimeWorkTrace("CHECKPOINT_PREPARATION_PREEMPTED")');
  });

  test("a replacement sync generation waits for the prior publication terminal state", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const startupStart = source.indexOf("async function startRuntimeCheckpointSyncForExercise");
    const startup = source.slice(startupStart, source.indexOf("const resolved=", startupStart));
    expect(startup).toContain("await publicationBarrier;");
    expect(startup.indexOf("await publicationBarrier;")).toBeLessThan(startup.indexOf("loadRuntimeCheckpointWithCache(repository"));
  });

  test("only the latest exercise sync generation may publish, renew or apply Realtime", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const generation = source.indexOf("const generation = ++exerciseSyncGeneration;");
    const fence = source.indexOf("const generationStopped = () => stopped || generation !== exerciseSyncGeneration;", generation);
    const publishFence = source.indexOf("if(generationStopped())return;", source.indexOf("const publish=()=>", fence));
    const renewalFence = source.indexOf("isWriter:()=>!generationStopped()", publishFence);
    const realtimeFence = source.indexOf("if(generationStopped())return;", source.indexOf("const handleMetadata=", renewalFence));
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
    expect(source).toContain('return()=>{traceRuntimeLeaseLifecycle("EXERCISE_SYNC_GENERATION_STOPPED"');
    expect(source).toContain('stopPrepared();stopLifecyclePriority();stopCompletionIntent();stopDeferredPatientCommandDrain();resolveTerminalPublication?.();resolveTerminalPublication=undefined;renewalLoop?.stop("GENERATION_CLEANUP")');
  });

  test("explicit Resume attaches the acquired writer to the canonical renewal lifecycle", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = source.slice(source.indexOf("export async function takeOverRuntimeWriter"), source.indexOf("function setAndReturn"));
    const installLease = takeover.indexOf("lease=acquired.lease");
    const writer = takeover.indexOf('setStatus({state:"WRITER"');
    const ensure = takeover.indexOf("ensureLeaseRenewalForCurrentWriter?.()", installLease);
    expect(installLease).toBeGreaterThan(-1);
    expect(writer).toBeGreaterThan(installLease);
    expect(ensure).toBeGreaterThan(installLease);
    expect(ensure).toBeLessThan(writer);
  });

  test("renewal attachment is idempotent and stale generation cleanup cannot clear its replacement", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain('const nativeHeartbeatEnabled = Platform.OS === "android" && isNativeLeaseHeartbeatAvailable();');
    expect(source).toContain('if (nativeHeartbeatEnabled) { startNativeHeartbeat(); return true; }');
    expect(source.match(/startRuntimeWriterRenewalLoop\(/g)).toHaveLength(2);
    expect(source).toContain("if (renewalLoop && !renewalLoop.isActive()) renewalLoop=undefined;");
    expect(source).toContain("if(ensureLeaseRenewalForCurrentWriter===ensureRenewal)ensureLeaseRenewalForCurrentWriter=undefined");
    expect(source).toContain('stopNativeHeartbeat("GENERATION_CLEANUP")');
  });

  test("ordinary background preserves the native-heartbeat writer and foreground reconciles it", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain('AppState.addEventListener("change",nextState=>');
    expect(runtimeWriterAppStateAction("background")).toBe("PRESERVE");
    expect(runtimeWriterAppStateAction("inactive")).toBe("PRESERVE");
    expect(runtimeWriterAppStateAction("active")).toBe("RECONCILE");
    expect(source).not.toContain('code:"WRITER_BACKGROUND_RELINQUISHED"');
    expect(source).not.toContain('releaseWriter(releasedLease)');
    expect(source).toContain("renewalLoop?.wake()");
    expect(source).toContain('runtime_checkpoint_notifications.app_foreground_metadata');
    expect(source).toContain("appStateSubscription.remove()");
  });

  test("cold-start authority awaits terminate with a typed timeout instead of permanent CONNECTING", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain('new Error("AUTHORITY_STARTUP_TIMEOUT")');
    expect(source).toContain("resolveRuntimeAuthSession(supabase.auth)");
    expect(source).toContain("startupAwait(auth.getSession())");
    expect(source).toContain("startupAwait(getRuntimeWriterInstanceId())");
    expect(source).toContain("startupAwait(loadRuntimeCheckpointWithCache(repository,exerciseId,local,\"startup\"))");
    expect(source).toContain("acquireRuntimeWriterTerminal(repository,exerciseId,writerId,remoteRevision,LEASE_SECONDS)");
    expect(source).toContain('setStatus({state:"FAILED",code:error instanceof Error ? error.message');
  });
});
