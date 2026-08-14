import fs from "node:fs"; import path from "node:path";
describe("WP-44B recovery backend contract",()=>{const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/202608140001_runtime_missing_recovery.sql"),"utf8");
  test("permission remains EXCON assignment scoped and backend enforced",()=>{expect(sql).toContain("has_authorization_permission('EXERCISE_RUNTIME_RECOVERY',p_exercise_id)");expect(sql).toContain("assignment.scope_type='EXERCISE' and p_exercise_id is not null and assignment.scope_id=p_exercise_id");});
  test("atomic command locks lifecycle, checkpoint and lease state",()=>{expect(sql).toContain("where exercise_id=p_exercise_id for update");expect(sql).toContain("RUNTIME_CHECKPOINT_AVAILABLE");expect(sql).toContain("ACTIVE_RUNTIME_WRITER_PRESENT");});
  test("recovery updates lifecycle and audit but never creates a Runtime checkpoint",()=>{expect(sql).toContain("'lifecycleState','COMPLETED'");expect(sql).toContain("exercise_runtime_recovery_audit");expect(sql).not.toMatch(/insert into public\.runtime_checkpoints/i);});
});
