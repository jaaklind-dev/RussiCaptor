import type {
  CanonicalLifecycleProcess,
  LegacyCanonicalOrder,
  LifecyclePhase,
  PatientProcessLifecycleDescriptor,
} from "@/models/PatientProcessLifecycle";
import { PatientProcessLifecycleError } from "@/models/PatientProcessLifecycle";
import { deepFreeze } from "@/utils/immutable";

const phaseField: Record<LifecyclePhase, keyof LegacyCanonicalOrder> = {
  BOOTSTRAP: "bootstrapOrder", ADVANCE: "advanceOrder", HANDLE_INPUT: "inputOrder",
  PREPARE: "prepareOrder", TICK: "tickOrder", POST_AGGREGATE: "postAggregateOrder", FINALIZE: "finalizeOrder",
};
const handlerField: Record<LifecyclePhase, keyof PatientProcessLifecycleDescriptor> = {
  BOOTSTRAP: "bootstrap", ADVANCE: "advance", HANDLE_INPUT: "handleInput", PREPARE: "prepare",
  TICK: "tick", POST_AGGREGATE: "postAggregate", FINALIZE: "finalize",
};

function validate(descriptor: PatientProcessLifecycleDescriptor): void {
  if (!descriptor.processType || !descriptor.requiredPhases.length) {
    throw new PatientProcessLifecycleError("INVALID_DESCRIPTOR", "Lifecycle descriptor identity or required phases are missing.");
  }
  for (const phase of descriptor.requiredPhases) {
    if (typeof descriptor[handlerField[phase]] !== "function" || !Number.isFinite(descriptor.order[phaseField[phase]] as number)) {
      throw new PatientProcessLifecycleError("MISSING_REQUIRED_HANDLER", `${descriptor.processType} is missing ${phase} handler or order.`);
    }
  }
  for (const phase of Object.keys(phaseField) as LifecyclePhase[]) {
    const hasHandler = typeof descriptor[handlerField[phase]] === "function";
    const hasOrder = typeof descriptor.order[phaseField[phase]] === "number";
    if (hasHandler !== hasOrder) {
      throw new PatientProcessLifecycleError("UNRESOLVED_LIFECYCLE_PHASE",
        `${descriptor.processType} ${phase} handler and explicit order must be declared together.`);
    }
  }
  if (descriptor.kind === "ROOT" && descriptor.order.serializationSlot !== "SEPARATE_ROOT") {
    throw new PatientProcessLifecycleError("INVALID_DESCRIPTOR", `${descriptor.processType} root must use SEPARATE_ROOT serialization.`);
  }
  if (descriptor.kind === "LEAF" && typeof descriptor.order.serializationSlot !== "number") {
    throw new PatientProcessLifecycleError("INVALID_DESCRIPTOR", `${descriptor.processType} leaf requires a numeric serialization slot.`);
  }
}

export class PatientProcessLifecycleExecutionPlan {
  constructor(readonly descriptors: readonly PatientProcessLifecycleDescriptor[]) { deepFreeze(this); }

  descriptor(processType: string): PatientProcessLifecycleDescriptor {
    const result = this.descriptors.find(item => item.processType === processType);
    if (!result) throw new PatientProcessLifecycleError("UNKNOWN_PROCESS_TYPE", `Lifecycle descriptor ${processType} is not registered.`);
    return result;
  }

  forPhase(phase: LifecyclePhase): readonly PatientProcessLifecycleDescriptor[] {
    const field = phaseField[phase];
    return this.descriptors.filter(item => typeof item[handlerField[phase]] === "function")
      .sort((left, right) => (left.order[field] as number) - (right.order[field] as number));
  }

