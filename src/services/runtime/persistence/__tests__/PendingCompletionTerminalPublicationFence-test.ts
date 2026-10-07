import fs from "node:fs";
import path from "node:path";

import { resumeCompletionBeforeRoutinePublication } from "@/services/RuntimeCheckpointSyncService";

type CompletionRequest = { commandId: string; status: "PENDING" | "COMPLETED" };

class LegacyTerminalRecoveryFixture {
  readonly exerciseId = "EX-1790573087374-1";
  readonly requests: CompletionRequest[] = [{ commandId: "EXCON-1790577652608-1", status: "PENDING" }];
  readonly patients = new Map([["P01", "Active"], ["P02", "Completed"]]);
  readonly owners = new Map([["P01", "CM-B"], ["P02", "CM-B"]]);
  exerciseLifecycle: "RUNNING" | "COMPLETED" = "RUNNING";
  activeWriter?: string;
  genericPublications = 0;
  atomicFinalizations = 0;
  terminalEffects = 0;
  terminalCheckpoints = 0;
  completionTransitions = 0;
  writerReleases = 0;
  matchingCompletionAudit = false;

  async recover(writer: string, options: Readonly<{ competingWriter?: string; terminalEffectAlreadyExists?: boolean }> = {}): Promise<void> {
    if (options.competingWriter && options.competingWriter !== writer) throw new Error("WRITER_AUTHORITY_HELD");
    this.activeWriter = writer;
    if (options.terminalEffectAlreadyExists) {
      this.exerciseLifecycle = "COMPLETED";
      this.terminalCheckpoints = 1;
    }
    await resumeCompletionBeforeRoutinePublication(async () => {
      const request = this.requests[0];
      if (request.status === "COMPLETED") return true;
      this.atomicFinalizations += 1;
      if (!options.terminalEffectAlreadyExists) {
        this.exerciseLifecycle = "COMPLETED";
        this.terminalEffects += 1;
        this.terminalCheckpoints += 1;
      }
      request.status = "COMPLETED";
      this.completionTransitions += 1;
      this.activeWriter = undefined;
      this.writerReleases += 1;
      return true;
    }, () => { this.genericPublications += 1; });
  }
}

const syncSource = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
const repositorySource = fs.readFileSync(path.resolve(process.cwd(),
  "src/services/runtime/persistence/RuntimeCheckpointRepository.ts"), "utf8");
const fenceMigration = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20260907153105_narva_multicm_terminal_convergence.sql"), "utf8");

