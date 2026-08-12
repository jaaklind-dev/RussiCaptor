import fs from "fs"; import path from "path";
const migration = fs.readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/202608120001_authorization_foundation.sql"), "utf8");
describe("WP-41A Supabase migration", () => {
  it("defines server-owned assignments, backend permission primitive and separate audit", () => {
    expect(migration).toMatch(/create table if not exists public\.authorization_role_assignments/);
    expect(migration).toMatch(/create or replace function public\.has_authorization_permission/);
    expect(migration).toMatch(/security definer/); expect(migration).toMatch(/auth\.uid\(\)/);
    expect(migration).toMatch(/create table if not exists public\.authorization_audit/); expect(migration).toMatch(/record_authorization_decision/);
  });
  it("does not grant ordinary clients assignment mutation policies", () => {
    expect(migration).not.toMatch(/create policy[^;]+authorization_role_assignments[^;]+for (insert|update|delete|all)/is);
    expect(migration).toMatch(/users can read own authorization assignments/);
  });
  it("does not modify Runtime or existing exercise state tables", () => {
    expect(migration).not.toMatch(/alter table public\.exercise_states/); expect(migration).not.toMatch(/RuntimeOwnershipResolver|ScenarioEngine/);
  });
});
