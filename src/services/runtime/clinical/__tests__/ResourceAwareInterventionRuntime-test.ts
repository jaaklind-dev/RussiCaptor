import type { ResourceAllocationConfiguration } from "@/models/ResourceAllocation";
import type { ResourceAwareInterventionDefinition } from "@/models/ResourceAwareIntervention";
import type { InterventionDefinition } from "@/models/InterventionDefinition";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { circulationInterventionDefinitions } from "@/services/runtime/clinical/CirculationInterventionDefinitions";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";
import { ResourceAwareInterventionRuntime } from "@/services/runtime/clinical/ResourceAwareInterventionRuntime";

const configuration: ResourceAllocationConfiguration = {
  version: "WP-18/INTEGRATION",
  fairness: { ageingIntervalTicks: 10, ageingPriorityStep: 1 },
  resources: [
    { resourceType: "BVM", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "OXYGEN_SOURCE", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "OXYGEN_DELIVERY_DEVICE", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "AIRWAY_EQUIPMENT", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "MECHANICAL_VENTILATOR", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "IV_ACCESS_KIT", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "CLINICIAN", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
  ],
};

const req = (resourceType: "BVM" | "OXYGEN_SOURCE" | "OXYGEN_DELIVERY_DEVICE" | "AIRWAY_EQUIPMENT" | "MECHANICAL_VENTILATOR" | "IV_ACCESS_KIT" | "CLINICIAN") =>
  ({ resourceType, quantity: 1, requiredFor: "DURATION" as const });

const allocations: ResourceAwareInterventionDefinition[] = [
  { definitionId: "OXYGEN_THERAPY", resourceRequirements: [req("OXYGEN_SOURCE"), req("OXYGEN_DELIVERY_DEVICE")] },
  { definitionId: "BAG_VALVE_MASK_VENTILATION", resourceRequirements: [req("BVM"), req("OXYGEN_SOURCE"), req("CLINICIAN")] },
  { definitionId: "OROPHARYNGEAL_AIRWAY", resourceRequirements: [req("AIRWAY_EQUIPMENT"), req("CLINICIAN")] },
  { definitionId: "MECHANICAL_VENTILATION", resourceRequirements: [req("MECHANICAL_VENTILATOR"), req("OXYGEN_SOURCE")] },
  { definitionId: "PERIPHERAL_IV_ACCESS", resourceRequirements: [req("IV_ACCESS_KIT"), req("CLINICIAN")] },
];

function runtime(config = configuration) {
  return new ResourceAwareInterventionRuntime(
    config,
    new InterventionDefinitionRegistry([...airwayInterventionDefinitions, ...circulationInterventionDefinitions]),
    allocations
  );
}

const intent = (interventionId: string, definitionId: string, patientId: string, tick = 0) => ({
  interventionId, definitionId, encounterId: patientId, patientId, requestedAtTick: tick,
  clinicalContext: { unconscious: true, gagReflexAbsent: true, spontaneousBreathing: true },
});

describe("WP-18 resource-aware intervention lifecycle", () => {
  test("waiting intervention has no Clinical Effect and release activates it at the exact allocation tick", () => {
    const subject = runtime();
    const first = subject.request(intent("O2-A", "OXYGEN_THERAPY", "P-A"));
    const waiting = subject.request(intent("BVM-B", "BAG_VALVE_MASK_VENTILATION", "P-B", 1));
    expect(first.lifecycle.status).toBe("RUNNING");
    expect(waiting.lifecycle.status).toBe("WAITING_FOR_RESOURCES");
    expect(subject.effectsAt(1).filter(item => item.patientId === "P-B")).toEqual([]);
    const released = subject.release("O2-A", 5);
    expect(released.allocationsStarted).toContainEqual(expect.objectContaining({ interventionId: "BVM-B", effectiveAtTick: 5 }));
    expect(subject.snapshot().lifecycle.find(item => item.interventionId === "BVM-B")).toMatchObject({ status: "RUNNING", startedAtTick: 5 });
    expect(subject.effectsAt(5)).toContainEqual(expect.objectContaining({
      patientId: "P-B", effectType: "EFFECTIVE_VENTILATION", timestamp: 5,
    }));
  });

  test.each([
    ["OXYGEN_THERAPY", "INSPIRED_OXYGEN_INCREASED"],
    ["BAG_VALVE_MASK_VENTILATION", "EFFECTIVE_VENTILATION"],
    ["OROPHARYNGEAL_AIRWAY", "UPPER_AIRWAY_PATENCY"],
    ["MECHANICAL_VENTILATION", "EFFECTIVE_VENTILATION"],
    ["PERIPHERAL_IV_ACCESS", "VASCULAR_ACCESS_AVAILABLE"],
  ])("existing %s definition activates %s only through allocated InterventionRuntime", (definitionId, effectType) => {
    const isolatedConfiguration: ResourceAllocationConfiguration = {
      ...configuration,
      resources: configuration.resources.map(item => ({ ...item, capacity: 1 })),
    };
    const subject = runtime(isolatedConfiguration);
    const result = subject.request(intent(`I:${definitionId}`, definitionId, "P-1"));
    expect(result.lifecycle.status).toBe("RUNNING");
    expect(subject.effectsAt(0)).toContainEqual(expect.objectContaining({ effectType, patientId: "P-1" }));
  });

  test("snapshot restore preserves active allocation, waiting queue and deterministic continuation", () => {
    const first = runtime();
    first.request(intent("O2-A", "OXYGEN_THERAPY", "P-A"));
    first.request(intent("BVM-B", "BAG_VALVE_MASK_VENTILATION", "P-B", 1));
    const restored = new ResourceAwareInterventionRuntime(
      configuration,
      new InterventionDefinitionRegistry([...airwayInterventionDefinitions, ...circulationInterventionDefinitions]),
      allocations,
      first.snapshot()
    );
    first.release("O2-A", 5);
    restored.release("O2-A", 5);
    expect(restored.snapshot()).toEqual(first.snapshot());
    expect(restored.hash()).toBe(first.hash());
    expect(restored.effectsAt(5)).toEqual(first.effectsAt(5));
  });

  test("fixed intervention completion releases capacity and starts the next waiter", () => {
    const fixed: InterventionDefinition = {
      definitionId: "FIXED_MONITOR", version: "1", name: "Fixed monitor",
      requiredResources: [], effects: [], duration: { kind: "FIXED", durationSec: 5 },
      parameters: [], preconditions: [{ kind: "ACTIVE_ENCOUNTER" }],
    };
    const subject = new ResourceAwareInterventionRuntime(
      {
        version: "fixed", fairness: { ageingIntervalTicks: 10, ageingPriorityStep: 1 },
        resources: [{ resourceType: "MONITOR", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" }],
      },
      new InterventionDefinitionRegistry([fixed]),
      [{ definitionId: "FIXED_MONITOR", resourceRequirements: [{ resourceType: "MONITOR", quantity: 1, requiredFor: "DURATION" }] }]
    );
    subject.request(intent("I-1", "FIXED_MONITOR", "P-1"));
    subject.request(intent("I-2", "FIXED_MONITOR", "P-2", 1));
    subject.effectsAt(5);
    expect(subject.snapshot().lifecycle).toEqual(expect.arrayContaining([
      expect.objectContaining({ interventionId: "I-1", status: "COMPLETED", endedAtTick: 5 }),
      expect.objectContaining({ interventionId: "I-2", status: "RUNNING", startedAtTick: 5 }),
    ]));
  });
});
