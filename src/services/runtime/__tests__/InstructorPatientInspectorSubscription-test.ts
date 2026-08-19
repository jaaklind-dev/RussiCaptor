import {
  getInstructorPatientInspectorVersion, subscribeToInstructorPatientInspector,
} from "@/services/InstructorPatientInspectorService";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import {
  clearRuntimeSnapshots, getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, publishRuntimeSnapshot,
} from "@/services/RuntimeSnapshotService";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { createMtpCommandId, resetMtpCommands } from "@/services/runtime/instructor/MassiveTransfusionCommandService";

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
  beforeEach(() => { clearRuntimeSnapshots(); resetMtpCommands(); });
  afterEach(() => { clearRuntimeSnapshots(); resetMtpCommands(); });

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

  test("the observed Inspector version changes for the first snapshot after a mounted view", () => {
    const mountedVersion = getInstructorPatientInspectorVersion();
    publishRuntimeSnapshot(runtime(60));
    const firstVisibleUpdate = getInstructorPatientInspectorVersion();

    expect(firstVisibleUpdate).not.toBe(mountedVersion);
    const mountedRuntimeVersion = Number(mountedVersion.split(":").at(-1));
    const updatedRuntimeVersion = Number(firstVisibleUpdate.split(":").at(-1));
    expect(updatedRuntimeVersion).toBe(mountedRuntimeVersion + 1);
  });

  test("an observed snapshot version resolves the latest MTP command sequence", () => {
    publishRuntimeSnapshot(runtime(0), [{
      processId: "MTP", moduleId: "MASSIVE_TRANSFUSION_V1", status: "Active",
      clinicalState: { processedCommandIds: ["MTP-ACTIVATE"] },
    }]);
    const firstVersion = getRuntimeSnapshotVersion();
    expect(getCanonicalPatientRuntimeSnapshot("PT-MTP", firstVersion)?.processes[0]?.clinicalState?.processedCommandIds)
      .toEqual(["MTP-ACTIVATE"]);

    publishRuntimeSnapshot(runtime(1), [{
      processId: "MTP", moduleId: "MASSIVE_TRANSFUSION_V1", status: "Active",
      clinicalState: { processedCommandIds: ["MTP-ACTIVATE", "MTP-RBC-1"] },
    }]);
    const secondVersion = getRuntimeSnapshotVersion();
    expect(secondVersion).toBeGreaterThan(firstVersion);
    expect(getCanonicalPatientRuntimeSnapshot("PT-MTP", secondVersion)?.processes[0]?.clinicalState?.processedCommandIds)
      .toEqual(["MTP-ACTIVATE", "MTP-RBC-1"]);
  });

  test("each MTP user intent receives a distinct id even when the displayed process snapshot is stale", () => {
    publishRuntimeSnapshot(runtime(120), [{
      processId: "MTP", moduleId: "MASSIVE_TRANSFUSION_V1", status: "Active",
      clinicalState: { processedCommandIds: ["MTP-ACTIVATE", "MTP-RBC-1"] },
    }]);

    const first = createMtpCommandId("EX-MTP", "PT-MTP", "RBC_ADMINISTRATION");
    const second = createMtpCommandId("EX-MTP", "PT-MTP", "RBC_ADMINISTRATION");

    expect(first).not.toBe(second);
    expect(first).toContain("EX-MTP-PT-MTP-RBC_ADMINISTRATION-120-1");
    expect(second).toContain("EX-MTP-PT-MTP-RBC_ADMINISTRATION-120-2");
  });
});
