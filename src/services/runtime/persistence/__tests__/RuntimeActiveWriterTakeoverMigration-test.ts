import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(path.join(process.cwd(),
  "supabase/migrations/20261012102900_atomic_active_writer_takeover.sql"), "utf8");
const client = fs.readFileSync(path.join(process.cwd(),
  "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
const writerFence = fs.readFileSync(path.join(process.cwd(),
  "supabase/migrations/20261011090155_exercise_state_server_writer_fence.sql"), "utf8");
const takeover = migration.slice(migration.indexOf("create function public.takeover_runtime_writer("));

describe("explicit active-writer takeover contract", () => {
  test("TAKEOVER-ORDER-01 ordinary acquire still rejects another active writer", () => {
    expect(migration).toContain("raise exception 'WRITER_AUTHORITY_HELD'");
    expect(migration).toContain("v_revision <> p_expected_revision");
  });
  test("TAKEOVER-ORDER-02 explicit takeover replaces an active lease", () => {
    expect(takeover).toContain("update public.runtime_writer_leases lease");
    expect(takeover).not.toContain("WRITER_AUTHORITY_HELD");
  });
  test("TAKEOVER-ORDER-03 each new lease ID advances generation once", () => {
    expect(migration).toContain("if new.lease_id is distinct from old.lease_id then");
    expect(migration).toContain("new.writer_generation := old.writer_generation + 1");
  });
  test("TAKEOVER-ORDER-04 no canonical payload or revision is updated by takeover", () => {
    expect(takeover).not.toMatch(/update public\.runtime_checkpoints|update public\.exercise_states/);
    expect(takeover).toContain("v_checkpoint.checkpoint_revision");
  });
  test("TAKEOVER-ORDER-05 a stale reader revision is not used as a write precondition", () => {
    expect(takeover).not.toContain("p_expected_revision");
    expect(client).toContain("acquired.checkpointRevision");
  });
  test("TAKEOVER-ORDER-06 checkpoint publication and takeover lock lease first", () => {
    expect(takeover.indexOf("from public.runtime_writer_leases lease\n    where lease.exercise_id = p_exercise_id for update"))
      .toBeLessThan(takeover.indexOf("from public.runtime_checkpoints checkpoint\n    where checkpoint.exercise_id = p_exercise_id for share"));
  });
  test("TAKEOVER-ORDER-07 stale A is fenced by replacing the lease UUID", () => {
    expect(takeover).toContain("set lease_id = gen_random_uuid()");
    expect(writerFence).toContain("WRITER_GENERATION_STALE");
  });
  test("TAKEOVER-ORDER-08 concurrent contenders compare the same observed lease", () => {
    expect(takeover).toContain("v_lease.lease_id <> p_expected_prior_lease_id");
    expect(takeover).toContain("TAKEOVER_CONCURRENT_CONFLICT");
  });
  test("TAKEOVER-ORDER-09 one primary-key lease row remains authoritative", () => {
    expect(takeover).toContain("where lease.exercise_id = p_exercise_id returning * into v_lease");
    expect(takeover).not.toContain("insert into public.runtime_writer_leases");
  });
  test("TAKEOVER-ORDER-10 caller requires authenticated EXCON exercise scope", () => {
    expect(takeover).toContain("assignment.role = 'EXCON'");
    expect(takeover).toContain("assignment.scope_type = 'EXERCISE'");
    expect(takeover).toContain("assignment.scope_id = p_exercise_id");
  });
  test("TAKEOVER-ORDER-11 CM-only caller cannot satisfy the exact EXCON predicate", () => {
    expect(takeover).not.toContain("CM_WORKFLOW_WRITE");
    expect(takeover).toContain("has_authorization_permission('EXCON_EXERCISE_CONTROL'");
  });
  test("TAKEOVER-ORDER-12 terminal exercise is not eligible", () => {
    expect(takeover).toContain("not in ('RUNNING','PAUSED')");
    expect(takeover).toContain("= 'COMPLETED'");
  });
  test("TAKEOVER-ORDER-13 same writer retry returns the same lease", () => {
    expect(takeover).toContain("v_lease.writer_instance_id = p_writer_instance_id and v_lease.writer_user_id = v_actor");
    expect(takeover).toContain("v_lease.expires_at, false");
  });
  test("TAKEOVER-ORDER-14 B receives latest revision and rehydrates A's late publication", () => {
    expect(takeover).toContain("v_checkpoint.checkpoint_revision, v_checkpoint.payload_hash");
    expect(client).toContain("fresh=await loadRuntimeCheckpointWithCache");
    expect(client).toContain("canonicalCheckpoint=fresh");
  });
});