describe("LEGACY-PENDING-COMPLETION-TERMINAL-PUBLICATION-FENCE-01", () => {
  test("TERM-FENCE-01 recovered PENDING completion does not generic-publish before finalize", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    expect(fixture.matchingCompletionAudit).toBe(false);
    await fixture.recover("WRITER-B");
    expect(fixture.genericPublications).toBe(0);
  });

  test("TERM-FENCE-02 atomic finalize is invoked exactly once", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    await fixture.recover("WRITER-C");
    expect(fixture.atomicFinalizations).toBe(1);
  });

  test("TERM-FENCE-03 same completion request is reused", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    const request = fixture.requests[0];
    await fixture.recover("WRITER-B");
    expect(fixture.requests[0]).toBe(request);
    expect(fixture.requests[0].commandId).toBe("EXCON-1790577652608-1");
  });

  test("TERM-FENCE-04 no duplicate completion request is created", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    expect(fixture.requests).toHaveLength(1);
  });

  test("TERM-FENCE-05 generic completion-fenced publication remains forbidden", () => {
    expect(fenceMigration).toContain("guard_runtime_checkpoint_completion_fence");
    expect(fenceMigration).toContain("COMPLETION_FENCED");
    expect(fenceMigration).toContain("russicaptor.terminal_finalize_command");
  });

  test("TERM-FENCE-06 terminal checkpoint is published through supported finalize path", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    expect(fixture.terminalCheckpoints).toBe(1);
    expect(repositorySource).toContain("finalize_runtime_completion_canonical_payload");
  });

  test("TERM-FENCE-07 request becomes COMPLETED exactly once", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    await fixture.recover("WRITER-C");
    expect(fixture.requests[0].status).toBe("COMPLETED");
    expect(fixture.completionTransitions).toBe(1);
  });

  test("TERM-FENCE-08 exercise becomes terminal exactly once without patient fabrication", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    expect(fixture.exerciseLifecycle).toBe("COMPLETED");
    expect(fixture.terminalEffects).toBe(1);
    expect(fixture.patients.get("P01")).toBe("Active");
    expect(fixture.owners.get("P01")).toBe("CM-B");
  });

  test("TERM-FENCE-09 writer is released after terminalization", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    expect(fixture.activeWriter).toBeUndefined();
    expect(fixture.writerReleases).toBe(1);
  });

  test("TERM-FENCE-10 stale original writer cannot publish or finalize", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    await fixture.recover("WRITER-A");
    expect(fixture.atomicFinalizations).toBe(1);
    expect(fixture.genericPublications).toBe(0);
  });

  test("TERM-FENCE-11 active competing writer prevents recovery", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await expect(fixture.recover("WRITER-B", { competingWriter: "WRITER-A" }))
      .rejects.toThrow("WRITER_AUTHORITY_HELD");
  });

  test("TERM-FENCE-12 restart after terminalization remains terminal", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B");
    expect(structuredClone({ lifecycle: fixture.exerciseLifecycle, request: fixture.requests[0] }))
      .toEqual({ lifecycle: "COMPLETED", request: { commandId: "EXCON-1790577652608-1", status: "COMPLETED" } });
  });

  test("TERM-FENCE-13 already-terminal effect plus stale request reconciles without replay", async () => {
    const fixture = new LegacyTerminalRecoveryFixture();
    await fixture.recover("WRITER-B", { terminalEffectAlreadyExists: true });
    expect(fixture.atomicFinalizations).toBe(1);
    expect(fixture.terminalEffects).toBe(0);
    expect(fixture.requests[0].status).toBe("COMPLETED");
  });

  test("TERM-FENCE-14 takeover recovery awaits completion ownership before routine wake", () => {
    const takeover = syncSource.slice(syncSource.indexOf("export async function takeOverRuntimeWriter"),
      syncSource.indexOf("/** Explicit user recovery"));
    const recovery = syncSource.slice(syncSource.indexOf("async function reacquireRuntimeFromRemoteCheckpointForIntent"),
      syncSource.indexOf("function setAndReturn"));
    for (const source of [takeover, recovery]) {
      expect(source).toContain("await resumeCompletionBeforeRoutinePublication(");
      expect(source).not.toMatch(/resumePendingCompletionForCurrentWriter\?\.\(\);\s*wakeCheckpointPublicationForCurrentWriter\?\.\(\);/);
    }
  });

  test("TERM-FENCE-15 ordinary non-completion publication remains unchanged", async () => {
    const wake = jest.fn();
    await expect(resumeCompletionBeforeRoutinePublication(async () => false, wake))
      .resolves.toBe("ROUTINE_PUBLICATION");
    expect(wake).toHaveBeenCalledTimes(1);
  });

  test("pending discovery arms lifecycle priority and routine requestPublish fails closed", () => {
    const processing = syncSource.slice(syncSource.indexOf("const processCompletionRequest="),
      syncSource.indexOf("const resumePendingCompletion="));
    expect(processing).toContain('if(request.status!=="PENDING")return true;');
    expect(processing).toContain("registerLifecycleCriticalIntent(true)");
    expect(syncSource).toContain('activeCompletion?.status==="PENDING"&&priority==="ROUTINE"');
  });

  test("Realtime reconnect evaluates completion before ordinary publication", () => {
    const reconnect = syncSource.slice(syncSource.indexOf('if(channelStatus==="SUBSCRIBED"'),
      syncSource.indexOf("let signOutReleaseInFlight"));
    expect(reconnect).toContain("resumeCompletionBeforeRoutinePublication");
    expect(reconnect.indexOf("resumeCompletionBeforeRoutinePublication")).toBeLessThan(reconnect.indexOf("requestPublish"));
  });
});
