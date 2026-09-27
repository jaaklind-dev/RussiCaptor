import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260927120000_add_patient_location_transfer_runtime_patient_command.sql"), "utf8");

describe("PATIENT_LOCATION_TRANSFER additive command migration", () => {
  test("extends only the command whitelist using the supported migration ledger", () => {
    expect(sql).toContain("'PATIENT_LOCATION_TRANSFER'");
    expect(sql).toContain("public.runtime_patient_commands");
    expect(sql).toContain("public.submit_runtime_patient_command");
    expect(sql).not.toMatch(/drop\s+table|truncate|delete\s+from|disable\s+row\s+level\s+security/iu);
  });
});
