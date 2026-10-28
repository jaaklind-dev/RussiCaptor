import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

import {
  beginOperatorSignOutDrain, getOperatorSignOutDrainContext, isOperatorSignOutDraining,
  resetOperatorSignOutLifecycleForTests,
} from "../OperatorSignOutLifecycle";
import { getRuntimeExitDiagnostics, recordRuntimeExitFailure } from "@/services/runtime/persistence/RuntimeExitDiagnostics";
import { getRuntimeWriterAuthorityState, setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { createRequire } from "node:module";

// Execute the actual production closures, not a second implementation of the
// drain. Only platform/repository/publication boundaries are synthetic. No app,
// Supabase client, credentials, native module, or transport is instantiated.
const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
const requireProfile = createRequire(path.join(process.cwd(), "package.json"));
const profile = requireProfile("./scripts/canonical-acceptance-profile.cjs");
function variable(name: string, parsed: ts.SourceFile): string {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) {
      if (found) throw Error("Ambiguous source closure");
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!found) throw Error(`Missing actual closure: ${name}`);
  return `const ${found.getText(parsed)};`;
}
function compile(canonical: boolean): string {
  const text = canonical ? profile.transformSource(process.cwd(), path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), source, true) : source;
  const parsed = ts.createSourceFile("RuntimeCheckpointSyncService.ts", text, ts.ScriptTarget.Latest, true);
  return ts.transpileModule([
  "exitDrainPublicationCurrent", "schedulePublicationRetry", "runPublish", "publishNow", "prepareWriterSignOut",
].map(name => variable(name, parsed)).join("\n") + "\nglobalThis.prepare=prepareWriterSignOut;globalThis.publishNow=publishNow;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
}
const compiled = compile(false), canonicalCompiled = compile(true);

type Lease = { exerciseId: string; leaseId: string; writerInstanceId: string };
function fixture(dirty = true, canonical = false) {
  let remote: Lease | undefined = { exerciseId: "EX", leaseId: "L", writerInstanceId: "W" };
  let stopped = false;
  const lease = remote;
  const checkpoint = { exerciseId: "EX", checkpointRevision: 39, payloadHash: "H39" };
  const events: string[] = [];
  const publish = jest.fn(async (): Promise<{ state: string; checkpoint?: typeof checkpoint; reconciled?: boolean; code?: string }> => ({ state: "PUBLISHED", checkpoint, reconciled: false }));
  const repository = {
    loadWriterLease: jest.fn(async () => remote),
    releaseWriter: jest.fn(async () => { remote = undefined; }),
  };
  const c = {
    Promise, Object, Error, Date, exerciseId: "EX", generation: 7, traceGeneration: "G7",
    generationStopped: () => stopped, lease: lease as Lease | undefined,
    status: { state: "WRITER", code: undefined as string | undefined }, remoteRevision: 38,
    publicationDirty: dirty, publishInFlight: false, publishQueued: false,
    publicationRetryTimer: undefined, routinePublishTimer: undefined, publicationBarrier: Promise.resolve(),
    publicationIntentGeneration: 0, terminalIntentGeneration: undefined, activeCompletion: undefined,
    activePublicationPriority: undefined, lastPublishedCheckpoint: undefined, lastPublicationAt: 0,
    lastCheckpointPublicationAt: undefined, pendingWriterEcho: undefined, signOutReleaseInFlight: undefined,
    renewalLoop: { stop: () => { events.push("stop-renewal"); } },
    beginOperatorSignOutDrain, getOperatorSignOutDrainContext, isOperatorSignOutDraining,
    setRuntimeWriterAuthorityState, recordRuntimeExitFailure,
    beginRuntimeReaderConvergence: jest.fn(), releaseRuntimeOwner: jest.fn(),
    rejectCanonicalCommandCommitWaiters: jest.fn(), stopClockRunner: jest.fn(), stopNativeHeartbeat: jest.fn(),
    traceRuntimeLeaseLifecycle: jest.fn(), startRuntimeWorkTrace: () => jest.fn(),
    getLocalRuntimeCheckpoint: () => checkpoint, checkpointPublicationPriority: () => "ROUTINE",
    isIdenticalCheckpointPayload: (a?: { payloadHash: string }, b?: { payloadHash: string }) => Boolean(a && b && a.payloadHash === b.payloadHash),
    isSharedWorkflowValidationHarnessEnabled: () => false, yieldToEventLoop: async () => {},
    publicationResultRevokesWriter: () => false, publishRuntimeCheckpointTerminal: publish, repository,
    localRuntimeCheckpointStore: { acceptPublishedAcknowledgement: jest.fn() }, settleCanonicalCommandCommitWaiters: jest.fn(),
    setTimeout: () => { throw Error("Unexpected automatic retry"); }, clearTimeout: jest.fn(),
    setStatus: (value: { state: string; code?: string }) => {
      c.status = { ...value, code: value.code };
      setRuntimeWriterAuthorityState(isOperatorSignOutDraining() ? "READER" : "WRITER");
    },
    prepare: async () => {}, publishNow: () => {},
  };
  vm.createContext(c); vm.runInContext(canonical ? canonicalCompiled : compiled, c);
  return { c, publish, repository, events, remote: (value?: Lease) => { remote = value; }, stop: () => { stopped = true; } };
}

