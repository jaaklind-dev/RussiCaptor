import fs from "fs";
import path from "path";

describe("WP-NARVA-09 transport patient-command migration", () => {
  const migration = fs.readFileSync(path.join(process.cwd(),
    "supabase/migrations/20260909123250_add_transport_runtime_patient_command.sql"), "utf8");

  test("adds transport without weakening the existing authenticated ownership, CAS or completion fence", () => {
    expect(migration).toContain("'TRANSPORT_START'");
    expect(migration).toContain("AUTHENTICATION_REQUIRED");
    expect(migration).toContain("CM_WORKFLOW_WRITE");
    expect(migration).toContain("v_head.revision<>p_expected_patient_revision");
    expect(migration).toContain("v_head.owner_user_id is distinct from v_actor");
    expect(migration).toContain("COMPLETION_FENCED");
    expect(migration).toContain("runtime_patient_command_notifications");
  });
});
