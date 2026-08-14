import fs from "node:fs"; import path from "node:path";
const migration=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/202608120003_runtime_checkpoint_authority.sql"),"utf8");

describe("WP-44B backend authority migration",()=>{
  test("uses row locks and expected revision CAS",()=>{
    expect(migration).toMatch(/for update/);
    expect(migration).toMatch(/v_current<>p_expected_revision/);
    expect(migration).toMatch(/CHECKPOINT_REVISION_CONFLICT/);
  });
  test("allows no direct checkpoint or lease writes",()=>{
    expect(migration).not.toMatch(/create policy[^;]+runtime_checkpoints[^;]+for (insert|update|delete)/is);
    expect(migration).toMatch(/No direct INSERT\/UPDATE\/DELETE policies/);
  });
  test("guards lease expiry and stale writer",()=>{
    expect(migration).toMatch(/v_lease\.expires_at<=v_now/);
    expect(migration).toMatch(/STALE_WRITER/);
    expect(migration).toMatch(/WRITER_AUTHORITY_HELD/);
  });
  test("publishes one atomic JSON checkpoint and keeps authority audit separate",()=>{
    expect(migration).toMatch(/p_checkpoint jsonb/);
    expect(migration).toMatch(/runtime_checkpoint_authority_audit/);
    expect(migration).not.toMatch(/ScenarioEngine|PatientProcess|ClinicalEffect/);
  });
});
