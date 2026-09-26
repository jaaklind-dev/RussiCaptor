import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("durable intervention readiness contract", () => {
  const patientControls = [
    "src/components/patient/PelvicBinderControls.tsx",
    "src/components/patient/PleuralDrainControls.tsx",
    "src/components/patient/VascularAccessControls.tsx",
    "src/components/patient/MassiveTransfusionControls.tsx",
    "src/components/patient/EndotrachealIntubationControls.tsx",
  ] as const;

  test.each(patientControls)("%s consumes the shared reactive readiness gate", file => {
    const source = read(file);
    expect(source).toContain("useRuntimePatientCommandSubmissionReadiness(exerciseId)");
    expect(source).toContain("!commandReadiness.ready");
    expect(source).toContain("sünkroniseeritakse");
  });

  test("EXCON resource and MTP durable controls use the same gate", () => {
    const source = read("src/components/instructor/InspectorResourceInterventions.tsx");
    expect(source).toContain("useRuntimePatientCommandSubmissionReadiness(exerciseId)");
    expect(source).toContain("Boolean(submitting) || !commandReadiness.ready");
  });

  test("clinical treatment readiness delegates to the shared command contract", () => {
    const source = read("src/services/clinical/ClinicalTreatmentCommandService.ts");
    expect(source).toContain("return runtimePatientCommandSubmissionReadiness(exerciseId)");
  });

  test("all production controls retain action-specific durable facades", () => {
    const combined = patientControls.map(read).join("\n");
    expect(combined).toContain("submitResourceInterventionCommand");
    expect(combined).toContain("submitStopResourceInterventionCommand");
    expect(combined).toContain("submitMtpCommand");
    expect(combined).toContain("submitEndotrachealIntubationCommand");
    expect(combined).not.toContain("getInstructorRuntimeOwner");
  });

  test("resource and MTP submission facades have no direct-owner fallback", () => {
    for (const file of [
      "src/services/runtime/instructor/ResourceInterventionCommandService.ts",
      "src/services/runtime/instructor/MassiveTransfusionCommandService.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("submitPatientRuntimeCommand");
      expect(source).not.toContain("if (!getRuntimePatientCommandGateway())");
    }
  });

  test("shared hook reacts to convergence and uses the submission-time gate", () => {
    const source = read("src/services/runtime/commands/useRuntimePatientCommandSubmissionReadiness.ts");
    expect(source).toContain("subscribeToRuntimeReaderConvergence");
    expect(source).toContain("runtimePatientCommandSubmissionReadiness(exerciseId)");
  });
});
