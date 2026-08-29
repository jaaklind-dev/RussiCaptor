import fs from "fs";
import path from "path";

const sql = fs.readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20260829111354_production_operator_identity_authorization.sql"), "utf8");
const hardening = fs.readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20260829124726_production_operator_identity_authorization_hardening.sql"), "utf8");

describe("WP-NEXT-02 production authorization migration", () => {
  test("uses trusted profiles and CM/EXCON assignments without client provisioning", () => {
    expect(sql).toContain("create table if not exists public.operator_profiles");
    expect(sql).toMatch(/role in \('CM','EXCON'\)/);
    expect(sql).toContain("authorization_cm_exercise_scope_check");
    expect(sql).not.toMatch(/create policy[^;]+operator_profiles[^;]+for (insert|update|delete|all)/is);
    expect(sql).not.toMatch(/create policy[^;]+authorization_role_assignments[^;]+for (insert|update|delete|all)/is);
  });

  test("rejects anonymous identities and never authorizes from user metadata", () => {
    expect(sql).toContain("is_anonymous");
    expect(sql).toContain("operator_profiles profile");
    expect(sql).not.toMatch(/user_metadata|raw_user_meta_data/);
  });

  test("enforces exercise scope for shared state and runtime authority writes", () => {
    expect(sql).toContain("scoped operators read exercise state");
    expect(sql).toContain("scoped operators update exercise state");
    expect(sql).toContain("runtime_writer_lease_operator_scope");
    expect(sql).toContain("runtime_checkpoint_operator_scope");
    expect(sql).toContain("AUTHORIZATION_DENIED");
  });

  test("hardens definer helpers and function execution grants", () => {
    expect(sql).toMatch(/security definer set search_path=''/);
    expect(sql).toMatch(/revoke all on function public\.has_authorization_permission[^;]+from public,anon/);
    expect(sql).toMatch(/revoke all on function public\.record_authorization_decision[^;]+from public,anon/);
    expect(sql).toContain("global excon creates import runs");
  });

  test("explicitly rejects anonymous Auth users from identity and Runtime reads", () => {
    expect(hardening).toContain("is_anonymous");
    expect(hardening).toContain("permanent users read own authorization assignments");
    expect(hardening).toContain("scoped operators read runtime checkpoints");
    expect(hardening).toContain("scoped operators read runtime checkpoint deltas");
    expect(hardening).toContain("scoped operators read runtime checkpoint notifications");
  });
});
