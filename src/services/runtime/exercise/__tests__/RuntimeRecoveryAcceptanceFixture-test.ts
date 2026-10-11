import fs from "node:fs";
import path from "node:path";

describe("WP-44B Runtime recovery acceptance fixture", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/202608140002_runtime_recovery_acceptance_fixture.sql"),
    "utf8",
  );
  const currentSql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261011090155_exercise_state_server_writer_fence.sql"),
    "utf8",
  );

  test("is admin-only and cannot replace an active canonical exercise", () => {
    expect(sql).toContain("ACTIVE_EXERCISE_PRESENT");
    expect(sql).toContain("order by updated_at desc");
    expect(sql).toContain("runtime_recovery_acceptance_fixture_audit enable row level security");
    expect(sql).toContain("revoke all on function public.create_runtime_recovery_acceptance_fixture() from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.create_runtime_recovery_acceptance_fixture() to service_role");
  });

  test("creates an explicitly nonclinical active identity with no recoverable Runtime authority", () => {
    expect(sql).toContain("'lifecycleState', 'RUNNING'");
    expect(sql).toContain("'patients', '[]'::jsonb");
    expect(sql).not.toMatch(/insert into public\.runtime_checkpoints/i);
    expect(sql).not.toMatch(/insert into public\.runtime_writer_leases/i);
    expect(sql).not.toContain("persistedRuntimeStates");
  });

  test("RECOVERY-FIXTURE-01/02 current fixture uses READY bootstrap rather than direct table INSERT", () => {
    const currentFixture = currentSql.slice(currentSql.indexOf("create function public.create_runtime_recovery_acceptance_fixture"));
    expect(currentFixture).toContain("public.create_initial_exercise_state");
    expect(currentFixture).toContain("public.publish_exercise_state_current_writer");
    expect(currentFixture).not.toMatch(/insert into public\.exercise_states/i);
  });

  test("RECOVERY-FIXTURE-03/04 bootstrap is issued and consumed by the one-shot RPC", () => {
    expect(currentSql).toContain("public.trusted_admin_grant_exercise_bootstrap");
    expect(currentSql).toContain("public.create_initial_exercise_state");
    expect(currentSql).not.toContain("disable trigger");
  });

  test("RECOVERY-FIXTURE-05 writer authority is released before recovery", () => {
    expect(currentSql).toContain("public.release_runtime_writer(v_lease_id,v_writer_instance_id)");
  });

  test("RECOVERY-FIXTURE-06/07 remains test-only and service-role-only", () => {
    expect(currentSql).toMatch(/revoke all on function public\.create_runtime_recovery_acceptance_fixture\(text\)\s+from public, anon, authenticated/);
    expect(currentSql).toContain("grant execute on function public.create_runtime_recovery_acceptance_fixture(text) to service_role");
    expect(currentSql).toContain("runtime_recovery_acceptance_fixture_audit");
  });

  test("RECOVERY-FIXTURE-08 same actor and fixture key return the same audited exercise", () => {
    expect(currentSql).toContain("pg_catalog.md5(v_actor::text || E'\\n' || p_fixture_key)");
    expect(currentSql).toContain("if exists(select 1 from public.runtime_recovery_acceptance_fixture_audit");
  });
});
