import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const migration = fs.readFileSync(path.join(root,
  "supabase/migrations/20261010051206_platform_admin_break_glass_recovery.sql"), "utf8");
const edge = fs.readFileSync(path.join(root,
  "supabase/functions/platform-admin-recovery/index.ts"), "utf8");
const operator = fs.readFileSync(path.join(root, "scripts/platform-admin-recovery.mjs"), "utf8");
const mobile = fs.readFileSync(path.join(root, "src/services/admin/PlatformAdminService.ts"), "utf8");

describe("PLATFORM_ADMIN break-glass recovery boundary", () => {
  test("ADMIN-RECOVERY-01 valid one-time authorization uses one atomic apply RPC", () => {
    expect(migration).toContain("create or replace function public.trusted_admin_apply_platform_recovery");
    expect(migration).toContain("for update;");
    expect(migration).toContain("status = 'CONSUMED', consumed_at = v_now, audit_id = v_audit_id");
  });
  test("ADMIN-RECOVERY-02 grant and audit are in the same database transaction", () => {
    expect(migration).toContain("insert into public.platform_admins");
    expect(migration).toContain("insert into public.administrative_action_audit");
    expect(migration).toContain("'PLATFORM_ADMIN_GRANTED'");
  });
  test("ADMIN-RECOVERY-03 target ID and email must match", () => {
    expect(migration).toContain("v_authorization.target_user_id is distinct from p_target_user_id");
    expect(migration).toContain("v_authorization.target_email is distinct from lower(btrim(p_target_email))");
    expect(migration).toContain("lower(v_target.email) is distinct from v_authorization.target_email");
  });
  test("ADMIN-RECOVERY-04 inactive target is rejected", () => {
    expect(migration).toMatch(/operator_profiles[\s\S]*?status = 'ACTIVE'[\s\S]*?RECOVERY_TARGET_INACTIVE/);
  });
  test("ADMIN-RECOVERY-05 banned target is rejected", () => {
    expect(migration).toContain("v_target.banned_until > v_now");
    expect(migration).toContain("RECOVERY_TARGET_BANNED");
  });
  test("ADMIN-RECOVERY-06 unconfirmed target is rejected", () => {
    expect(migration).toContain("v_target.email_confirmed_at is null");
  });
  test("ADMIN-RECOVERY-07 invalid authorization is rejected", () => {
    expect(migration).toContain("v_authorization.token_sha256 is distinct from p_token_sha256");
    expect(migration).toContain("RECOVERY_AUTHORIZATION_INVALID");
  });
  test("ADMIN-RECOVERY-08 authorization expires within ten minutes", () => {
    expect(migration).toContain("interval '10 minutes'");
    expect(migration).toContain("v_authorization.expires_at <= v_now");
  });
  test("ADMIN-RECOVERY-09 consumed authorization cannot be reused", () => {
    expect(migration).toContain("v_authorization.status <> 'ACTIVE'");
  });
  test("ADMIN-RECOVERY-10 operation ID is unique and grant cannot stack", () => {
    expect(migration).toContain("operation_id uuid not null unique");
    expect(migration).toContain("PLATFORM_ADMIN_ALREADY_ACTIVE");
  });
  test("ADMIN-RECOVERY-11 grant does not create CM", () => {
    expect(migration).not.toContain("'CM'::text");
    expect(migration).not.toContain("trusted_admin_grant_exercise_role");
  });
  test("ADMIN-RECOVERY-12 grant does not create EXCON", () => {
    expect(migration).not.toContain("'EXCON'::text");
  });
  test("ADMIN-RECOVERY-13 grant does not create GLOBAL operational scope", () => {
    expect(migration).not.toContain("'GLOBAL'");
    expect(migration).not.toContain("authorization_role_assignments");
  });
  test("ADMIN-RECOVERY-14 grant does not create a writer lease or patient owner", () => {
    expect(migration).not.toContain("runtime_writer_leases");
    expect(migration).not.toContain("shared_workflow_patient_states");
  });
  test("ADMIN-RECOVERY-15 revoke changes only platform admin state", () => {
    expect(migration).toContain("update public.platform_admins set status = 'REVOKED'");
    expect(migration).not.toContain("update auth.users");
  });
  test("ADMIN-RECOVERY-16 revoke audit is atomic", () => {
    expect(migration).toContain("'PLATFORM_ADMIN_REVOKED'");
    expect(migration).toContain("returning id into v_audit_id");
  });
  test("ADMIN-RECOVERY-17 revoke preserves Auth account", () => {
    expect(migration).not.toMatch(/delete\s+from\s+auth\.users/i);
  });
  test("ADMIN-RECOVERY-18 unrelated scoped roles remain untouched", () => {
    expect(migration).not.toContain("trusted_admin_revoke_exercise_role");
    expect(migration).not.toMatch(/update\s+public\.authorization_role_assignments/i);
  });
  test("ADMIN-RECOVERY-19 credential is absent from mobile Admin gateway", () => {
    expect(mobile).not.toContain("platform-admin-recovery");
    expect(mobile).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edge).toContain('Deno.env.get("SUPABASE_URL")');
    expect(edge).toContain("verifyRecoveryOperator(request");
    expect(operator).toContain('"find-generic-password", "-w"');
    expect(operator).not.toContain("console.log(prepared)");
  });
  test("ADMIN-RECOVERY-20 replay and old unaudited paths fail closed", () => {
    expect(migration).toContain("v_authorization.operation_id is distinct from p_operation_id");
    expect(migration).toMatch(/revoke all on function public\.trusted_admin_grant_platform_admin\(uuid, uuid\)[\s\S]*?service_role/);
    expect(migration).toMatch(/revoke all on function public\.trusted_admin_revoke_platform_admin\(uuid, uuid\)[\s\S]*?service_role/);
  });
  test("operator endpoint requires server credential for every action and never logs requests", () => {
    expect(edge).toContain("requireTrustedOperator(request)");
    expect(edge).toContain("tokenSha256(token)");
    expect(edge).toContain('"Cache-Control": "no-store"');
    expect(edge).not.toContain("console.");
  });
  test("lost response is resolved by bounded status instead of replay", () => {
    expect(migration).toContain("trusted_admin_platform_recovery_status");
    expect(operator).toContain('call({ action: "status", operationId })');
    expect(operator).toContain('status: "CONFIRMED_AFTER_LOST_RESPONSE"');
  });
});
