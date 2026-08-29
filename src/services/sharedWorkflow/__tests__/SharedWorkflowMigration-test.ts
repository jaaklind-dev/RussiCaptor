import fs from "fs";import path from "path";
const migration=fs.readFileSync(path.resolve(process.cwd(),"supabase/migrations/20260829131400_conflict_safe_multi_cm_shared_workflow.sql"),"utf8");
describe("WP-NEXT-03 migration",()=>{
  it("creates patient-scoped heads, idempotency ledger and metadata notification",()=>{
    expect(migration).toMatch(/create table public\.shared_workflow_patient_states/);
    expect(migration).toMatch(/primary key \(exercise_id, patient_id\)/);
    expect(migration).toMatch(/primary key \(exercise_id, command_id\)/);
    expect(migration).toMatch(/alter publication supabase_realtime add table public\.shared_workflow_notifications/);
  });
  it("keeps mutations behind one scoped authenticated RPC",()=>{
    expect(migration).toMatch(/has_authorization_permission\('CM_WORKFLOW_WRITE',p_exercise_id\)/);
    expect(migration).toMatch(/has_authorization_permission\('EXCON_EXERCISE_CONTROL',p_exercise_id\)/);
    expect(migration).toMatch(/revoke all on function public\.apply_shared_workflow_patient_mutation[\s\S]*from public,anon/);
    expect(migration).toMatch(/security definer set search_path=''/);
    expect(migration).toMatch(/CM patient workflow writes are RPC-only/);
  });
  it("implements stale rejection, ownership enforcement and append merge",()=>{
    expect(migration).toContain("'STALE_VERSION'::text");expect(migration).toContain("'OWNERSHIP_CHANGED'::text");
    expect(migration).toContain("'NOT_OWNER'::text");expect(migration).toContain("'IDEMPOTENT'::text");
    expect(migration).toMatch(/p_mutation_kind='APPEND'[\s\S]*merge_shared_workflow_append/);
    expect(migration).toMatch(/values\(p_exercise_id,p_patient_id,0,null,p_state,v_actor\)/);
    expect(migration).not.toMatch(/values\(p_exercise_id,p_patient_id,0,p_expected_owner_user_id/);
    expect(migration).toMatch(/union all[\s\S]*order by item->>'id', precedence desc/);
    expect(migration).toMatch(/assignment\.role='CM'[\s\S]*assignment\.scope_id=p_exercise_id/);
    expect(migration).toContain("INVALID_TRANSFER_TARGET");
  });
  it("is additive and never rewrites historical exercise or checkpoint rows",()=>{
    expect(migration).not.toMatch(/delete from public\.(exercise_states|runtime_checkpoints)/i);
    expect(migration).not.toMatch(/update public\.(exercise_states|runtime_checkpoints)/i);
    expect(migration).not.toMatch(/drop table/i);
  });
});
