import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = readFileSync(resolve(process.cwd(), "src/app/patient/[id].tsx"), "utf8");
const history = readFileSync(resolve(process.cwd(), "src/app/history.tsx"), "utf8");
const validationCard = readFileSync(resolve(process.cwd(),
  "src/components/dashboard/SharedWorkflowValidationCard.tsx"), "utf8");

describe("patient ownership release presentation", () => {
  it("exposes a confirmed, single-flight release for the currently editable CM patient", () => {
    expect(workspace).toContain('testID="patient-release-action"');
    expect(workspace).toContain("!isReadOnly && !pendingTransfer");
    expect(workspace).toContain("disabled={workflowPending}");
    expect(workspace).toContain("Vabasta patsient vastutusest?");
    expect(workspace).toContain("releasePatientConflictSafe(patient.id)");
    expect(workspace).not.toMatch(/releasePatientConflictSafe\(patient\.id\).*PATIENT_COMPLETE/);
  });

  it("does not present an ended assignment as the current CM or as completed history", () => {
    expect(workspace).toContain("assignment && !assignment.endedAt ? assignment.caseManagerName");
    expect(history).toContain('assignment.endReason === "released"');
    expect(history).toContain('title="Vastutusest vabastatud"');
  });

  it("does not repurpose the hard-coded validation race control", () => {
    expect(validationCard).toContain('const patientId = "PT-PELVIC-001"');
    expect(validationCard).toContain("Ainult validation-build");
    expect(workspace).not.toContain("SharedWorkflowValidationCard");
  });
});
