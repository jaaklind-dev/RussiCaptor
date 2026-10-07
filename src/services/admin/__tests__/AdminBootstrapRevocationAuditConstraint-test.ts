import fs from "node:fs";
import path from "node:path";

const original = fs.readFileSync(path.join(process.cwd(),
  "supabase/migrations/20261004120000_user_exercise_admin_v1.sql"), "utf8");
const correction = fs.readFileSync(path.join(process.cwd(),
  "supabase/migrations/20261007123000_allow_bootstrap_revocation_audit.sql"), "utf8");
const edge = fs.readFileSync(path.join(process.cwd(),
  "supabase/functions/platform-admin-exercises/index.ts"), "utf8");

function allowedActions(sql: string): string[] {
  const expression = sql.match(/check \(action in \(\s*([\s\S]*?)\s*\)\)/i)?.[1];
  if (!expression) throw new Error("ADMIN_AUDIT_ACTION_CHECK_MISSING");
  return [...expression.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]);
}

describe("Admin bootstrap revocation audit constraint", () => {
  test("ADMIN-CONSTRAINT-01 physical 23514 is the missing audit action, not an exercise_states CHECK", () => {
    expect(allowedActions(original)).not.toContain("EXERCISE_BOOTSTRAP_REVOKED");
    expect(edge).toContain('audit(context, "EXERCISE_BOOTSTRAP_REVOKED", "SUCCESS"');
    expect(allowedActions(correction)).toContain("EXERCISE_BOOTSTRAP_REVOKED");
  });

  test("ADMIN-CONSTRAINT-02 preserves every pre-existing action and adds only revocation", () => {
    expect(allowedActions(correction).sort()).toEqual([
      ...allowedActions(original), "EXERCISE_BOOTSTRAP_REVOKED",
    ].sort());
    expect(new Set(allowedActions(correction)).size).toBe(allowedActions(correction).length);
  });

  test("ADMIN-CONSTRAINT-03 changes neither RLS nor table grants", () => {
    expect(correction).toContain("administrative_action_audit_action_check");
    const statements = correction.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
    expect(statements).not.toMatch(/\b(create policy|alter policy|grant|revoke all|disable row level security)\b/i);
    expect(allowedActions(correction)).not.toContain("ARBITRARY_ADMIN_ACTION");
  });
});
