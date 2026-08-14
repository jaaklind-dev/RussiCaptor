import fs from "node:fs";
import path from "node:path";

describe("WP-44B Runtime recovery acceptance fixture", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/202608140002_runtime_recovery_acceptance_fixture.sql"),
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
});
