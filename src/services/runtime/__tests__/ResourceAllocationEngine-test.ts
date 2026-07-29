import type { ResourceAllocationConfiguration, ResourceAllocationIntent } from "@/models/ResourceAllocation";
import { ResourceAllocationEngine, ResourceAllocationValidationError } from "@/services/runtime/ResourceAllocationEngine";

const configuration: ResourceAllocationConfiguration = {
  version: "WP-18/TEST",
  fairness: { ageingIntervalTicks: 5, ageingPriorityStep: 10 },
  resources: [
    { resourceType: "MECHANICAL_VENTILATOR", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "BVM", capacity: 2, allocationMode: "CAPACITY", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "OXYGEN_SOURCE", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "CLINICIAN", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "NURSE", capacity: 0, allocationMode: "CAPACITY", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "MONITOR", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "TIMED", defaultAllocationDurationTicks: 10 },
  ],
};

const required = (resourceType: "MECHANICAL_VENTILATOR" | "BVM" | "OXYGEN_SOURCE" | "CLINICIAN" | "NURSE" | "MONITOR", optional = false) =>
  ({ resourceType, quantity: 1, requiredFor: "DURATION" as const, optional });

function intent(interventionId: string, patientId: string, resources = [required("MECHANICAL_VENTILATOR")], tick = 0,
  explicitPriority = 0, patientPriority = 0): ResourceAllocationIntent {
  return { interventionId, patientId, requirements: resources, requestedAtTick: tick, explicitPriority, patientPriority };
}

