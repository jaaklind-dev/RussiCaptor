import fs from "fs"; import path from "path";
const root = path.resolve(__dirname, "../../..");
const files = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
describe("WP-41 architecture isolation", () => {
  test("Runtime, WP-38, WP-39 and WP-40 do not import Instructor Evaluation", () => {
    const protectedFiles = [...files(path.join(root, "services/runtime")), path.join(root, "services/ProtocolAssessmentService.ts"), path.join(root, "services/AnalyticsService.ts"), path.join(root, "services/ExerciseEvaluationService.ts")];
    protectedFiles.forEach(file => expect(fs.readFileSync(file, "utf8")).not.toMatch(/InstructorEvaluation/));
  });
  test("persistence migration uses permission-backed read and RPC-only writes", () => {
    const migration = fs.readFileSync(path.resolve(root, "../supabase/migrations/202608120002_instructor_evaluation_foundation.sql"), "utf8");
    expect(migration).toMatch(/has_authorization_permission\('INSTRUCTOR_EVALUATION_READ'/); expect(migration).toMatch(/has_authorization_permission\('INSTRUCTOR_EVALUATION_WRITE'/); expect(migration).toMatch(/REVISION_CONFLICT/);
    expect(migration).not.toMatch(/create policy[^;]+instructor_evaluations[^;]+for (insert|update|delete|all)/is);
  });
});
