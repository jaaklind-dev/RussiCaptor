import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261004120000_user_exercise_admin_v1.sql"), "utf8");
const hardening = fs.readFileSync(path.join(root, "supabase/migrations/20261004123000_user_exercise_admin_v1_hardening.sql"), "utf8");
const usersFunction = fs.readFileSync(path.join(root, "supabase/functions/platform-admin-users/index.ts"), "utf8");
const exercisesFunction = fs.readFileSync(path.join(root, "supabase/functions/platform-admin-exercises/index.ts"), "utf8");
const sharedFunction = fs.readFileSync(path.join(root, "supabase/functions/_shared/platformAdmin.ts"), "utf8");

describe("USER-EXERCISE-ADMIN-V1 authority boundary", () => {
  test("AUTH-ADMIN-01/02: platform administrator is separate from CM, EXCON and GLOBAL scope", () => {
    expect(migration).toContain("create table public.platform_admins");
    expect(migration).toContain("create or replace function public.is_platform_admin()");
    expect(migration).not.toMatch(/insert into public\.authorization_role_assignments[\s\S]*?'GLOBAL'/);
    expect(sharedFunction).toContain('.from("platform_admins")');
    expect(sharedFunction).not.toContain("has_authorization_permission");
  });

  test("AUTH-ADMIN-04: client never receives or embeds server credential", () => {
    expect(sharedFunction).toContain('Deno.env.get("SUPABASE_SECRET_KEY")');
    expect(sharedFunction).not.toMatch(/json\([^)]*(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)/);
    expect(usersFunction).not.toContain("service_role");
    expect(exercisesFunction).not.toContain("service_role");
  });

  test("USER-01/03/04/05: user lifecycle uses bounded Auth operations without password material", () => {
    expect(usersFunction).toContain("inviteUserByEmail");
    expect(usersFunction).toContain("resetPasswordForEmail");
    expect(usersFunction).toContain("updateUserById");
    expect(usersFunction).not.toMatch(/\bpassword\s*:/i);
    expect(usersFunction).not.toContain("createUser(");
  });

  test("ROLE-01..08: existing scoped role RPCs are reused and runtime ownership blocks revoke", () => {
    expect(exercisesFunction).toContain('trusted_admin_grant_exercise_role');
    expect(exercisesFunction).toContain('trusted_admin_revoke_exercise_role');
    expect(exercisesFunction).toContain("ACTIVE_RUNTIME_OWNERSHIP_CONFLICT");
    expect(exercisesFunction).toContain("TERMINAL_EXERCISE_READ_ONLY");
    expect(exercisesFunction).not.toContain("authorization_role_assignments\").insert");
  });

  test("AUDIT-01: admin actions are bounded and secret-shaped fields are stripped", () => {
    expect(migration).toContain("create table public.administrative_action_audit");
    expect(migration).toContain("- 'password' - 'token' - 'secret'");
    expect(migration).toMatch(/revoke all on table public\.administrative_action_audit from public, anon, authenticated/);
    expect(usersFunction).toContain('"FAILURE"');
    expect(exercisesFunction).toContain('"FAILURE"');
  });

  test("RLS fail-closed: management tables expose no authenticated table policy", () => {
    expect(migration).toContain("alter table public.platform_admins enable row level security");
    expect(migration).toContain("alter table public.administrative_action_audit enable row level security");
    expect(hardening).toContain("using (false) with check (false)");
    expect(hardening).not.toContain("using (true)");
  });
});
