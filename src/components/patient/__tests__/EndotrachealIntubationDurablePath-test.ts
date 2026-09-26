import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("PROC-G13/16/22 ETT production UI durable path", () => {
  const source = readFileSync(resolve(process.cwd(),
    "src/components/patient/EndotrachealIntubationControls.tsx"), "utf8");

  test("uses the durable facade and shared command readiness without a direct owner bypass", () => {
    expect(source).toContain("submitEndotrachealIntubationCommand");
    expect(source).toContain("runtimePatientCommandSubmissionReadiness(exerciseId)");
    expect(source).toContain("!commandReadiness.ready");
    expect(source).not.toContain("executeEndotrachealIntubationCommand");
    expect(source).not.toContain("getInstructorRuntimeOwner");
  });
});
