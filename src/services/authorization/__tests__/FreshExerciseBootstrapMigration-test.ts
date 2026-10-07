import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260916053734_fresh_exercise_bootstrap_authorization.sql"),
  "utf8",
);
const hardening = fs.readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260916055045_harden_fresh_exercise_bootstrap_authorization.sql"),
  "utf8",
);
const insertClaim = fs.readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260916080600_allow_bootstrap_insert_claim.sql"),
  "utf8",
);
const separatedAuthority = fs.readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260916081500_separate_bootstrap_insert_authority.sql"),
  "utf8",
);
const insertAuthorityFix = fs.readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260916084800_fix_bootstrap_insert_authorization_helper.sql"),
  "utf8",
);
const consumedRevokeFence = fs.readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20261007120000_refuse_consumed_bootstrap_revocation.sql"),
  "utf8",
);
const adminExercisesEdge = fs.readFileSync(
  path.resolve(__dirname, "../../../../supabase/functions/platform-admin-exercises/index.ts"), "utf8",
);

describe("fresh-exercise bootstrap authorization migration", () => {
  test("uses dedicated one-shot bootstrap authority rather than GLOBAL EXCON", () => {
    expect(migration).toContain("exercise_bootstrap_authorizations");
    expect(migration).toContain("trusted_admin_grant_exercise_bootstrap");
    expect(migration).toContain("trusted_admin_revoke_exercise_bootstrap");
    expect(migration).toContain("consumed_exercise_id is null");
    expect(migration).toContain("consumed_exercise_id = new.exercise_id");
    expect(migration).not.toMatch(/insert into public\.authorization_role_assignments/i);
  });

  test("allows only an initial READY projection and never Runtime authority", () => {
    expect(migration).toContain("new.revision <> 1");
    expect(migration).toContain("'lifecycleState' is distinct from 'READY'");
    expect(migration).toContain("'simulationTimeSec' is distinct from '0'");
    expect(migration).toContain("'lastCommandId', '') not like 'PREPARE-%'");
    expect(migration).not.toMatch(/(?:insert into|update|delete from) public\.(?:runtime_[a-z_]+|shared_workflow_patient_states|exercise_completion_requests)/i);
    const bootstrapPolicy = migration.slice(
      migration.indexOf('create policy "operator reads own exercise bootstrap authorization"'),
      migration.indexOf("revoke all on table public.exercise_bootstrap_authorizations"),
    );
    expect(bootstrapPolicy).not.toMatch(/for (insert|update|delete|all) to authenticated/i);
  });

  test("is unavailable to anon, ordinary authenticated operators and self-grant", () => {
    expect(migration).toMatch(/revoke all on function public\.trusted_admin_grant_exercise_bootstrap[\s\S]+?from public, anon, authenticated;/);
    expect(migration).toMatch(/revoke all on function public\.trusted_admin_revoke_exercise_bootstrap[\s\S]+?from public, anon, authenticated;/);
    expect(migration).toMatch(/grant execute on function public\.trusted_admin_grant_exercise_bootstrap[\s\S]+?to service_role;/);
    expect(migration).toMatch(/grant execute on function public\.trusted_admin_revoke_exercise_bootstrap[\s\S]+?to service_role;/);
    const trustedAdminGrants = migration.split(";").filter(statement =>
      /grant execute on function public\.trusted_admin_(?:grant|revoke)_exercise_bootstrap/i.test(statement));
    expect(trustedAdminGrants).toHaveLength(2);
    expect(trustedAdminGrants.every(statement => /to service_role\s*$/i.test(statement.trim()))).toBe(true);
  });

  test("is short-lived, idempotent, concurrency-safe and preserves audit rows", () => {
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toContain("exercise_bootstrap_one_active_per_user_idx");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("ACTIVE_BOOTSTRAP_CONFLICT");
    expect(migration).toMatch(/if found then[\s\S]+?return v_authorization;/);
    expect(migration).toContain("if v_authorization.status = 'REVOKED' then");
    expect(migration).not.toMatch(/delete\s+from\s+public\.exercise_bootstrap_authorizations/i);
    expect(migration).toMatch(/issued_at[\s\S]+?issued_by[\s\S]+?consumed_at[\s\S]+?revoked_at[\s\S]+?revoked_by/);
  });

  test("revocation removes creation authority while retaining the consumed exercise binding", () => {
    expect(migration).toMatch(/set status = 'REVOKED',[\s\S]+?revoked_at = v_now,[\s\S]+?revoked_by = p_revoked_by/);
    expect(migration).toMatch(/bootstrap\.status = 'ACTIVE'[\s\S]+?bootstrap\.expires_at > now\(\)/);
    expect(migration).not.toMatch(/set consumed_exercise_id = null/i);
  });

  test("keeps the read-only predicate invoker-scoped and explicitly excludes anonymous users", () => {
    expect(hardening).toMatch(/has_exercise_bootstrap_authorization[\s\S]+?security invoker/);
    expect(hardening).toContain("not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)");
    expect(hardening).toMatch(/for select to authenticated[\s\S]+?user_id = \(select auth\.uid\(\)\)/);
    expect(hardening).not.toMatch(/security definer/i);
  });

  test("allows the initial policy check before atomic binding and fails replay closed", () => {
    expect(insertClaim).toMatch(/has_exercise_bootstrap_authorization[\s\S]+?security invoker/);
    expect(insertClaim).toContain("bootstrap.consumed_exercise_id is null");
    expect(insertClaim).toContain("bootstrap.consumed_exercise_id = p_exercise_id");
    expect(insertClaim).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(insertClaim).toMatch(/if not found then\s+raise exception 'BOOTSTRAP_AUTHORIZATION_REQUIRED'/);
    expect(insertClaim).toContain("consumed_exercise_id = new.exercise_id");
    expect(insertClaim).not.toMatch(/insert into public\.authorization_role_assignments/i);
  });

  test("separates unconsumed create authority from exact bound-row read authority", () => {
    const readPredicate = separatedAuthority.slice(
      separatedAuthority.indexOf("create or replace function public.has_exercise_bootstrap_authorization"),
      separatedAuthority.indexOf("create or replace function public.has_unconsumed_exercise_bootstrap_authorization"),
    );
    expect(readPredicate).toContain("bootstrap.consumed_exercise_id = p_exercise_id");
    expect(readPredicate).not.toContain("bootstrap.consumed_exercise_id is null");
    expect(separatedAuthority).toMatch(/has_unconsumed_exercise_bootstrap_authorization[\s\S]+?bootstrap\.consumed_exercise_id is null/);
    expect(separatedAuthority).toMatch(/create policy "excon creates exercise state"[\s\S]+?has_unconsumed_exercise_bootstrap_authorization\(\)/);
    expect(separatedAuthority).not.toMatch(/create policy[\s\S]+?for select[\s\S]+?has_unconsumed_exercise_bootstrap_authorization/i);
  });

  test("checks bootstrap INSERT authority across the atomic trigger binding boundary", () => {
    expect(insertAuthorityFix).toMatch(/has_exercise_bootstrap_insert_authorization[\s\S]+?security definer/);
    expect(insertAuthorityFix).toContain("bootstrap.consumed_exercise_id is null");
    expect(insertAuthorityFix).toContain("bootstrap.consumed_exercise_id = p_exercise_id");
    expect(insertAuthorityFix).toMatch(/create policy "excon creates exercise state"[\s\S]+?has_exercise_bootstrap_insert_authorization\(exercise_id\)/);
    expect(insertAuthorityFix).toMatch(/revoke all on function public\.has_exercise_bootstrap_insert_authorization\(text\)[\s\S]+?from public, anon/);
    expect(insertAuthorityFix).toMatch(/grant execute on function public\.has_exercise_bootstrap_insert_authorization\(text\)[\s\S]+?to authenticated/);
    expect(insertAuthorityFix).not.toMatch(/(?:insert into|update|delete from) public\.(?:runtime_[a-z_]+|shared_workflow_patient_states|exercise_completion_requests)/i);
  });

  test("ADMIN-DIRECT-PUB-14/15 exact unused bootstrap revoke is atomic, idempotent, and audited", () => {
    expect(consumedRevokeFence).toContain("where bootstrap.id = p_bootstrap_id");
    expect(consumedRevokeFence).toContain("for update");
    expect(consumedRevokeFence.indexOf("BOOTSTRAP_ALREADY_CONSUMED"))
      .toBeLessThan(consumedRevokeFence.indexOf("if v_authorization.status = 'REVOKED'"));
    expect(consumedRevokeFence).toContain("if v_authorization.status = 'REVOKED' then");
    expect(consumedRevokeFence).not.toMatch(/delete\s+from\s+public\.exercise_bootstrap_authorizations/i);
    expect(adminExercisesEdge).toContain('operation === "revokeBootstrap"');
    expect(adminExercisesEdge).toContain("trusted_admin_revoke_exercise_bootstrap");
    expect(adminExercisesEdge).toContain('"EXERCISE_BOOTSTRAP_REVOKED"');
    expect(adminExercisesEdge).not.toContain('exercise_bootstrap_authorizations").update');
  });
});