  processesForDescriptor(
    descriptor: PatientProcessLifecycleDescriptor,
    processes: readonly CanonicalLifecycleProcess[]
  ): CanonicalLifecycleProcess[] {
    const matches = processes.filter(process => process.processType === descriptor.processType);
    if (descriptor.order.siblingOrder === "PROCESS_ID") {
      return [...matches].sort((left, right) => left.processId.localeCompare(right.processId));
    }
    if (matches.length > 1) {
      throw new PatientProcessLifecycleError(
        "INVALID_PROCESS_IDENTITY",
        `${descriptor.processType} singleton lifecycle has ${matches.length} active processes.`
      );
    }
    return matches;
  }

  orderProcesses(processes: readonly CanonicalLifecycleProcess[], domain: "AGGREGATION" | "SERIALIZATION"): CanonicalLifecycleProcess[] {
    const leaves = processes.filter(process => this.descriptor(process.processType).kind === "LEAF");
    return [...leaves].sort((left, right) => {
      const a = this.descriptor(left.processType); const b = this.descriptor(right.processType);
      const aSlot = domain === "AGGREGATION" ? a.order.aggregationSlot : a.order.serializationSlot;
      const bSlot = domain === "AGGREGATION" ? b.order.aggregationSlot : b.order.serializationSlot;
      if (typeof aSlot !== "number" || typeof bSlot !== "number") throw new PatientProcessLifecycleError("CONFLICTING_ORDER", `${domain} slot is missing.`);
      return aSlot - bSlot || left.processId.localeCompare(right.processId);
    });
  }
}

export class PatientProcessLifecycleRegistry {
  private readonly descriptors = new Map<string, PatientProcessLifecycleDescriptor>();

  register(descriptor: PatientProcessLifecycleDescriptor): void {
    validate(descriptor);
    if (this.descriptors.has(descriptor.processType)) {
      throw new PatientProcessLifecycleError("DUPLICATE_DESCRIPTOR", `Lifecycle descriptor ${descriptor.processType} is duplicated.`);
    }
    this.descriptors.set(descriptor.processType, deepFreeze(structuredCloneDescriptor(descriptor)));
  }

  resolve(): PatientProcessLifecycleExecutionPlan {
    const descriptors = [...this.descriptors.values()];
    for (const phase of Object.keys(phaseField) as LifecyclePhase[]) {
      const seen = new Map<number, PatientProcessLifecycleDescriptor>();
      for (const descriptor of descriptors) {
        const order = descriptor.order[phaseField[phase]];
        if (typeof order !== "number" || descriptor.order.siblingOrder === "PROCESS_ID") continue;
        const existing = seen.get(order);
        if (existing) throw new PatientProcessLifecycleError("CONFLICTING_ORDER", `${phase} order ${order} conflicts between ${existing.processType} and ${descriptor.processType}.`);
        seen.set(order, descriptor);
      }
    }
    for (const domain of ["aggregationSlot", "serializationSlot"] as const) {
      const seen = new Map<number, PatientProcessLifecycleDescriptor>();
      for (const descriptor of descriptors) {
        const slot = descriptor.order[domain];
        if (typeof slot !== "number" || descriptor.order.siblingOrder === "PROCESS_ID") continue;
        const existing = seen.get(slot);
        if (existing) throw new PatientProcessLifecycleError("CONFLICTING_ORDER",
          `${domain} ${slot} conflicts between ${existing.processType} and ${descriptor.processType}.`);
        seen.set(slot, descriptor);
      }
    }
    return new PatientProcessLifecycleExecutionPlan([...descriptors].sort((a, b) =>
      (typeof a.order.serializationSlot === "number" ? a.order.serializationSlot : -1) -
      (typeof b.order.serializationSlot === "number" ? b.order.serializationSlot : -1) || a.processType.localeCompare(b.processType)
    ));
  }
}

function structuredCloneDescriptor(descriptor: PatientProcessLifecycleDescriptor): PatientProcessLifecycleDescriptor {
  return { ...descriptor, requiredPhases: [...descriptor.requiredPhases], order: { ...descriptor.order } };
}
