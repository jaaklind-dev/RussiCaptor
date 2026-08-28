import fs from "node:fs";
import path from "node:path";

describe("WP-EGRESS-04 byte-budget migration", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260828111809_runtime_checkpoint_delta_byte_budget.sql"), "utf8");

  test("adds and backfills lightweight byte metadata without changing payload authority", () => {
    expect(sql).toContain("alter table public.runtime_checkpoints add column payload_bytes bigint");
    expect(sql).toContain("add column payload_bytes bigint");
    expect(sql).toContain("alter table public.runtime_checkpoint_notifications add column checkpoint_bytes bigint");
    expect(sql).toContain("octet_length(payload::text)");
    expect(sql).toContain("octet_length(delta_payload::text)");
  });

  test("maintains checkpoint and delta byte sizes inside both authoritative publication transactions", () => {
    expect(sql).toContain("create or replace function public.publish_runtime_checkpoint_metadata");
    expect(sql).toContain("create or replace function public.publish_runtime_checkpoint_delta");
    expect(sql).toContain("v_checkpoint_bytes bigint:=octet_length(p_checkpoint::text)");
    expect(sql).toContain("v_delta_bytes bigint:=octet_length(p_delta::text)");
    expect(sql).toContain("checkpoint_bytes=excluded.checkpoint_bytes");
  });

  test("preserves authenticated RPC grants and denies anonymous execution", () => {
    expect(sql).toContain("revoke all on function public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb) from anon");
    expect(sql).toContain("grant execute on function public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb) to authenticated");
    expect(sql).toContain("v_lease.writer_user_id<>auth.uid()");
  });
});
