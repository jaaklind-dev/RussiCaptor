import fs from "fs"; import path from "path";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
describe("authorization architecture isolation", () => {
  it.each(["services/ScenarioEngine.ts", "services/runtime/OwnershipResolver.ts", "services/assessment/ProtocolAssessmentEngine.ts", "services/evaluation/ExerciseEvaluationEngine.ts"])("%s does not import authorization", relative => {
    expect(read(relative)).not.toMatch(/services\/authorization|models\/authorization/);
  });
  it("authorization foundation does not depend on Runtime ownership or UI route state", () => {
    const files = fs.readdirSync(path.join(root, "services/authorization")).filter(file => file.endsWith(".ts")); const source = files.map(file => read(`services/authorization/${file}`)).join("\n");
    expect(source).not.toMatch(/OwnershipResolver|ScenarioEngine|expo-router|\/excon/);
  });
});
