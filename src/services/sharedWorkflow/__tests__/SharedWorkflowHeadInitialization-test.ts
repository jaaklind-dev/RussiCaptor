import fs from "node:fs";
import path from "node:path";

import { getSharedWorkflowHead, resetSharedWorkflowConflictMetrics } from "../SharedWorkflowMutationService";
import {
  ensureSharedWorkflowPatientHeads,
  setSharedWorkflowHeadInitializationGateway,
  SupabaseSharedWorkflowHeadInitializationGateway,
  type SharedWorkflowHeadInitializationGateway,
  type SharedWorkflowHeadInitializationResult,
} from "../SharedWorkflowHeadInitializationService";

const migrationPath = path.resolve(process.cwd(),
  "supabase/migrations/20261006120000_recover_pending_completion_takeover.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

class InMemoryGateway implements SharedWorkflowHeadInitializationGateway {
  readonly heads = new Map<string, SharedWorkflowHeadInitializationResult>();
  calls = 0;
  failure?: Error;

  async ensure(exerciseId: string, patientId: string): Promise<SharedWorkflowHeadInitializationResult> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    const key = `${exerciseId}\u0000${patientId}`;
    const existing = this.heads.get(key);
    if (existing) return Object.freeze({ ...existing, status: "EXISTING" });
    await Promise.resolve();
    const raced = this.heads.get(key);
    if (raced) return Object.freeze({ ...raced, status: "EXISTING" });
    const created = Object.freeze({ status: "INITIALIZED" as const, revision: 0 });
    this.heads.set(key, created);
    return created;
  }
}

