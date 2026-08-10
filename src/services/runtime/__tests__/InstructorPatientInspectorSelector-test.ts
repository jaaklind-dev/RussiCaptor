import type { Patient } from "@/models/Patient";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { projectInstructorPatientInspector } from "@/services/runtime/selectors/InstructorPatientInspectorSelector";

const patient: Patient = {
  id: "P001", isikukood: "39001010011", name: "Test Patient", triage: "P1", status: "Active",
  location: "Resus", lastSeen: "now", mist: { mechanism: "", injuries: "", signs: "", treatment: "" },
};

function runtime(): RuntimeState {
  const vitalSignState = new VitalSignEngine().resolve({
    timestamp: 120, configuration: defaultVitalSignConfiguration,
    contributors: [{ contributorId: "SPO2", sourceType: "PATIENT_PROCESS", sourceId: "RF-1",
      layer: "PROCESS", vital: "spo2", operation: "TARGET", value: 89 }],
  }).state;
  return {
    encounterId: "P001", stateVersion: 2, exerciseTimeSec: 120, globalStatus: "Critical",
    targetVitals: { spo2: 1, hr: 999 }, displayedVitals: { spo2: 2, hr: 998 }, vitalSignState,
    vitalSignConfiguration: defaultVitalSignConfiguration, mentalStatusCode: "Alert", symptomTags: [],
    visibleFindings: [], activeAlerts: [], runtimeFields: {}, vitalAttribution: {},
    statusAttribution: { supportingProcessIds: [] }, manualOverrideActive: false, overrideMap: {},
    aggregationConfigVersion: "IC-2", randomSeed: 19,
  };
}

const empty = {
  activeEffects: [], timeline: [], interventions: [], medications: [], labs: [], imaging: [], orders: [], notes: [],
};

describe("IC-2 Instructor Patient Inspector projection", () => {
  test("reads canonical vitals, process summaries and immutable metadata only", () => {
    const canonical = runtime();
    const result = projectInstructorPatientInspector({
      patient, assignment: { patientId: "P001", caseManagerId: "CM-1", caseManagerName: "Jaak", assignedAt: "T0" },
      runtime: { state: canonical, processes: [{ processId: "RF-1", moduleId: "RESPIRATORY_FAILURE_V1", status: "Active" }] },
      ...empty, activeEffects: [{ id: "E-1", name: "Oxygen", source: "Intervention" }],
    });
    expect(result.header).toMatchObject({ patientId: "P001", nationalId: "39001010011", status: "Critical", caseManagerName: "Jaak", simulationTimeSec: 120 });
    expect(result.clinicalState).toMatchObject({ hasCanonicalRuntime: true, spo2: 89, heartRate: 80, systolicBp: 120, map: 90, avpu: "ALERT" });
    expect(result.processes).toEqual([{ id: "RF-1", title: "RESPIRATORY FAILURE", detail: "RF-1", status: "Active" }]);
    expect(result.effects).toEqual([{ id: "E-1", title: "Oxygen", detail: "Intervention", status: "Active" }]);
    expect(canonical.targetVitals).toEqual({ spo2: 1, hr: 999 });
  });

  test("renders pending canonical state and empty optional datasets without fallback", () => {
    const result = projectInstructorPatientInspector({ patient, ...empty });
    expect(result.clinicalState).toEqual({
      hasCanonicalRuntime: false, heartRate: undefined, respiratoryRate: undefined, spo2: undefined,
      systolicBp: undefined, diastolicBp: undefined, map: undefined, temperature: undefined,
      etco2: undefined, avpu: undefined, gcs: undefined,
    });
    expect(result.processes).toEqual([]);
    expect(result.labs).toEqual([]);
    expect(result.imaging).toEqual([]);
  });

  test("sorts timeline newest first and derives ownership history from existing events", () => {
    const result = projectInstructorPatientInspector({
      patient, ...empty,
      timeline: [{ id: "T1", exerciseId: "E", patientId: "P001", timestamp: "2026-01-01T08:10:00Z",
        type: "assignment", title: "Assigned", description: "Assigned to Jaak", author: "EXCON", visibility: "revealed" },
      { id: "T2", exerciseId: "E", patientId: "P001", timestamp: "2026-01-01T08:34:00Z",
        type: "transfer", title: "Transferred", description: "Transferred to CM-2", author: "EXCON", visibility: "revealed" },
      { id: "T3", exerciseId: "E", patientId: "P001", timestamp: "2026-01-01T08:20:00Z",
        type: "lab", title: "Lab available", description: "CBC", author: "EXCON", visibility: "revealed" }],
    });
    expect(result.timeline.map(item => item.id)).toEqual(["T2", "T3", "T1"]);
    expect(result.ownershipHistory.map(item => item.id)).toEqual(["T2", "T1"]);
  });

  test("projects cardiac state only from the canonical process projection", () => {
    const result = projectInstructorPatientInspector({ patient, ...empty, runtime: { state: runtime(), processes: [{
      processId: "CA-1", moduleId: "CARDIAC_ARREST_V1", status: "Active",
      clinicalState: { cardiacState: "ARREST", rhythm: "VF", rhythmClassification: "SHOCKABLE", cprActive: true, shockAttemptCount: 2 },
      lastEvent: { type: "CPR_STARTED", simulationTimeSec: 44 },
    }] } });
    expect(result.cardiac).toEqual({ cardiacState: "ARREST", rhythm: "VF", rhythmClassification: "SHOCKABLE",
      cprActive: true, shockAttemptCount: 2, lastEvent: "CPR_STARTED", lastEventTimeSec: 44 });
    expect(projectInstructorPatientInspector({ patient, ...empty, runtime: { state: runtime(), processes: [] } }).cardiac).toBeUndefined();
  });
});
