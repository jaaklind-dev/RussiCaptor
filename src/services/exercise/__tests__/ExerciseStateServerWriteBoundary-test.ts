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
  test("retired physical acceptance probe cannot be reached from production application or build", () => {
    const root = process.cwd();
    expect(fs.existsSync(path.resolve(root,
      "src/services/runtime/persistence/C11StaleWriterAcceptanceProbe.ts"))).toBe(false);
    expect(fs.existsSync(path.resolve(root,
      "src/components/excon/C11StaleWriterAcceptanceControls.tsx"))).toBe(false);
    const dashboard = fs.readFileSync(path.resolve(root, "src/app/excon/dashboard.tsx"), "utf8");
    const build = fs.readFileSync(path.resolve(root, "scripts/build-field-release.mjs"), "utf8");
    expect(dashboard).not.toMatch(/C11StaleWriter|C11_STALE_WRITER/);
    expect(build).not.toMatch(/C11_STALE_WRITER_PROBE|c11StaleWriterProbe|c11ProbeRequested/);
    expect(client).not.toMatch(/C11StaleWriter|C11_STALE_WRITER/);
    expect(client).toContain('client.rpc("publish_exercise_state_current_writer"');
    expect(migration).toContain("WRITER_GENERATION_STALE");
  });

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

  test("ARCHIVE-01/07 an empty terminal archive list is not a conflict", () => {
    const archive = body("append_completed_exercise_archive");
    expect(archive).toMatch(/v_existing is not null and v_existing <> '\[\]'::jsonb\s+and v_existing <> pg_catalog\.jsonb_build_array\(p_archive\)/);
  });

  test("ARCHIVE-02 first archive is persisted with one archive and one operation receipt", () => {
    const archive = body("append_completed_exercise_archive");
    expect(archive).toContain("state=pg_catalog.jsonb_set(v_state.state,'{completedExerciseArchives}',pg_catalog.jsonb_build_array(p_archive),true)");
    expect(archive).toContain("values(p_exercise_id,p_operation_id,'ARCHIVE',v_hash,v_actor,v_state.revision+1,v_now)");
  });

  test("ARCHIVE-03 exact operation retry returns its original durable result", () => {
    const archive = body("append_completed_exercise_archive");
    expect(archive).toContain("return query select p_exercise_id,v_op.result_revision,v_op.result_updated_at");
    expect(archive.indexOf("return query select p_exercise_id,v_op.result_revision")).toBeLessThan(
      archive.indexOf("update public.exercise_states as es"));
  });

  test("ARCHIVE-04 reused identity with different content remains a conflict", () => {
    const archive = body("append_completed_exercise_archive");
    expect(archive).toContain("v_op.request_hash <> v_hash");
    expect(archive).toContain("OPERATION_ID_CONFLICT");
    expect(archive).toMatch(/v_existing <> pg_catalog\.jsonb_build_array\(p_archive\) then\s+raise exception 'ARCHIVE_CONFLICT'/);
  });

  test("ARCHIVE-05/06 requires terminal lifecycle and exact source revision", () => {
    const archive = body("append_completed_exercise_archive");
    expect(archive).toContain("v_state.revision <> p_expected_revision");
    expect(archive).toContain("exercise_lifecycle_from_state(v_state.state)<>'COMPLETED'");
    expect(archive).toContain("TERMINAL_STATE_REQUIRED");
  });

  test("ARCHIVE-08 one terminal row owns only its own immutable archive", () => {
    const archive = body("append_completed_exercise_archive");
    expect(archive).toContain("p_archive->>'exerciseId' is distinct from p_exercise_id");
    expect(archive).toContain("v_existing = pg_catalog.jsonb_build_array(p_archive)");
    expect(archive).not.toContain("v_existing ||");
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
