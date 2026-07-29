import { summarizeCanonicalResources } from "@/services/runtime/selectors/ResourceSelectors";

test("dashboard canonical resource projection is derived from allocation state", () => {
  expect(summarizeCanonicalResources({
    configuration: {
      version: "test", fairness: { ageingIntervalTicks: 10, ageingPriorityStep: 1 },
      resources: [{ resourceType: "BVM", capacity: 2, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" }],
    },
    allocations: [{
      allocationId: "A-1", requestId: "R-1", interventionId: "I-1", patientId: "PT-1",
      resources: [{ resourceType: "BVM", quantity: 1 }], createdAtTick: 0, effectiveAtTick: 0, status: "ACTIVE",
    }],
    requests: [{
      requestId: "R-1", interventionId: "I-1", patientId: "PT-1",
      requirements: [{ resourceType: "BVM", quantity: 1, requiredFor: "DURATION" }],
      requestedAtTick: 0, explicitPriority: 0, patientPriority: 0, effectivePriority: 0,
      status: "ALLOCATED", allocationId: "A-1",
    }, {
      requestId: "R-2", interventionId: "I-2", patientId: "PT-2",
      requirements: [{ resourceType: "BVM", quantity: 1, requiredFor: "DURATION" }],
      requestedAtTick: 1, explicitPriority: 0, patientPriority: 0, effectivePriority: 0, status: "WAITING",
    }],
    sequence: 2, currentTick: 1, events: [],
  })).toEqual([{
    type: "BVM", label: "Bvm", total: 2, free: 1, inUse: 1, waiting: 1, activePatientIds: ["PT-1"],
  }]);
});
