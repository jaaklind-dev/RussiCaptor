import fs from "node:fs";
import path from "node:path";

import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import {
  acquireRuntimeWriterTerminal,
  renewRuntimeWriterTerminal,
  runtimeWriterAcquisitionAllowed,
} from "@/services/RuntimeCheckpointSyncService";
import {
  beginOperatorSignOutDrain,
  completeOperatorSignOutDrain,
  getOperatorSignOutDrainContext,
  isOperatorSignOutDraining,
  resetOperatorSignOutLifecycleForTests,
} from "@/services/authorization/OperatorSignOutLifecycle";

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const lease = (leaseId = "LEASE-A"): RuntimeWriterLease => Object.freeze({
  leaseId, exerciseId: "EX-1", writerInstanceId: "RUNTIME-1", userId: "USER-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
});
const context = (leaseId = "LEASE-A") => Object.freeze({
  exerciseId: "EX-1", writerInstanceId: "RUNTIME-1", leaseId,
  writerGeneration: 7, checkpointRevision: 19,
});

describe("RUNTIME-SIGNOUT-PENDING-MUTATION-LEASE-RACE-02", () => {
  beforeEach(() => resetOperatorSignOutLifecycleForTests());

  test("SIGNOUT-RACE-01 an acquisition already pending when drain starts cannot install replacement lease B", async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const replacement = lease("LEASE-B");
    const repository = {
      acquireWriter: jest.fn(async () => { await pending; return { status: "ACQUIRED" as const, checkpointRevision: 19, lease: replacement }; }),
      loadWriterLease: jest.fn(async () => replacement),
      releaseWriter: jest.fn(async () => undefined),
    };
    const acquisition = acquireRuntimeWriterTerminal(repository, "EX-1", "RUNTIME-1", 19, 60);
    beginOperatorSignOutDrain(context());
    finish();
    await expect(acquisition).resolves.toMatchObject({ status: "AUTHORITY_UNAVAILABLE" });
    expect(repository.releaseWriter).toHaveBeenCalledWith(replacement);
  });

  test("SIGNOUT-RACE-02 renewal cannot start after drain begins", async () => {
    beginOperatorSignOutDrain(context());
    const repository = { renewWriter: jest.fn(), loadWriterLease: jest.fn() };
    await expect(renewRuntimeWriterTerminal(repository as never, lease(), 60))
      .resolves.toMatchObject({ code: "WRITER_SIGNOUT_DRAINING" });
    expect(repository.renewWriter).not.toHaveBeenCalled();
  });

  test("SIGNOUT-RACE-03 reconnect acquisition is fenced", () => {
    beginOperatorSignOutDrain(context());
    expect(runtimeWriterAcquisitionAllowed({ state: "AUTHENTICATED", principal: { userId: "USER-1", roleAssignments: [
      { id: "A", userId: "USER-1", role: "EXCON", scopeType: "EXERCISE", scopeId: "EX-1", status: "ACTIVE", issuedAt: "2026-01-01", issuedBy: "ADMIN" },
    ] }, profile: { userId: "USER-1", displayName: "Operator" } } as never, "EX-1")).toBe(false);
  });

  test("SIGNOUT-RACE-04 foreground acquisition callback is blocked during drain", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(runtime).toContain('if(nextState!=="active"||isOperatorSignOutDraining())return;');
  });

  test("SIGNOUT-RACE-05 subscription renewal/acquisition activity is blocked during drain", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(runtime).toContain('channelStatus==="SUBSCRIBED"&&!generationStopped()&&!isOperatorSignOutDraining()');
  });

  test("SIGNOUT-RACE-06 bootstrap/retry generation cannot start during drain", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(runtime).toContain("if(isOperatorSignOutDraining())return;");
    expect(runtime).toContain("if(stopped||isOperatorSignOutDraining()||!isActiveExercise()");
    expect(runtime).toContain("if (isOperatorSignOutDraining()) return()=>{};");
  });

  test("SIGNOUT-RACE-07 drain retains one immutable lease identity", () => {
    const frozen = beginOperatorSignOutDrain(context());
    expect(beginOperatorSignOutDrain(context("LEASE-B"))).toBe(frozen);
    expect(getOperatorSignOutDrainContext()?.leaseId).toBe("LEASE-A");
  });

  test("SIGNOUT-RACE-08 acquisition requested after drain creates no replacement row", async () => {
    beginOperatorSignOutDrain(context());
    const repository = { acquireWriter: jest.fn(), loadWriterLease: jest.fn(), releaseWriter: jest.fn() };
    await expect(acquireRuntimeWriterTerminal(repository as never, "EX-1", "RUNTIME-1", 19, 60))
      .resolves.toMatchObject({ code: "WRITER_SIGNOUT_DRAINING" });
    expect(repository.acquireWriter).not.toHaveBeenCalled();
  });

  test("SIGNOUT-RACE-09 canonical release remains ordered before Auth signOut", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    const auth = source("src/services/authorization/OperatorSessionService.ts");
    expect(runtime).toContain("await repository.releaseWriter(currentLease)");
    expect(auth.indexOf("await prepareOperatorSignOut()"))
      .toBeLessThan(auth.indexOf('supabase.auth.signOut({ scope: "local" })'));
  });

  test("SIGNOUT-RACE-10 failed preparation preserves drain and therefore the Auth safety fence", () => {
    beginOperatorSignOutDrain(context());
    expect(isOperatorSignOutDraining()).toBe(true);
  });

  test("SIGNOUT-RACE-11 successful local Auth sign-out clears the drain once", () => {
    beginOperatorSignOutDrain(context());
    completeOperatorSignOutDrain();
    completeOperatorSignOutDrain();
    expect(isOperatorSignOutDraining()).toBe(false);
  });

  test("SIGNOUT-RACE-12 retry cannot replace its frozen context with another client's lease", () => {
    const original = beginOperatorSignOutDrain(context());
    const other = beginOperatorSignOutDrain({ ...context("OTHER-LEASE"), writerInstanceId: "OTHER-RUNTIME" });
    expect(other).toBe(original);
    expect(other.writerInstanceId).toBe("RUNTIME-1");
  });

  test("SIGNOUT-RACE-13 a later client may acquire after completed sign-out clears the fence", async () => {
    beginOperatorSignOutDrain(context());
    completeOperatorSignOutDrain();
    const acquired = lease("LEASE-C");
    const repository = {
      acquireWriter: jest.fn(async () => ({ status: "ACQUIRED" as const, checkpointRevision: 19, lease: acquired })),
      loadWriterLease: jest.fn(async () => acquired), releaseWriter: jest.fn(async () => undefined),
    };
    await expect(acquireRuntimeWriterTerminal(repository, "EX-1", "RUNTIME-2", 19, 60))
      .resolves.toMatchObject({ status: "ACQUIRED", lease: acquired });
  });

  test("SIGNOUT-RACE-14 native and JavaScript renewal paths both test the drain fence", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(runtime).toContain("if (isOperatorSignOutDraining() || !nativeHeartbeatEnabled");
    expect(runtime).toContain("if(isOperatorSignOutDraining() || generationStopped() || !lease");
    expect(runtime).toContain('isOperatorSignOutDraining() ? "SIGNOUT_DRAINING"');
  });

  test("SIGNOUT-RACE-15 role revoke still requires canonical lease absence", () => {
    const admin = source("supabase/functions/platform-admin-exercises/index.ts");
    expect(admin.indexOf("ACTIVE_RUNTIME_OWNERSHIP_CONFLICT"))
      .toBeLessThan(admin.indexOf('rpc("trusted_admin_revoke_exercise_role"'));
  });
});
