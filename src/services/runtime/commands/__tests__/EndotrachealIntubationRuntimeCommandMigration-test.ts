import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260926120000_add_endotracheal_intubation_runtime_patient_command.sql"), "utf8");

describe("durable endotracheal-intubation command migration", () => {
  test("adds one narrow authenticated command envelope without new operational tables", () => {
    expect(sql).toContain("'ENDOTRACHEAL_INTUBATION'");
    expect(sql).toContain("p_command_payload - 'tubeResourceId' - 'laryngoscopeResourceId'");
    expect(sql).toContain("p_command_payload->>'device' not in ('DIRECT','VIDEO')");
    expect(sql).toContain("has_authorization_permission('CM_WORKFLOW_WRITE'");
    expect(sql).toContain("IDEMPOTENCY_KEY_REUSE");
    expect(sql).toContain("COMPLETION_FENCED");
    expect(sql).not.toContain("create table");
  });
});
