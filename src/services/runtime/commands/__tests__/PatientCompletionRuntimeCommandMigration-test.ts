import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql=readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260926143000_add_patient_complete_runtime_patient_command.sql"),"utf8");

describe("PATIENT_COMPLETE additive command migration",()=>{
  test("adds only the empty-payload command to the existing authenticated durable RPC",()=>{
    expect(sql).toContain("'PATIENT_COMPLETE'");
    expect(sql).toContain("p_command_type='PATIENT_COMPLETE' and p_command_payload<>'{}'::jsonb");
    expect(sql).toContain("IDEMPOTENCY_KEY_REUSE");
    expect(sql).toContain("COMPLETION_FENCED");
    expect(sql).toContain("has_authorization_permission('EXCON_EXERCISE_CONTROL'");
    expect(sql).not.toContain("create table");
  });

  test("orders after the current durable ETT whitelist migration without deployment side effects",()=>{
    expect(existsSync(resolve(process.cwd(),
      "supabase/migrations/20260926120000_add_endotracheal_intubation_runtime_patient_command.sql"))).toBe(true);
    expect(sql).toContain("'ENDOTRACHEAL_INTUBATION','PATIENT_COMPLETE'");
    expect(sql).toContain("revoke all on function public.submit_runtime_patient_command");
    expect(sql).toContain("grant execute on function public.submit_runtime_patient_command");
  });
});
