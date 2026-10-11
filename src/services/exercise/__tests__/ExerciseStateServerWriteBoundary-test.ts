import fs from "node:fs";
import path from "node:path";

import { exerciseStateMutationErrorCode } from "@/services/CloudSyncService";

const migration = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20261011090155_exercise_state_server_writer_fence.sql"), "utf8");
const client = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");

function body(name: string): string {
  const match = migration.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!match) throw new Error(`Missing ${name} RPC`);
  return match[0];
}

describe("exercise_states server mutation boundary", () => {
  test("EXSTATE-AUTH-01/02/05 current lease and caller are checked under a row lock", () => {
    const sql = body("publish_exercise_state_current_writer");
    expect(sql).toMatch(/runtime_writer_leases as lease[\s\S]*?for update/);
    expect(sql).toContain("v_lease.lease_id is distinct from p_lease_id");
    expect(sql).toContain("v_lease.writer_instance_id is distinct from p_writer_instance_id");
    expect(sql).toContain("v_lease.writer_user_id is distinct from v_actor");
    expect(sql.indexOf("from public.runtime_writer_leases as lease")).toBeLessThan(
      sql.indexOf("update public.exercise_states as es"));
  });

  test("EXSTATE-AUTH-03/04 expired or released writer cannot publish", () => {
    const sql = body("publish_exercise_state_current_writer");
    expect(sql).toContain("v_lease.released_at is not null");
    expect(sql).toContain("v_lease.expires_at <= v_now");
    expect(sql.indexOf("where lease.exercise_id=p_exercise_id for update")).toBeLessThan(
      sql.indexOf("v_now := clock_timestamp()"));
    expect(sql.indexOf("v_now := clock_timestamp()")).toBeLessThan(
      sql.indexOf("v_lease.expires_at <= v_now"));
    expect(sql.indexOf("v_lease.expires_at <= v_now")).toBeLessThan(
      sql.indexOf("from public.exercise_state_publication_operations as op"));
  });

  test("EXSTATE-AUTH-06/B handoff is independently server-fenced", () => {
    const sql = body("publish_exercise_state_current_writer");
    expect(sql).toContain("WRITER_GENERATION_STALE");
    expect(sql).toContain("p_expected_revision");
    expect(sql).toContain("REVISION_CONFLICT");
    expect(client).toContain('client.rpc("publish_exercise_state_current_writer"');
    expect(client).toContain("p_lease_id: publicationStamp.writerLeaseId");
  });

  test("EXSTATE-BOOT-01..04 READY creation is one-shot and operation-idempotent", () => {
    const sql = body("create_initial_exercise_state");
    expect(sql).toContain("exercise_lifecycle_from_state(p_state) <> 'READY'");
    expect(sql).toContain("if exists(select 1 from public.exercise_states");
    expect(sql).toContain("p_bootstrap_authorization_id");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("OPERATION_ID_CONFLICT");
    expect(sql).toContain("BOOTSTRAP_CONSUMPTION_FAILED");
  });

  test("EXSTATE-TERM-01..04 terminal fence and archive preserve completion authority", () => {
    const active = body("publish_exercise_state_current_writer");
    const terminal = body("reconcile_terminal_exercise_state");
    const archive = body("append_completed_exercise_archive");
    expect(active).toContain("TERMINAL_DOMINATES");
    expect(active).toContain("PUBLICATION_FENCED");
    expect(terminal).toContain("v_request.status <> 'COMPLETED'");
    expect(terminal).toContain("v_request.terminal_payload_hash is distinct from v_checkpoint.payload_hash");
    expect(terminal).toContain("russicaptor.terminal_finalize_command");
    expect(archive).toContain("TERMINAL_STATE_REQUIRED");
    expect(archive).toContain("russicaptor.terminal_finalize_command");
  });

  test("EXSTATE-SEC-01/02 authenticated direct INSERT and UPDATE are revoked", () => {
    expect(migration).toContain("revoke insert, update, delete on public.exercise_states from public, anon, authenticated;");
    expect(migration).toContain('drop policy if exists "excon creates exercise state"');
    expect(migration).toContain('drop policy if exists "excon updates exercise state"');
    expect(client).not.toMatch(/\.from\("exercise_states"\)\.(?:insert|upsert|update|delete)\(/);
  });

  test("EXSTATE-SEC-03/04 RPCs check exercise permission and caller identity", () => {
    const active = body("publish_exercise_state_current_writer");
    expect(active).toContain("public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id)");
    expect(active).toContain("p_state->'exerciseSession'->>'exerciseId' is distinct from p_exercise_id");
    expect(active).toContain("v_lease.writer_user_id is distinct from v_actor");
    expect(migration).toContain("revoke all on function public.publish_exercise_state_current_writer");
  });

  test("bounded client diagnostics do not surface arbitrary server internals", () => {
    expect(exerciseStateMutationErrorCode("WRITER_GENERATION_STALE")).toBe("WRITER_GENERATION_STALE");
    expect(exerciseStateMutationErrorCode("raw database credential")).toBe("EXERCISE_STATE_WRITE_FAILED");
  });
});
