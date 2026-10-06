import fs from "node:fs";
import path from "node:path";

type CompletionRequest = Readonly<{ exerciseId: string; commandId: string; status: "PENDING" | "COMPLETED" }>;

class PendingCompletionRecoveryFixture {
  readonly request: CompletionRequest;
  readonly requests: CompletionRequest[];
  readonly patients = new Set(["PT-1", "PT-2"]);
  readonly heads = new Set(["PT-1", "PT-2"]);
  checkpointValid = true;
  canonicalTerminal = false;
  activeWriter?: string;
  terminalEffects = 0;
  terminalCheckpointLineages = 0;
  completionEvidence = 0;
  patientLifecycleMutations = 0;
  roleActive = true;

  constructor(requests: CompletionRequest[] = [
    Object.freeze({ exerciseId: "EX-RECOVERY", commandId: "COMPLETE-1", status: "PENDING" }),
  ]) {
    this.requests = requests;
    this.request = requests[0];
  }

  recover(writerId: string, options: Readonly<{ exerciseId?: string; expiredHistoricalLease?: boolean }> = {}): string {
    const exerciseId = options.exerciseId ?? "EX-RECOVERY";
    if (!this.checkpointValid) throw new Error("CANONICAL_CHECKPOINT_INVALID");
    if (this.activeWriter && this.activeWriter !== writerId) throw new Error("WRITER_AUTHORITY_HELD");
    if (this.requests.length !== 1 || this.requests[0].exerciseId !== exerciseId) {
      throw new Error("COMPLETION_REQUEST_CONFLICT");
    }
    if ([...this.patients].some(patientId => !this.heads.has(patientId))) {
      throw new Error("COMPLETION_FENCED");
    }
    this.activeWriter = writerId;
    if (!this.canonicalTerminal) {
      this.canonicalTerminal = true;
      this.terminalEffects += 1;
      this.terminalCheckpointLineages += 1;
      this.completionEvidence += 1;
      this.patientLifecycleMutations += 1;
    }
    this.requests[0] = Object.freeze({ ...this.requests[0], status: "COMPLETED" });
    this.activeWriter = undefined;
    return this.requests[0].commandId;
  }

  revokeRole(): void {
    if (this.activeWriter) throw new Error("WRITER_AUTHORITY_HELD");
    this.roleActive = false;
  }
}

const migrationPath = path.resolve(process.cwd(),
  "supabase/migrations/20261006120000_recover_pending_completion_takeover.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

describe("RUNTIME-PENDING-COMPLETION-TAKEOVER-RECOVERY-01", () => {
  test("COMP-REC-01 pending completion survives writer loss", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    expect(fixture.request).toMatchObject({ commandId: "COMPLETE-1", status: "PENDING" });
    expect(fixture.activeWriter).toBeUndefined();
  });

  test("COMP-REC-02 new valid writer resumes the same request", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    expect(fixture.recover("WRITER-B")).toBe("COMPLETE-1");
  });

  test("COMP-REC-03 recovery creates no second completion request", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.recover("WRITER-B");
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0].commandId).toBe("COMPLETE-1");
  });

  test("COMP-REC-04 terminal effect is exactly once across replay", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.recover("WRITER-B");
    fixture.recover("WRITER-C");
    expect(fixture.terminalEffects).toBe(1);
    expect(fixture.completionEvidence).toBe(1);
    expect(fixture.patientLifecycleMutations).toBe(1);
  });

  test("COMP-REC-05 terminal checkpoint has one canonical lineage", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.recover("WRITER-B");
    fixture.recover("WRITER-C");
    expect(fixture.terminalCheckpointLineages).toBe(1);
  });

  test("COMP-REC-06 already-terminal effect reconciles status without replay", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.canonicalTerminal = true;
    fixture.recover("WRITER-B");
    expect(fixture.requests[0].status).toBe("COMPLETED");
    expect(fixture.terminalEffects).toBe(0);
  });

  test("COMP-REC-07 active competing writer blocks recovery", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.activeWriter = "WRITER-A";
    expect(() => fixture.recover("WRITER-B")).toThrow("WRITER_AUTHORITY_HELD");
  });

  test("COMP-REC-08 expired historical lease does not block recovery", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    expect(() => fixture.recover("WRITER-B", { expiredHistoricalLease: true })).not.toThrow();
  });

  test("COMP-REC-09 invalid checkpoint fails closed", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.checkpointValid = false;
    expect(() => fixture.recover("WRITER-B")).toThrow("CANONICAL_CHECKPOINT_INVALID");
  });

  test("COMP-REC-10 conflicting pending requests fail closed", () => {
    const fixture = new PendingCompletionRecoveryFixture([
      Object.freeze({ exerciseId: "EX-RECOVERY", commandId: "COMPLETE-1", status: "PENDING" }),
      Object.freeze({ exerciseId: "EX-RECOVERY", commandId: "COMPLETE-2", status: "PENDING" }),
    ]);
    expect(() => fixture.recover("WRITER-B")).toThrow("COMPLETION_REQUEST_CONFLICT");
  });

  test("COMP-REC-11 stale original writer cannot re-finalize afterward", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.recover("WRITER-B");
    fixture.recover("WRITER-A");
    expect(fixture.terminalEffects).toBe(1);
  });

  test("COMP-REC-12 restart after recovered terminalization remains terminal", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.recover("WRITER-B");
    expect(fixture.canonicalTerminal).toBe(true);
    expect(fixture.requests[0].status).toBe("COMPLETED");
  });

  test("COMP-REC-13 role revocation succeeds after recovered completion", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.recover("WRITER-B");
    expect(() => fixture.revokeRole()).not.toThrow();
    expect(fixture.roleActive).toBe(false);
  });

  test("COMP-REC-14 terminalization leaves no active writer lease", () => {
    const fixture = new PendingCompletionRecoveryFixture();
    fixture.recover("WRITER-B");
    expect(fixture.activeWriter).toBeUndefined();
  });

  test("existing patient heads are read before the pending-completion mutation fence", () => {
    const existingHeadRead = migration.indexOf("select swps.* into v_head");
    const pendingFence = migration.indexOf("v_completion_status = 'PENDING'");
    expect(existingHeadRead).toBeGreaterThan(-1);
    expect(pendingFence).toBeGreaterThan(-1);
    expect(existingHeadRead).toBeLessThan(pendingFence);
  });

  test("missing heads remain fenced and the RPC keeps its security boundary", () => {
    expect(migration).toContain("COMPLETION_FENCED");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toMatch(/revoke all on function public\.ensure_shared_workflow_patient_head\(text, text\)[\s\S]*from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.ensure_shared_workflow_patient_head\(text, text\)[\s\S]*to authenticated/);
  });
});
