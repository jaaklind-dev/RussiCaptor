import {
  getPatientResourceDebugSnapshot,
  getResourceRuntimeDebugVersion,
  publishResourceRuntimeDebugSnapshot,
  subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";
import { summarizeResources } from "@/services/runtime/selectors/ResourceSelectors";

test("resource developer read model filters patient data and keeps ten newest events", () => {
  const listener = jest.fn();
  const unsubscribe = subscribeToResourceRuntimeDebug(listener);
  const before = getResourceRuntimeDebugVersion();
  publishResourceRuntimeDebugSnapshot({
    resources: [
      { resourceId: "MASK", type: "oxygenMask", status: "RESERVED", assignedPatientId: "PT-1", metadata: {} },
      { resourceId: "VENT", type: "ventilator", status: "AVAILABLE", metadata: {} },
    ],
    activeInterventions: [
      { interventionId: "I-1", patientId: "PT-1", resourceId: "MASK", action: "APPLY", timestamp: 1, priority: 10 },
      { interventionId: "I-2", patientId: "PT-2", resourceId: "OTHER", action: "APPLY", timestamp: 1, priority: 0 },
    ],
    recentEvents: Array.from({ length: 12 }, (_, index) => ({
      eventType: "InterventionApplied" as const, timestamp: index, resourceId: "MASK",
      patientId: "PT-1", interventionId: `I-${index}`,
    })),
    updatedAt: 12,
  });
  const snapshot = getPatientResourceDebugSnapshot("PT-1");
  expect(getResourceRuntimeDebugVersion()).toBe(before + 1);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(snapshot.resources).toHaveLength(2);
  expect(snapshot.activeInterventions.map(item => item.interventionId)).toEqual(["I-1"]);
  expect(snapshot.recentEvents).toHaveLength(10);
  expect(snapshot.recentEvents[0].timestamp).toBe(11);
  unsubscribe();
});

test("dashboard resource monitor aggregates total, free and in-use counts by type", () => {
  expect(summarizeResources([
    { resourceId: "O2-1", type: "oxygen", status: "AVAILABLE", metadata: {} },
    { resourceId: "O2-2", type: "oxygen", status: "RESERVED", assignedPatientId: "PT-1", metadata: {} },
    { resourceId: "BVM-1", type: "BVM", status: "RESERVED", assignedPatientId: "PT-2", metadata: {} },
    { resourceId: "MON-1", type: "monitor", status: "AVAILABLE", metadata: {} },
  ])).toEqual([
    { type: "oxygen", label: "Oxygen", total: 2, free: 1, inUse: 1 },
    { type: "BVM", label: "BVM", total: 1, free: 0, inUse: 1 },
    { type: "monitor", label: "Monitors", total: 1, free: 1, inUse: 0 },
  ]);
});

test("multi-patient debug projections retain each patient's exact resource pool", () => {
  publishResourceRuntimeDebugSnapshot({
    resources: [{ resourceId: "PB-1", type: "pelvicBinder", status: "AVAILABLE", metadata: {} }],
    activeInterventions: [], recentEvents: [], updatedAt: 10,
  }, "PT-PELVIC");
  publishResourceRuntimeDebugSnapshot({
    resources: [{ resourceId: "CD-1", type: "chestDrain", status: "AVAILABLE", metadata: {} }],
    activeInterventions: [], recentEvents: [], updatedAt: 10,
  }, "PT-PLEURAL");

  expect(getPatientResourceDebugSnapshot("PT-PELVIC").resources.map(item => item.type)).toEqual(["pelvicBinder"]);
  expect(getPatientResourceDebugSnapshot("PT-PLEURAL").resources.map(item => item.type)).toEqual(["chestDrain"]);
});
