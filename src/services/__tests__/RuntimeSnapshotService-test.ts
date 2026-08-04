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
  expect(Object.isFrozen(first[0])).toBe(true);
  expect(Object.isFrozen(first[0].runtimeFields)).toBe(true);
  (first[0].runtimeFields as Record<string, unknown>).changed = true;
  expect(first[0].runtimeFields).toEqual({});
  expect(getRuntimeSnapshots()[0].runtimeFields).toEqual({});
  const canonical = getCanonicalPatientRuntimeSnapshot("P01");
  expect(Object.isFrozen(canonical)).toBe(true);
  expect(Object.isFrozen(canonical?.processes)).toBe(true);
  expect(canonical?.processes).toEqual([
    { processId: "HV-1", moduleId: "HV_V1", status: "Active" },
  ]);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test("published snapshots retain deeply immutable nested values without leaking source references", () => {
  const source = structuredClone(state);
  source.runtimeFields = { nested: { value: 1 } };
  publishRuntimeSnapshot(source);
  (source.runtimeFields.nested as { value: number }).value = 2;
  const snapshot = getCanonicalPatientRuntimeSnapshot("P01")!;
  expect(snapshot.state.runtimeFields).toEqual({ nested: { value: 1 } });
  expect(Object.isFrozen(snapshot.state.runtimeFields.nested)).toBe(true);
  (snapshot.state.runtimeFields.nested as { value: number }).value = 3;
  expect(snapshot.state.runtimeFields).toEqual({ nested: { value: 1 } });
  expect(getCanonicalPatientRuntimeSnapshot("P01")?.state.runtimeFields).toEqual({ nested: { value: 1 } });
});
