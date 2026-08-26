import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260826185115_runtime_checkpoint_metadata_realtime.sql"), "utf8");

describe("WP-EGRESS-01 metadata-only Realtime migration", () => {
  test("publishes only the small notification table", () => {
    expect(migration).toContain("alter publication supabase_realtime drop table public.runtime_checkpoints");
    expect(migration).toContain("alter publication supabase_realtime add table public.runtime_checkpoint_notifications");
    expect(migration).not.toMatch(/alter publication supabase_realtime add table public\.runtime_checkpoints/);
  });

  test("updates checkpoint and notification atomically inside the guarded CAS RPC", () => {
    expect(migration).toContain("insert into public.runtime_checkpoints");
    expect(migration).toContain("insert into public.runtime_checkpoint_notifications");
    expect(migration).toContain("v_current<>p_expected_revision");
    expect(migration).toContain("v_lease.expires_at<=v_now");
    expect(migration).toContain("revoke all on function public.publish_runtime_checkpoint(uuid,text,bigint,jsonb) from authenticated");
  });

  test("seeds existing checkpoints and exposes only authenticated metadata reads", () => {
    expect(migration).toContain("from public.runtime_checkpoints");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("grant select on table public.runtime_checkpoint_notifications to authenticated");
    expect(migration).toContain("revoke all on table public.runtime_checkpoint_notifications from anon");
    expect(migration).toContain("revoke all on function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) from anon");
  });
});
