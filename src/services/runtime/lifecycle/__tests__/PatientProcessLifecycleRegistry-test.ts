import type { CanonicalLifecycleProcess, PatientProcessLifecycleDescriptor } from "@/models/PatientProcessLifecycle";
import { PatientProcessLifecycleError } from "@/models/PatientProcessLifecycle";
import { PatientProcessLifecycleRegistry } from "../PatientProcessLifecycleRegistry";

const noop = () => ({ processes: [], events: [], aggregationRequested: false });
const descriptor = (processType: string, slot: number, overrides: Partial<PatientProcessLifecycleDescriptor> = {}): PatientProcessLifecycleDescriptor => ({
  processType, kind: "LEAF", requiredPhases: ["BOOTSTRAP", "TICK"],
  order: { bootstrapOrder: slot, tickOrder: slot, aggregationSlot: slot, serializationSlot: slot, siblingOrder: "SINGLETON" },
  bootstrap: noop, tick: noop, ...overrides,
});

describe("WP-36A PatientProcessLifecycleRegistry", () => {
  test("resolves an immutable plan by explicit canonical metadata, not registration order", () => {
    const first = new PatientProcessLifecycleRegistry(); first.register(descriptor("SECOND", 200)); first.register(descriptor("FIRST", 100));
    const second = new PatientProcessLifecycleRegistry(); second.register(descriptor("FIRST", 100)); second.register(descriptor("SECOND", 200));
    const a = first.resolve(); const b = second.resolve();
    expect(a.descriptors.map(item => item.processType)).toEqual(["FIRST", "SECOND"]);
    expect(b.descriptors.map(item => item.processType)).toEqual(["FIRST", "SECOND"]);
    expect(Object.isFrozen(a)).toBe(true); expect(Object.isFrozen(a.descriptors)).toBe(true);
  });

  test("fails closed for duplicate descriptors", () => {
    const registry = new PatientProcessLifecycleRegistry(); registry.register(descriptor("A", 100));
    expect(() => registry.register(descriptor("A", 200))).toThrow(expect.objectContaining({ code: "DUPLICATE_DESCRIPTOR" }));
  });

  test("fails closed for missing handlers and conflicting explicit order", () => {
    const missing = new PatientProcessLifecycleRegistry();
    expect(() => missing.register(descriptor("A", 100, { tick: undefined }))).toThrow(expect.objectContaining({ code: "MISSING_REQUIRED_HANDLER" }));
    const conflict = new PatientProcessLifecycleRegistry(); conflict.register(descriptor("A", 100)); conflict.register(descriptor("B", 100));
    expect(() => conflict.resolve()).toThrow(expect.objectContaining({ code: "CONFLICTING_ORDER" }));
  });

  test("fails closed for unresolved phases and independent aggregation conflicts", () => {
    const unresolved = new PatientProcessLifecycleRegistry();
    expect(() => unresolved.register(descriptor("A", 100, {
      order: { bootstrapOrder: 100, tickOrder: 100, finalizeOrder: 200,
        aggregationSlot: 100, serializationSlot: 100, siblingOrder: "SINGLETON" },
    }))).toThrow(expect.objectContaining({ code: "UNRESOLVED_LIFECYCLE_PHASE" }));

    const conflict = new PatientProcessLifecycleRegistry();
    conflict.register(descriptor("A", 100));
    conflict.register(descriptor("B", 200, {
      order: { bootstrapOrder: 200, tickOrder: 200, aggregationSlot: 100,
        serializationSlot: 200, siblingOrder: "SINGLETON" },
    }));
    expect(() => conflict.resolve()).toThrow(expect.objectContaining({ code: "CONFLICTING_ORDER" }));
  });

  test("fails closed for unknown process types and invalid root serialization", () => {
    expect(() => new PatientProcessLifecycleRegistry().resolve().descriptor("UNKNOWN")).toThrow(PatientProcessLifecycleError);
    const registry = new PatientProcessLifecycleRegistry();
    expect(() => registry.register(descriptor("ROOT", 100, { kind: "ROOT" }))).toThrow(expect.objectContaining({ code: "INVALID_DESCRIPTOR" }));
  });

  test("orders repeated siblings by explicit process identity, not insertion order", () => {
    const registry = new PatientProcessLifecycleRegistry();
    registry.register(descriptor("HYPOXIA", 200, {
      order: { bootstrapOrder: 200, tickOrder: 200, aggregationSlot: 200,
        serializationSlot: 200, siblingOrder: "PROCESS_ID" },
    }));
    const plan = registry.resolve();
    const process = (processId: string) => ({ processId, processType: "HYPOXIA" }) as CanonicalLifecycleProcess;
    expect(plan.processesForDescriptor(plan.descriptor("HYPOXIA"), [process("HYP-2"), process("HYP-1")])
      .map(item => item.processId)).toEqual(["HYP-1", "HYP-2"]);
  });
});
