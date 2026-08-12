import fs from "fs"; import path from "path";
const migration = fs.readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/202608120002_instructor_evaluation_foundation.sql"), "utf8");
describe("WP-41 backend persistence", () => {
  test("stores one current identity plus append-only structured revisions", () => { expect(migration).toMatch(/exercise_id text not null unique/); expect(migration).toMatch(/primary key \(evaluation_id, revision\)/); expect(migration).toMatch(/content jsonb not null/); });
  test("binds evaluator to auth.uid and performs atomic revision checks", () => { expect(migration).toMatch(/evaluator_user_id uuid not null references auth\.users/); expect(migration).toMatch(/for update/); expect(migration).toMatch(/REVISION_CONFLICT/); expect(migration).toMatch(/auth\.uid\(\)/); });
  test("uses separate authorization audit and never writes clinical Timeline", () => { expect(migration).toMatch(/record_authorization_decision/); expect(migration).not.toMatch(/(insert into|update|delete from) public\.(exercise_timeline|timeline_events|runtime_state)/i); });
});
