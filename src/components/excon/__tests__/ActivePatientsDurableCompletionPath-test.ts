import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("PATCOMP durable EXCON completion path",()=>{
  test("uses shared readiness and durable submission without legacy direct mutation",()=>{
    const source=readFileSync(resolve(process.cwd(),"src/components/excon/ActivePatientsCard.tsx"),"utf8");
    const service=readFileSync(resolve(process.cwd(),"src/services/PatientCompletionService.ts"),"utf8");
    expect(source).toContain("useRuntimePatientCommandSubmissionReadiness(exerciseId)");
    expect(source).toContain("submitPatientCompletion(");
    expect(source).toContain("inFlightPatientIds.current.has(patientId)");
    expect(source).not.toContain("finishPatient");
    expect(source).not.toContain("materializePatientCompletion");
    expect(service).toContain("runtimePatientCommandSubmissionReadiness(");
    expect(service).toContain("submitPatientRuntimeCommand(");
    expect(service).not.toContain("setPatientStatus");
    expect(service).not.toContain("unassignPatient");
  });
});
