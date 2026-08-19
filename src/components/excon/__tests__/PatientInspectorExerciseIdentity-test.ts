import fs from "node:fs";
import path from "node:path";

describe("Patient Inspector canonical exercise identity", () => {
  test("clinical commands use the current canonical exercise snapshot after a fresh preparation", () => {
    const inspector = fs.readFileSync(
      path.join(process.cwd(), "src/app/excon/patient/[id].tsx"),
      "utf8",
    );
    const injection = fs.readFileSync(
      path.join(process.cwd(), "src/components/instructor/InstructorEventInjectionModal.tsx"),
      "utf8",
    );

    expect(inspector).toContain('getCanonicalExerciseSnapshot().exerciseId');
    expect(inspector).not.toContain('getCurrentExercise().id');
    const interventions = fs.readFileSync(
      path.join(process.cwd(), "src/components/instructor/InspectorResourceInterventions.tsx"),
      "utf8",
    );
    expect(interventions.match(/getCanonicalExerciseSnapshot\(\)\.exerciseId/g)).toHaveLength(3);
    expect(interventions).not.toContain("{ exerciseId, patientId }");
    expect(injection).toContain('getCanonicalExerciseSnapshot()');
    expect(injection).not.toContain('getCurrentExercise()');
  });
});
