import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260906055258_package_projection_divergence_recovery.sql"),
  "utf8",
);

describe("package projection divergence recovery migration", () => {
  test("active projection package identity is immutable at the database boundary", () => {
    expect(sql).toContain("enforce_active_exercise_package_identity");
    expect(sql).toContain("ACTIVE_EXERCISE_PACKAGE_IDENTITY_CONFLICT");
    expect(sql).toContain("before update on public.exercise_states");
    expect(sql).toContain("v_old_lifecycle not in ('RUNNING', 'PAUSED')");
  });

  test("recovery is scoped, locked and rechecks the validated envelope expectations", () => {
    expect(sql).toContain("has_authorization_permission('EXERCISE_RUNTIME_RECOVERY', p_exercise_id)");
    expect(sql.match(/for update;/g)?.length).toBeGreaterThanOrEqual(3);
    for (const value of [
      "p_expected_projection_revision", "p_expected_checkpoint_revision", "p_expected_payload_hash",
      "p_expected_provenance_hash", "NEWER_CHECKPOINT_EXISTS", "ACTIVE_LEASE_PRESENT",
      "CHECKPOINT_INVALID", "SESSION_VERSION_MISMATCH", "LIFECYCLE_CONFLICT", "PACKAGE_IDENTITY_AMBIGUOUS",
    ]) expect(sql).toContain(value);
  });

  test("safe terminalization preserves checkpoint evidence and is audited/idempotent", () => {
    expect(sql).toContain("TERMINALIZED_DIVERGENT_STATE");
    expect(sql).toContain("ALREADY_TERMINAL");
    expect(sql).toContain("'PACKAGE_PROJECTION_DIVERGENCE'");
    expect(sql).toContain("insert into public.exercise_runtime_recovery_audit");
    expect(sql).not.toMatch(/delete from public\.(runtime_checkpoints|exercise_states)/i);
    expect(sql).not.toMatch(/update public\.runtime_checkpoints/i);
  });

  test("definer RPC has a fixed search path and is authenticated-only", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("from public");
    expect(sql).toContain("from anon");
    expect(sql).toContain("to authenticated");
  });
});
