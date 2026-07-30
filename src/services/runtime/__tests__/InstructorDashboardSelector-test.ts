import type { RuntimeState } from "@/models/RuntimeAggregation";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import {
  filterInstructorPatients, projectInstructorPatients,
} from "@/services/runtime/selectors/InstructorDashboardSelector";

function runtime(patientId: string, status: RuntimeState["globalStatus"], spo2: number): RuntimeState {
  const vitalSignState = new VitalSignEngine().resolve({
    timestamp: 120, configuration: defaultVitalSignConfiguration,
    contributors: [{ contributorId: `${patientId}:SPO2`, sourceType: "PATIENT_PROCESS", sourceId: "TEST",
      layer: "PROCESS", vital: "spo2", operation: "TARGET", value: spo2 }],
  }).state;
  return {
    encounterId: patientId, stateVersion: 1, exerciseTimeSec: 120, globalStatus: status,
    targetVitals: { spo2: 1, hr: 999 }, displayedVitals: { spo2: 2, hr: 998 },
    vitalSignState, vitalSignConfiguration: defaultVitalSignConfiguration,
    mentalStatusCode: "Alert", symptomTags: [], visibleFindings: [], activeAlerts: [], runtimeFields: {},
    vitalAttribution: {}, statusAttribution: { supportingProcessIds: [] }, manualOverrideActive: false,
    overrideMap: {}, aggregationConfigVersion: "IC-1", randomSeed: 1,
  };
}

describe("IC-1 Instructor Dashboard projection", () => {
  test("uses canonical VitalSignState and ignores conflicting legacy projections", () => {
    const source = runtime("P01", "Critical", 88);
    const result = projectInstructorPatients([{
      id: "P01", name: "Patient One", location: "Resus", triage: "P1", status: "Active",
      assignment: { caseManagerId: "CM-1", caseManagerName: "Jaak" },
    }], [source]);
    expect(result[0]).toMatchObject({
      patientId: "P01", status: "Critical", spo2: 88, heartRate: 80,
      respiratoryRate: 16, systolicBp: 120, avpu: "ALERT", hasCanonicalRuntime: true,
    });
    expect(source.targetVitals).toEqual({ spo2: 1, hr: 999 });
  });

  test("sorts by severity, triage and patient id and supports all filters", () => {
    const patients = [
      { id: "P03", name: "Three", location: "Ward", triage: "P3" as const, status: "Completed" as const },
      { id: "P02", name: "Two", location: "EMO", triage: "P2" as const, status: "Active" as const,
        assignment: { caseManagerId: "CM-2", caseManagerName: "CM-2" } },
      { id: "P01", name: "One", location: "Resus", triage: "P1" as const, status: "Active" as const,
        assignment: { caseManagerId: "CM-1", caseManagerName: "Jaak" } },
    ];
    const projected = projectInstructorPatients(patients, [runtime("P01", "Arrest", 70), runtime("P02", "Stable", 97)]);
    expect(projected.map(item => item.patientId)).toEqual(["P01", "P02", "P03"]);
    expect(filterInstructorPatients(projected, {
      location: "Resus", triage: "P1", caseManager: "Jaak", status: "Life threatening",
    }).map(item => item.patientId)).toEqual(["P01"]);
  });

  test("projects 100 patients deterministically without mutating input", () => {
    const patients = Array.from({ length: 100 }, (_, index) => ({
      id: `P${String(index + 1).padStart(3, "0")}`, name: `Patient ${index + 1}`,
      location: index % 2 ? "ICU" : "EMO", triage: index % 3 === 0 ? "P1" as const : "P2" as const,
      status: "Active" as const,
    }));
    const before = structuredClone(patients);
    const first = projectInstructorPatients(patients, []);
    const second = projectInstructorPatients([...patients].reverse(), []);
    expect(first).toHaveLength(100);
    expect(second).toEqual(first);
    expect(patients).toEqual(before);
  });
});
