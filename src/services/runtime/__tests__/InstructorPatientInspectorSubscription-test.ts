import {
  getInstructorPatientInspectorVersion, subscribeToInstructorPatientInspector,
} from "@/services/InstructorPatientInspectorService";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import {
  clearRuntimeSnapshots, publishRuntimeSnapshot,
} from "@/services/RuntimeSnapshotService";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";

function runtime(exerciseTimeSec: number): RuntimeState {
  const vitalSignState = new VitalSignEngine().resolve({
    timestamp: exerciseTimeSec,
    configuration: defaultVitalSignConfiguration,
    contributors: [{ contributorId: "HEM", sourceType: "PATIENT_PROCESS", sourceId: "HEM-1",
      layer: "PROCESS", vital: "systolicBp", operation: "DELTA", value: -exerciseTimeSec / 60 }],
  }).state;
  return {
    encounterId: "PT-MTP", stateVersion: exerciseTimeSec, exerciseTimeSec, globalStatus: "Stable",
    targetVitals: {}, displayedVitals: {}, vitalSignState, vitalSignConfiguration: defaultVitalSignConfiguration,
    mentalStatusCode: "Alert", symptomTags: [], visibleFindings: [], activeAlerts: [], runtimeFields: {},
    vitalAttribution: {}, statusAttribution: { supportingProcessIds: [] }, manualOverrideActive: false,
    overrideMap: {}, aggregationConfigVersion: "WP-47", randomSeed: 47,
  };
}

describe("WP-47 Inspector canonical Runtime presentation subscription", () => {
  beforeEach(clearRuntimeSnapshots);
  afterEach(clearRuntimeSnapshots);

  test("publishing consecutive canonical ticks invalidates the Inspector exactly once per tick", () => {
    const listener = jest.fn();
    const stop = subscribeToInstructorPatientInspector(listener);
    const before = getInstructorPatientInspectorVersion();

    publishRuntimeSnapshot(runtime(60));
    const afterFirst = getInstructorPatientInspectorVersion();
    publishRuntimeSnapshot(runtime(120));
    const afterSecond = getInstructorPatientInspectorVersion();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(afterFirst).not.toBe(before);
    expect(afterSecond).not.toBe(afterFirst);
    stop();
    publishRuntimeSnapshot(runtime(180));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
