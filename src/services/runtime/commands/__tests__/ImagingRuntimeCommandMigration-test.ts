import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925120000_add_imaging_runtime_patient_command.sql"), "utf8");

describe("I2 durable Imaging command migration", () => {
  test("adds only a validated Imaging order payload to the existing command RPC", () => {
    expect(sql).toContain("'IMAGING_ORDER'");
    expect(sql).toContain("p_command_payload - 'definitionId'");
    expect(sql).toContain("has_authorization_permission('CM_WORKFLOW_WRITE'");
    expect(sql).toContain("IDEMPOTENCY_KEY_REUSE");
    expect(sql).toContain("COMPLETION_FENCED");
    expect(sql).not.toContain("create table");
  });
});
