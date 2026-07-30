import type { RuntimeState } from "@/models/RuntimeAggregation";
import {
  clearRuntimeSnapshots, getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshots,
  publishRuntimeSnapshot, subscribeToRuntimeSnapshots,
} from "@/services/RuntimeSnapshotService";

const state = {
  encounterId: "P01", stateVersion: 1, exerciseTimeSec: 1, globalStatus: "Stable",
  targetVitals: {}, displayedVitals: {}, mentalStatusCode: "Alert", symptomTags: [], visibleFindings: [],
  activeAlerts: [], runtimeFields: {}, vitalAttribution: {}, statusAttribution: { supportingProcessIds: [] },
  manualOverrideActive: false, overrideMap: {}, aggregationConfigVersion: "IC-1", randomSeed: 1,
} as RuntimeState;

afterEach(clearRuntimeSnapshots);

test("runtime snapshot store publishes immutable copies through one subscription", () => {
  const listener = jest.fn();
  const unsubscribe = subscribeToRuntimeSnapshots(listener);
  publishRuntimeSnapshot(state, [{ processId: "HV-1", moduleId: "HV_V1", status: "Active" }]);
  const first = getRuntimeSnapshots();
  first[0].runtimeFields.changed = true;
  expect(getRuntimeSnapshots()[0].runtimeFields).toEqual({});
  expect(getCanonicalPatientRuntimeSnapshot("P01")?.processes).toEqual([
    { processId: "HV-1", moduleId: "HV_V1", status: "Active" },
  ]);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});
