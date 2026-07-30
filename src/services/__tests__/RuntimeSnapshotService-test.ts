import type { RuntimeState } from "@/models/RuntimeAggregation";
import {
  clearRuntimeSnapshots, getRuntimeSnapshots, publishRuntimeSnapshot, subscribeToRuntimeSnapshots,
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
  publishRuntimeSnapshot(state);
  const first = getRuntimeSnapshots();
  first[0].runtimeFields.changed = true;
  expect(getRuntimeSnapshots()[0].runtimeFields).toEqual({});
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});