describe("WP-NARVA-10B27F shared workflow head initialization", () => {
  let gateway: InMemoryGateway;

  beforeEach(() => {
    resetSharedWorkflowConflictMetrics();
    gateway = new InMemoryGateway();
    setSharedWorkflowHeadInitializationGateway(gateway);
  });
  afterEach(() => setSharedWorkflowHeadInitializationGateway(undefined));

  test("missing EXCON-only patient head is initialized unowned at revision zero", async () => {
    await expect(ensureSharedWorkflowPatientHeads("EX-1", ["PT-1"]))
      .resolves.toEqual([{ status: "INITIALIZED", revision: 0 }]);
    expect(getSharedWorkflowHead("EX-1", "PT-1")).toEqual({ revision: 0 });
  });

  test("repeated startup preserves exactly one existing head", async () => {
    await ensureSharedWorkflowPatientHeads("EX-1", ["PT-1"]);
    await expect(ensureSharedWorkflowPatientHeads("EX-1", ["PT-1", "PT-1"]))
      .resolves.toEqual([{ status: "EXISTING", revision: 0 }]);
    expect(gateway.heads.size).toBe(1);
  });

  test("concurrent initialization converges on one row", async () => {
    await Promise.all([
      ensureSharedWorkflowPatientHeads("EX-1", ["PT-1"]),
      ensureSharedWorkflowPatientHeads("EX-1", ["PT-1"]),
    ]);
    expect(gateway.heads.size).toBe(1);
  });

  test("restart and takeover preserve existing revision, cursor-bearing state and owner", async () => {
    gateway.heads.set("EX-1\u0000PT-1", Object.freeze({ status: "EXISTING", revision: 9, ownerUserId: "CM-A" }));
    await ensureSharedWorkflowPatientHeads("EX-1", ["PT-1"]);
    await ensureSharedWorkflowPatientHeads("EX-1", ["PT-1"]);
    expect(gateway.heads.get("EX-1\u0000PT-1")).toEqual({ status: "EXISTING", revision: 9, ownerUserId: "CM-A" });
    expect(getSharedWorkflowHead("EX-1", "PT-1")).toEqual({ revision: 9, ownerUserId: "CM-A" });
  });

  test("initialization failure is fail-closed", async () => {
    gateway.failure = new Error("COMPLETION_FENCED");
    await expect(ensureSharedWorkflowPatientHeads("EX-1", ["PT-1"]))
      .rejects.toThrow("COMPLETION_FENCED");
    expect(gateway.heads.size).toBe(0);
  });

  test("invalid and empty patient sets never report readiness", async () => {
    await expect(ensureSharedWorkflowPatientHeads("EX-1", [])).rejects
      .toThrow("WORKFLOW_HEAD_INITIALIZATION_INVALID_INPUT");
    await expect(ensureSharedWorkflowPatientHeads("EX-1", [""])).rejects
      .toThrow("WORKFLOW_HEAD_INITIALIZATION_INVALID_INPUT");
  });

  test("Supabase gateway rejects malformed responses", async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ status: "INITIALIZED", revision: -1 }], error: null })) };
    await expect(new SupabaseSharedWorkflowHeadInitializationGateway(client as never).ensure("EX-1", "PT-1"))
      .rejects.toThrow("WORKFLOW_HEAD_INITIALIZATION_INVALID_RESPONSE");
  });

  test("migration authorizes only permanent scoped Runtime recovery callers", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("is_anonymous");
    expect(migration).toContain("has_authorization_permission('EXERCISE_RUNTIME_RECOVERY', p_exercise_id)");
    expect(migration).toMatch(/revoke all on function public\.ensure_shared_workflow_patient_head\(text, text\)[\s\S]*from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.ensure_shared_workflow_patient_head\(text, text\)[\s\S]*to authenticated/);
  });

  test("migration rejects cross-exercise or nonexistent patient identities", () => {
    expect(migration).toContain("where es.exercise_id = p_exercise_id");
    expect(migration).toContain("candidate.value->>'id' = p_patient_id");
    expect(migration).toContain("PATIENT_NOT_FOUND");
    expect(migration).toContain("EXERCISE_NOT_FOUND");
  });

  test("migration shares the terminal transaction fence", () => {
    expect(migration).toMatch(/from public\.exercise_states as es[\s\S]*for update/);
    expect(migration).toContain("EXERCISE_COMPLETED");
    expect(migration).toContain("COMPLETION_FENCED");
    expect(migration.indexOf("for update")).toBeLessThan(migration.indexOf("insert into public.shared_workflow_patient_states"));
  });

  test("pending completion may observe an existing head but cannot initialize a missing head", () => {
    const existingHeadRead = migration.indexOf("select swps.* into v_head");
    const existingReturn = migration.indexOf("return query select 'EXISTING'::text");
    const pendingFence = migration.indexOf("v_completion_status = 'PENDING'");
    const insert = migration.indexOf("insert into public.shared_workflow_patient_states");
    expect(existingHeadRead).toBeGreaterThan(-1);
    expect(existingReturn).toBeGreaterThan(existingHeadRead);
    expect(pendingFence).toBeGreaterThan(existingReturn);
    expect(insert).toBeGreaterThan(pendingFence);
  });

  test("migration inserts unowned revision zero without workflow commands, notifications or leases", () => {
    expect(migration).toMatch(/p_exercise_id, p_patient_id, 0, null, v_initial_state, v_actor/);
    expect(migration).not.toMatch(/insert into public\.shared_workflow_commands/);
    expect(migration).not.toMatch(/insert into public\.shared_workflow_notifications/);
    expect(migration).not.toMatch(/runtime_writer_leases/);
  });

  test("migration uses insert-only conflict handling and never updates an existing head", () => {
    expect(migration).toContain("on conflict (exercise_id, patient_id) do nothing");
    expect(migration).not.toMatch(/update public\.shared_workflow_patient_states/);
    expect(migration).toContain("v_head.revision");
    expect(migration).toContain("v_head.owner_user_id");
  });

  test("initial state is derived from the authoritative exercise projection", () => {
    expect(migration).toContain("v_exercise.state->'patients'");
    for (const field of ["assignments", "transfers", "questions", "labs", "imagingStudies", "orders", "notes",
      "timelineEvents", "interventions", "medicationAdministrations", "vitalSigns"]) {
      expect(migration).toContain(`v_exercise.state->'${field}'`);
    }
  });

  test("Runtime startup, restart and takeover gate command authority on successful initialization", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source.match(/await ensureSharedWorkflowHeadsForCurrentWriter\?\.\(\)/g)).toHaveLength(2);
    expect(source).toContain("await ensureWorkflowHeads()");
    const startup = source.slice(source.indexOf("async function startRuntimeCheckpointSyncForExercise"),
      source.indexOf("let publishInFlight=false"));
    const establishRuntimeOwner = startup.slice(startup.indexOf("const establishRuntimeOwner"),
      startup.indexOf("const ensureWorkflowHeads"));
    expect(startup.indexOf("await ensureWorkflowHeads()")).toBeLessThan(startup.lastIndexOf("establishRuntimeOwner()"));
    expect(establishRuntimeOwner.indexOf("runtimeOwnerGeneration.establish()"))
      .toBeLessThan(establishRuntimeOwner.indexOf("setRuntimeCommandAuthorityWriter(exerciseId)"));
    expect(source).toContain("WORKFLOW_HEAD_INITIALIZATION_FAILED");
  });
});
