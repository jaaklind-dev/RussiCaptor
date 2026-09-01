import fs from "node:fs";
import path from "node:path";

const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/202609010002_stale_checkpoint_payload_envelope_fix.sql"),"utf8");

describe("stale checkpoint expired-lease terminal recovery",()=>{
  test("is scoped, locked, and fails closed before it changes lifecycle",()=>{
    expect(sql).toContain("has_authorization_permission('EXERCISE_RUNTIME_RECOVERY',p_exercise_id)");
    expect(sql).toContain("where exercise_id=p_exercise_id for update");
    expect(sql).toContain("from public.runtime_checkpoints where exercise_id=p_exercise_id for update");
    expect(sql).toContain("from public.runtime_writer_leases where exercise_id=p_exercise_id for update");
    expect(sql).toContain("v_lease.expires_at>v_now");
    expect(sql).toContain("CHECKPOINT_INVALID");
    expect(sql).toContain("CHECKPOINT_NOT_STALE");
    expect(sql).toContain("ACTIVE_RUNTIME_PRESENT");
    expect(sql).toContain("payload->'payload'->'exerciseSession'");
  });

  test("only terminalizes a stale valid checkpoint, retains it, and records an auditable reason",()=>{
    expect(sql).toContain("STALE_RUNTIME_TERMINATED");
    expect(sql).toContain("'lifecycleState','COMPLETED'");
    expect(sql).toContain("STALE_CHECKPOINT_EXPIRED_LEASE");
    expect(sql).toContain("checkpoint_revision,projection_revision,recovery_reason");
    expect(sql).toMatch(/update public\.runtime_writer_leases set released_at=v_now/);
    expect(sql).not.toMatch(/insert into public\.runtime_checkpoints/i);
    expect(sql).not.toMatch(/update public\.runtime_checkpoints/i);
  });

  test("does not leave a public callable definer endpoint",()=>{
    expect(sql).toContain("revoke all on function public.terminate_stale_runtime_after_lease_expiry(text) from public");
    expect(sql).toContain("revoke all on function public.terminate_stale_runtime_after_lease_expiry(text) from anon");
    expect(sql).toContain("grant execute on function public.terminate_stale_runtime_after_lease_expiry(text) to authenticated");
  });
});