describe("real Runtime exit publication retry closures", () => {
  beforeEach(() => { resetOperatorSignOutLifecycleForTests(); setRuntimeWriterAuthorityState("WRITER", "L"); });

  test("clean exit releases once without publication", async () => {
    const f = fixture(false); await expect(f.c.prepare()).resolves.toBeUndefined();
    expect(f.publish).not.toHaveBeenCalled(); expect(f.repository.releaseWriter).toHaveBeenCalledTimes(1);
    expect(getRuntimeWriterAuthorityState()).toBe("READER");
  });

  test("dirty exit verifies lease, acknowledges publication and releases once", async () => {
    const f = fixture(); await f.c.prepare();
    expect(f.repository.loadWriterLease).toHaveBeenCalledTimes(3);
    expect(f.repository.loadWriterLease.mock.invocationCallOrder[0]).toBeLessThan(f.publish.mock.invocationCallOrder[0]);
    expect(f.publish).toHaveBeenCalledTimes(1); expect(f.repository.releaseWriter).toHaveBeenCalledTimes(1);
    expect(getRuntimeWriterAuthorityState()).toBe("READER");
  });

  test.each([false, true])("first failure then explicit retry succeeds without command authority (canonical=%s)", async canonical => {
    const f = fixture(true, canonical);
    f.publish.mockRejectedValueOnce(new Error("AUTHORITY_UNAVAILABLE"));
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_PUBLICATION_UNSETTLED");
    expect(f.c.status.state).toBe("FAILED"); expect(isOperatorSignOutDraining()).toBe(true);
    expect(getRuntimeWriterAuthorityState()).toBe("READER"); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
    f.publish.mockImplementationOnce(async () => {
      expect(getRuntimeWriterAuthorityState()).toBe("READER");
      return { state: "PUBLISHED", checkpoint: f.c.getLocalRuntimeCheckpoint(), reconciled: false };
    });
    await expect(f.c.prepare()).resolves.toBeUndefined();
    expect(f.publish).toHaveBeenCalledTimes(2); expect(f.repository.releaseWriter).toHaveBeenCalledTimes(1);
    expect(getRuntimeWriterAuthorityState()).toBe("READER"); expect(isOperatorSignOutDraining()).toBe(true);
    expect(getRuntimeExitDiagnostics().slice(-2)).toEqual([
      expect.objectContaining({ stage: "PUBLICATION", reason: "AUTHORITY_UNAVAILABLE" }),
      expect.objectContaining({ stage: "PUBLICATION_DRAIN", reason: "WRITER_SIGNOUT_PUBLICATION_UNSETTLED" }),
    ]);
  });

  test.each(["other lease", "other writer", "missing lease"])("retry rejects %s before another publication", async variant => {
    const f = fixture(); f.publish.mockRejectedValueOnce(new Error("AUTHORITY_UNAVAILABLE"));
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_PUBLICATION_UNSETTLED");
    f.remote(variant === "missing lease" ? undefined : { exerciseId: "EX", leaseId: variant === "other lease" ? "OTHER" : "L", writerInstanceId: variant === "other writer" ? "OTHER" : "W" });
    await expect(f.c.prepare()).rejects.toThrow(variant === "missing lease" ? "WRITER_SIGNOUT_CANONICAL_AUTHORITY_UNAVAILABLE" : "WRITER_SIGNOUT_CANONICAL_AUTHORITY_CHANGED");
    expect(f.publish).toHaveBeenCalledTimes(1); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
    expect(getRuntimeWriterAuthorityState()).toBe("READER");
  });

  test("wrong frozen generation remains blocked", async () => {
    const f = fixture(); beginOperatorSignOutDrain({ exerciseId: "EX", leaseId: "L", writerInstanceId: "W", writerGeneration: 6, checkpointRevision: 38 });
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_LEASE_REPLACED_DURING_DRAIN");
    expect(f.publish).not.toHaveBeenCalled(); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
  });

  test("wrong frozen exercise remains blocked even for an already clean checkpoint", async () => {
    const f = fixture(false); beginOperatorSignOutDrain({ exerciseId: "OTHER-EX", leaseId: "L", writerInstanceId: "W", writerGeneration: 7, checkpointRevision: 38 });
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_LEASE_REPLACED_DURING_DRAIN");
    expect(f.publish).not.toHaveBeenCalled(); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
  });

  test("structured publication failure retains its exact known code", async () => {
    const f = fixture(); f.publish.mockResolvedValueOnce({ state: "AUTH_UNAVAILABLE", code: "AUTHORITY_UNAVAILABLE" });
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_PUBLICATION_UNSETTLED");
    expect(getRuntimeExitDiagnostics().slice(-2)).toEqual([
      expect.objectContaining({ stage: "PUBLICATION", reason: "AUTHORITY_UNAVAILABLE" }),
      expect.objectContaining({ stage: "PUBLICATION_DRAIN", reason: "WRITER_SIGNOUT_PUBLICATION_UNSETTLED" }),
    ]);
    expect(f.repository.releaseWriter).not.toHaveBeenCalled();
  });

  test("local lease replacement during server check cannot publish", async () => {
    const f = fixture(); f.repository.loadWriterLease.mockImplementationOnce(async () => {
      f.c.lease = { exerciseId: "EX", leaseId: "OTHER", writerInstanceId: "W" }; return { exerciseId: "EX", leaseId: "L", writerInstanceId: "W" };
    });
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_LEASE_REPLACED_DURING_DRAIN");
    expect(f.publish).not.toHaveBeenCalled(); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
  });

  test("generation becoming stale during lease check cannot publish", async () => {
    const f = fixture(); f.repository.loadWriterLease.mockImplementationOnce(async () => { f.stop(); return f.c.lease; });
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_LEASE_REPLACED_DURING_DRAIN");
    expect(f.publish).not.toHaveBeenCalled(); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
  });

  test("failed lease read preserves stage and never attempts publication", async () => {
    const f = fixture(); f.repository.loadWriterLease.mockRejectedValueOnce(new Error("AUTHORITY_UNAVAILABLE"));
    await expect(f.c.prepare()).rejects.toThrow("AUTHORITY_UNAVAILABLE");
    expect(getRuntimeExitDiagnostics().at(-1)).toMatchObject({ stage: "PUBLICATION_LEASE_CHECK", reason: "AUTHORITY_UNAVAILABLE" });
    expect(f.publish).not.toHaveBeenCalled(); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
  });

  test("release error blocks completion; retry does not republish an acknowledged checkpoint", async () => {
    const f = fixture(); f.repository.releaseWriter.mockRejectedValueOnce(new Error("AUTHORITY_UNAVAILABLE"));
    await expect(f.c.prepare()).rejects.toThrow("AUTHORITY_UNAVAILABLE");
    expect(getRuntimeExitDiagnostics().at(-1)?.stage).toBe("LEASE_RELEASE");
    await expect(f.c.prepare()).resolves.toBeUndefined();
    expect(f.publish).toHaveBeenCalledTimes(1); expect(f.repository.releaseWriter).toHaveBeenCalledTimes(2);
  });

  test("unconfirmed release is never successful", async () => {
    const f = fixture(false); f.repository.releaseWriter.mockImplementationOnce(async () => {});
    await expect(f.c.prepare()).rejects.toThrow("WRITER_SIGNOUT_RELEASE_UNCONFIRMED");
    expect(getRuntimeExitDiagnostics().at(-1)).toMatchObject({ stage: "RELEASE_CONFIRMATION", reason: "WRITER_SIGNOUT_RELEASE_UNCONFIRMED" });
    expect(f.c.status.state).toBe("FAILED"); expect(getRuntimeWriterAuthorityState()).toBe("READER");
  });

  test("in-flight publication settles before exit, without a duplicate request", async () => {
    const f = fixture(); let resolve!: (value: Awaited<ReturnType<typeof f.publish>>) => void;
    f.publish.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.c.publishNow(); const exit = f.c.prepare();
    expect(f.publish).toHaveBeenCalledTimes(1); expect(f.repository.releaseWriter).not.toHaveBeenCalled();
    resolve({ state: "PUBLISHED", checkpoint: f.c.getLocalRuntimeCheckpoint(), reconciled: false });
    await expect(exit).resolves.toBeUndefined();
    expect(f.publish).toHaveBeenCalledTimes(1); expect(f.repository.releaseWriter).toHaveBeenCalledTimes(1);
  });
});