describe("WP-18 Resource Allocation Engine", () => {
  test("validates inventory and derives capacity including configured zero capacity", () => {
    const engine = new ResourceAllocationEngine(configuration);
    expect(engine.availability()).toContainEqual(expect.objectContaining({ resourceType: "NURSE", total: 0, allocated: 0, available: 0 }));
    expect(() => new ResourceAllocationEngine({ ...configuration, resources: [
      { resourceType: "BVM", capacity: -1, allocationMode: "CAPACITY", releaseMode: "EXPLICIT" },
    ] })).toThrow(ResourceAllocationValidationError);
    expect(() => new ResourceAllocationEngine({ ...configuration, resources: [configuration.resources[0], configuration.resources[0]] }))
      .toThrow(ResourceAllocationValidationError);
  });

  test("allocates multiple resources atomically and never holds a partial set", () => {
    const engine = new ResourceAllocationEngine(configuration);
    const waiting = engine.request(intent("INT-A", "P-A", [required("MECHANICAL_VENTILATOR"), required("NURSE")]));
    expect(waiting.status).toBe("WAITING");
    expect(engine.availability()).toContainEqual(expect.objectContaining({ resourceType: "MECHANICAL_VENTILATOR", available: 1 }));
    expect(engine.snapshot().allocations).toHaveLength(0);
    expect(waiting.events.map(item => item.eventType)).toEqual([
      "ResourceAllocationRequested", "ResourceAllocationDeferred", "InterventionWaitingForResources",
    ]);
  });

  test("two patients compete, release starts the deterministic queued winner and repeated release is idempotent", () => {
    const engine = new ResourceAllocationEngine(configuration);
    const first = engine.request(intent("VENT-A", "P-A"));
    const lower = engine.request(intent("VENT-B", "P-B", [required("MECHANICAL_VENTILATOR")], 1, 5));
    const higher = engine.request(intent("VENT-C", "P-C", [required("MECHANICAL_VENTILATOR")], 1, 10));
    expect(first.status).toBe("ALLOCATED");
    expect(lower.status).toBe("WAITING");
    expect(higher.status).toBe("WAITING");
    const released = engine.release(first.allocation!.allocationId, 2, "COMPLETED");
    expect(released.allocationsStarted).toEqual([expect.objectContaining({ interventionId: "VENT-C", effectiveAtTick: 2 })]);
    expect(engine.snapshot().requests.find(item => item.interventionId === "VENT-B")?.status).toBe("WAITING");
    expect(engine.release(first.allocation!.allocationId, 3).events).toEqual([]);
    expect(engine.availability().find(item => item.resourceType === "MECHANICAL_VENTILATOR")).toMatchObject({ total: 1, allocated: 1, available: 0 });
  });

  test("equal priority has stable requestId tie-break and deterministic ageing is audited", () => {
    const engine = new ResourceAllocationEngine(configuration);
    const active = engine.request(intent("ACTIVE", "P-0"));
    engine.request(intent("A", "P-A", [required("MECHANICAL_VENTILATOR")], 1));
    engine.request(intent("B", "P-B", [required("MECHANICAL_VENTILATOR")], 1));
    const decision = engine.release(active.allocation!.allocationId, 6);
    expect(decision.allocationsStarted[0].interventionId).toBe("A");
    expect(decision.events).toContainEqual(expect.objectContaining({ eventType: "ResourceQueuePriorityChanged", interventionId: "A" }));
    expect(decision.events).toContainEqual(expect.objectContaining({ eventType: "ResourceQueuePriorityChanged", interventionId: "B" }));
  });

  test("optional resources do not block, waiting cancellation is final and active cancellation releases", () => {
    const engine = new ResourceAllocationEngine(configuration);
    const optional = engine.request(intent("BVM-A", "P-A", [required("BVM"), required("NURSE", true)]));
    expect(optional.status).toBe("ALLOCATED");
    expect(optional.allocation?.resources).toEqual([{ resourceType: "BVM", quantity: 1 }]);
    const activeVent = engine.request(intent("VENT-A", "P-A"));
    engine.request(intent("VENT-B", "P-B"));
    expect(engine.cancelIntervention("VENT-B", 1).request?.status).toBe("CANCELLED");
    const cancelled = engine.cancelIntervention("VENT-A", 2);
    expect(cancelled.allocation?.status).toBe("CANCELLED");
    expect(activeVent.allocation?.status).toBe("ACTIVE");
    expect(engine.availability().find(item => item.resourceType === "MECHANICAL_VENTILATOR")?.available).toBe(1);
  });

  test("timed release expires exactly once and starts an eligible queue request", () => {
    const engine = new ResourceAllocationEngine(configuration);
    const first = engine.request(intent("MON-A", "P-A", [required("MONITOR")], 0));
    engine.request(intent("MON-B", "P-B", [required("MONITOR")], 1));
    expect(engine.advanceTo(9).events).toEqual([]);
    const atTen = engine.advanceTo(10);
    expect(atTen.events).toContainEqual(expect.objectContaining({ eventType: "ResourceAllocationExpired", interventionId: "MON-A", tick: 10 }));
    expect(atTen.allocationsStarted).toContainEqual(expect.objectContaining({ interventionId: "MON-B", effectiveAtTick: 10 }));
    expect(engine.advanceTo(10).events).toEqual([]);
    expect(first.allocation?.expiresAtTick).toBe(10);
  });

  test("snapshot restore continues bit-identically and replay hashes match", () => {
    const uninterrupted = new ResourceAllocationEngine(configuration);
    const first = uninterrupted.request(intent("VENT-A", "P-A"));
    uninterrupted.request(intent("VENT-B", "P-B", [required("MECHANICAL_VENTILATOR")], 1));
    const restored = new ResourceAllocationEngine(configuration, uninterrupted.snapshot());
    uninterrupted.release(first.allocation!.allocationId, 7);
    restored.release(first.allocation!.allocationId, 7);
    expect(restored.snapshot()).toEqual(uninterrupted.snapshot());
    expect(restored.hash()).toBe(uninterrupted.hash());
  });

  test("identical multi-patient replay is independent of requirement insertion order", () => {
    const run = (reverse: boolean) => {
      const engine = new ResourceAllocationEngine(configuration);
      const requirements = [required("BVM"), required("OXYGEN_SOURCE"), required("CLINICIAN")];
      const a = engine.request(intent("BVM-A", "P-A", reverse ? [...requirements].reverse() : requirements));
      engine.request(intent("BVM-B", "P-B", requirements, 1));
      engine.release(a.allocation!.allocationId, 12);
      return { state: engine.snapshot(), hash: engine.hash() };
    };
    expect(run(true)).toEqual(run(false));
  });
});
