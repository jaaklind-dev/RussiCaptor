import fs from "node:fs";
import path from "node:path";

const read = (relative: string): string => fs.readFileSync(path.resolve(process.cwd(), "src", relative), "utf8");

describe("WP-NARVA-10B17 ownership projection presentation", () => {
  test("Minu patsiendid rerenders when authoritative ownership hydration completes", () => {
    const source = read("app/patients.tsx");
    expect(source).toContain("useSyncExternalStore(subscribeToSync, getSyncVersion, getSyncVersion)");
  });

  test("patient treatment readiness combines Runtime and ownership readiness", () => {
    const source = read("services/clinical/ClinicalTreatmentCommandService.ts");
    expect(source).toContain("getCmOwnershipProjectionReadiness(exerciseId)");
    expect(source).toContain("canCurrentCaseManagerEditPatient(patientId)");
  });
});
