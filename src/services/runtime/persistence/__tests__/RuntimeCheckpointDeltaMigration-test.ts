import fs from "node:fs";
import path from "node:path";

describe("WP-EGRESS-03 migration", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260828083146_runtime_checkpoint_delta_hydration.sql"), "utf8");
  test("keeps deltas authenticated, RLS-protected and bounded", () => {
    expect(sql).toContain("alter table public.runtime_checkpoint_deltas enable row level security");
    expect(sql).toContain("to authenticated using (true)");
    expect(sql).toContain("revoke all on table public.runtime_checkpoint_deltas from anon");
    expect(sql).toContain("to_revision <= v_next-32");
  });
  test("publishes full checkpoint, delta and metadata in one writer-checked transaction", () => {
    expect(sql).toContain("create or replace function public.publish_runtime_checkpoint_delta");
    expect(sql).toContain("v_lease.writer_user_id<>auth.uid()");
    expect(sql).toContain("insert into public.runtime_checkpoints");
    expect(sql).toContain("insert into public.runtime_checkpoint_deltas");
    expect(sql).toContain("insert into public.runtime_checkpoint_notifications");
    expect(sql).toContain("p_delta->>'baseHash'<>v_current_hash");
  });
});
