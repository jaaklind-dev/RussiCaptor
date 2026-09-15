import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../supabase/migrations/20260915101756_trusted_admin_exercise_role_provisioning.sql",
  ),
  "utf8",
);

describe("trusted-admin exercise role provisioning migration", () => {
  test("exposes only explicit exercise-scoped CM and EXCON lifecycle RPCs", () => {
    expect(migration).toContain("trusted_admin_grant_exercise_role");
    expect(migration).toContain("trusted_admin_revoke_exercise_role");
    expect(migration).toMatch(/p_role is null or p_role not in \('CM', 'EXCON'\)/);
    expect(migration).toContain("scope_type = 'EXERCISE'");
    expect(migration).toContain("ASSIGNMENT_SCOPE_MISMATCH");
    expect(migration).not.toMatch(/insert into public\.authorization_role_assignments[\s\S]+?'GLOBAL'/i);
  });

  test("is service-role only and unavailable to anonymous or ordinary operators", () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/g);
    expect(migration).toMatch(
      /revoke all on function public\.trusted_admin_grant_exercise_role[\s\S]+?from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.trusted_admin_revoke_exercise_role[\s\S]+?from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.trusted_admin_grant_exercise_role[\s\S]+?to service_role;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.trusted_admin_revoke_exercise_role[\s\S]+?to service_role;/,
    );
  });

  test("validates permanent active users, issuer, exercise and expiry server-side", () => {
    expect(migration).toContain("from public.exercise_states as exercise_state");
    expect(migration).toContain("from auth.users as target_user");
    expect(migration).toContain("join public.operator_profiles as target_profile");
    expect(migration).toContain("not target_user.is_anonymous");
    expect(migration).toContain("target_profile.status = 'ACTIVE'");
    expect(migration).toContain("INVALID_ASSIGNMENT_EXPIRY");
    expect(migration).toContain("INVALID_ISSUER");
  });

  test("makes identical grants idempotent and forbids two active duplicates", () => {
    expect(migration).toContain("authorization_role_assignments_one_active_scope_idx");
    expect(migration).toMatch(/where status = 'ACTIVE'/);
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("v_assignment.expires_at is distinct from p_expires_at");
    expect(migration).toContain("ACTIVE_ASSIGNMENT_CONFLICT");
    expect(migration).toMatch(/if found then[\s\S]+?return v_assignment;/);
  });

  test("preserves revoked rows and records issuer/revoker attribution", () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\.authorization_role_assignments/i);
    expect(migration).toMatch(/issued_at,[\s\S]+?expires_at,[\s\S]+?issued_by/);
    expect(migration).toMatch(/status = 'REVOKED',[\s\S]+?revoked_at = v_now,[\s\S]+?revoked_by = p_revoked_by/);
    expect(migration).toContain("if v_assignment.status = 'REVOKED' then");
  });

  test("does not mutate operational Runtime, exercise, checkpoint or workflow tables", () => {
    const operationalWrite =
      /(?:insert\s+into|update|delete\s+from)\s+public\.(?:exercise_states|runtime_[a-z_]+|shared_workflow_patient_states|exercise_completion_requests)/i;
    expect(migration).not.toMatch(operationalWrite);
  });
});
