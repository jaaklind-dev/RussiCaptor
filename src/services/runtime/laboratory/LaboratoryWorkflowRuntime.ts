import type { LabPatientBloodIdentity, LaboratoryOrder, LaboratoryResultGenerator,
  LaboratoryResultGroup, LaboratorySample, LaboratoryWorkflowSnapshot,
  LabSamplePhysiologySnapshot, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
import { LABORATORY_WORKFLOW_SCHEMA_VERSION, LAB_SAMPLE_SNAPSHOT_SCHEMA_VERSION } from "@/models/LaboratoryWorkflow";
import { NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE, resultGroupsForNarvaLabPackage } from
  "@/config/NarvaLaboratoryCatalog";
import { deepFreeze, immutableClone } from "@/utils/immutable";
import { stableJson } from "@/utils/stableJson";
import { authoredNarvaLabSampleResults, deriveNarvaLabPatientBloodIdentity } from "./NarvaLabPatientIdentity";

const emptySnapshot = (): LaboratoryWorkflowSnapshot => deepFreeze({
  schemaVersion: LABORATORY_WORKFLOW_SCHEMA_VERSION, orders: [], samples: [], resultGroups: [],
  patientBloodIdentities: {},
});
const validTime = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`INVALID_LAB_${name}`);
};

export class LaboratoryWorkflowRuntime {
  private state: LaboratoryWorkflowSnapshot = emptySnapshot();
  constructor(private readonly generator?: LaboratoryResultGenerator,
    private readonly generationAllowed: () => boolean = () => true) {}

  reset(): void { this.state = emptySnapshot(); }
  snapshot(): LaboratoryWorkflowSnapshot { return immutableClone(this.state) as LaboratoryWorkflowSnapshot; }

  order(input: Omit<LaboratoryOrder, "status">): LaboratoryOrder {
    this.assertMutable(); validTime(input.orderedAtSimulationTimeSec, "ORDER_TIME");
    const duplicate = this.state.orders.find(item => item.orderId === input.orderId);
    if (duplicate) {
      const expected = { ...input, status: duplicate.status };
      if (stableJson(duplicate) !== stableJson(expected)) throw new Error("LAB_ORDER_IDEMPOTENCY_CONFLICT");
      return immutableClone(duplicate) as LaboratoryOrder;
    }
    if (this.state.orders.some(item => item.exerciseId !== input.exerciseId || item.patientId !== input.patientId)) {
      throw new Error("LAB_WORKFLOW_IDENTITY_CONFLICT");
    }
    const order = deepFreeze({ ...structuredClone(input), status: "ORDERED" as const });
    this.replace({ ...this.state, orders: [...this.state.orders, order] });
    return immutableClone(order) as LaboratoryOrder;
  }

  collect(input: Readonly<{ sampleId: string; orderId: string; sampledAtSimulationTimeSec: number;
    sourcePatientRevision: number; sourceRuntimeStateVersion: number; snapshot: Omit<LabSamplePhysiologySnapshot, "schemaVersion">;
  }>): LaboratorySample {
    this.assertMutable(); validTime(input.sampledAtSimulationTimeSec, "SAMPLE_TIME");
    const order = this.state.orders.find(item => item.orderId === input.orderId);
    if (!order) throw new Error("LAB_ORDER_NOT_FOUND");
    if (input.sampledAtSimulationTimeSec < order.orderedAtSimulationTimeSec ||
      !Number.isInteger(input.sourcePatientRevision) || input.sourcePatientRevision < 0 ||
      !Number.isInteger(input.sourceRuntimeStateVersion) || input.sourceRuntimeStateVersion < 0) {
      throw new Error("LAB_INVALID_SAMPLE_SOURCE");
    }
    const duplicate = this.state.samples.find(item => item.sampleId === input.sampleId || item.orderId === input.orderId);
    if (duplicate) {
      if (duplicate.sampleId !== input.sampleId || duplicate.sampledAtSimulationTimeSec !== input.sampledAtSimulationTimeSec ||
        duplicate.sourcePatientRevision !== input.sourcePatientRevision || duplicate.sourceRuntimeStateVersion !== input.sourceRuntimeStateVersion) {
        throw new Error("LAB_SAMPLE_IDEMPOTENCY_CONFLICT");
      }
      return immutableClone(duplicate) as LaboratorySample;
    }
    type LegacyIdentity = LabPatientBloodIdentity & { antibodyScreen?: "NEGATIVE" | "POSITIVE" };
    const suppliedIdentity = input.snapshot.patientBloodIdentity as LegacyIdentity | undefined;
    const derivedIdentity = suppliedIdentity ?? (order.packageId === "NARVA_POLYTRAUMA"
      ? deriveNarvaLabPatientBloodIdentity(order.patientId) : undefined);
    const patientBloodIdentity = derivedIdentity
      ? { ab0: derivedIdentity.ab0, rhd: derivedIdentity.rhd } as const : undefined;
    const authoredResults = input.snapshot.authoredResults ?? (suppliedIdentity?.antibodyScreen
      ? { antibodyScreen: suppliedIdentity.antibodyScreen } : order.packageId === "NARVA_POLYTRAUMA"
        ? authoredNarvaLabSampleResults(order.patientId) : undefined);
    if (patientBloodIdentity) this.rememberBloodIdentity(order.patientId, patientBloodIdentity);
    const sample = deepFreeze({ sampleId: input.sampleId, orderId: order.orderId, exerciseId: order.exerciseId,
      patientId: order.patientId, sampledAtSimulationTimeSec: input.sampledAtSimulationTimeSec,
      sourcePatientRevision: input.sourcePatientRevision, sourceRuntimeStateVersion: input.sourceRuntimeStateVersion,
      snapshot: { ...structuredClone(input.snapshot), schemaVersion: LAB_SAMPLE_SNAPSHOT_SCHEMA_VERSION,
        ...(patientBloodIdentity ? { patientBloodIdentity } : {}),
        ...(authoredResults ? { authoredResults } : {}) } });
    const groups = resultGroupsForNarvaLabPackage(order.packageId).map(type => deepFreeze({
      resultGroupId: `${input.sampleId}:${type}`, sampleId: input.sampleId, type,
      availableAtSimulationTimeSec: input.sampledAtSimulationTimeSec + NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE[type],
      status: "PROCESSING" as const,
    }));
    this.replace({ ...this.state, orders: this.state.orders.map(item => item.orderId === order.orderId
      ? { ...item, status: "COLLECTED" as const } : item), samples: [...this.state.samples, sample],
    resultGroups: [...this.state.resultGroups, ...groups] });
    return immutableClone(sample) as LaboratorySample;
  }

  advanceTo(simulationTimeSec: number): readonly LaboratoryResultGroup[] {
    validTime(simulationTimeSec, "ADVANCE_TIME");
    if (this.state.terminalFencedAtSimulationTimeSec !== undefined || !this.generator || !this.generationAllowed()) return [];
    const released: LaboratoryResultGroup[] = [];
    const resultGroups = this.state.resultGroups.map(group => {
      if (group.status !== "PROCESSING" || group.availableAtSimulationTimeSec > simulationTimeSec || !this.generator) return group;
      const sample = this.state.samples.find(item => item.sampleId === group.sampleId)!;
      const order = this.state.orders.find(item => item.orderId === sample.orderId)!;
      const generated = this.generator!({ order, sample, resultGroupType: group.type });
      if (!generated) return group;
      if (!generated.generationVersion.trim()) throw new Error("LAB_GENERATION_VERSION_REQUIRED");
      const result = deepFreeze({ ...group, status: generated.status ?? "RESULTED" as const,
        resultPayload: structuredClone(generated.payload), generationVersion: generated.generationVersion,
        generatedAtSimulationTimeSec: simulationTimeSec });
      released.push(result); return result;
    });
    const orders = this.state.orders.map(order => {
      const sample = this.state.samples.find(item => item.orderId === order.orderId);
      if (!sample) return order;
      const groups = resultGroups.filter(item => item.sampleId === sample.sampleId);
      const count = groups.filter(item => item.status === "RESULTED").length;
      const releasedCount = groups.filter(item => item.status !== "PROCESSING").length;
      return { ...order, status: count === groups.length ? "RESULTED" as const : releasedCount > 0
        ? "PARTIALLY_RESULTED" as const : "PROCESSING" as const };
    });
    if (released.length || orders.some((item, index) => item.status !== this.state.orders[index]?.status)) {
      this.replace({ ...this.state, orders, resultGroups });
    }
    return immutableClone(released) as readonly LaboratoryResultGroup[];
  }

  fenceTerminal(simulationTimeSec: number): void {
    validTime(simulationTimeSec, "TERMINAL_TIME");
    if (this.state.terminalFencedAtSimulationTimeSec === undefined) {
      this.replace({ ...this.state, terminalFencedAtSimulationTimeSec: simulationTimeSec });
    }
  }

  restore(value?: LaboratoryWorkflowSnapshot): void {
    if (!value) { this.reset(); return; }
    const candidate = this.normalizeLegacyBloodIdentity(immutableClone(value) as LaboratoryWorkflowSnapshot);
    this.validate(candidate); this.state = candidate;
  }

  private normalizeLegacyBloodIdentity(value: LaboratoryWorkflowSnapshot): LaboratoryWorkflowSnapshot {
    type LegacyIdentity = LabPatientBloodIdentity & { antibodyScreen?: "NEGATIVE" | "POSITIVE" };
    const identities = Object.fromEntries(Object.entries(value.patientBloodIdentities).map(([patientId, raw]) => {
      const identity = raw as LegacyIdentity;
      return [patientId, { ab0: identity.ab0, rhd: identity.rhd }];
    }));
    const samples = value.samples.map(sample => {
      const legacy = sample.snapshot.patientBloodIdentity as LegacyIdentity | undefined;
      const patientBloodIdentity = legacy ? { ab0: legacy.ab0, rhd: legacy.rhd } : undefined;
      const authoredResults = sample.snapshot.authoredResults ?? (legacy?.antibodyScreen
        ? { antibodyScreen: legacy.antibodyScreen } : undefined);
      return { ...sample, snapshot: { ...sample.snapshot,
        ...(patientBloodIdentity ? { patientBloodIdentity } : {}),
        ...(authoredResults ? { authoredResults } : {}) } };
    });
    return immutableClone({ ...value, patientBloodIdentities: identities, samples }) as LaboratoryWorkflowSnapshot;
  }

  private rememberBloodIdentity(patientId: string, identity: LabPatientBloodIdentity): void {
    const existing = this.state.patientBloodIdentities[patientId];
    if (existing && stableJson(existing) !== stableJson(identity)) throw new Error("LAB_AB0_IDENTITY_CONFLICT");
    if (!existing) this.replace({ ...this.state, patientBloodIdentities: {
      ...this.state.patientBloodIdentities, [patientId]: immutableClone(identity) as LabPatientBloodIdentity } });
  }

  private assertMutable(): void {
    if (this.state.terminalFencedAtSimulationTimeSec !== undefined) throw new Error("LAB_TERMINAL_FENCED");
  }

  private replace(value: LaboratoryWorkflowSnapshot): void {
    this.state = immutableClone(value) as LaboratoryWorkflowSnapshot;
  }

  private validate(value: LaboratoryWorkflowSnapshot): void {
    if (value.schemaVersion !== LABORATORY_WORKFLOW_SCHEMA_VERSION) throw new Error("LAB_UNSUPPORTED_SCHEMA");
    const orderIds = new Set<string>(); const exerciseIds = new Set<string>(); const patientIds = new Set<string>();
    const sampleIds = new Set<string>(); const sampledOrderIds = new Set<string>();
    const groupIds = new Set<string>();
    for (const order of value.orders) {
      if (!order.orderId || !order.exerciseId || !order.patientId || !order.orderedBy ||
        !["NARVA_POLYTRAUMA", "NARVA_IRO_ASTRUP"].includes(order.packageId) ||
        !["ORDERED", "COLLECTED", "PROCESSING", "PARTIALLY_RESULTED", "RESULTED"].includes(order.status) ||
        orderIds.has(order.orderId)) throw new Error("LAB_DUPLICATE_ORDER");
      validTime(order.orderedAtSimulationTimeSec, "ORDER_TIME"); orderIds.add(order.orderId);
      exerciseIds.add(order.exerciseId); patientIds.add(order.patientId);
    }
    if (exerciseIds.size > 1 || patientIds.size > 1) throw new Error("LAB_WORKFLOW_IDENTITY_CONFLICT");
    for (const sample of value.samples) {
      const order = value.orders.find(item => item.orderId === sample.orderId);
      if (sampleIds.has(sample.sampleId) || sampledOrderIds.has(sample.orderId) || !order ||
        sample.exerciseId !== order.exerciseId || sample.patientId !== order.patientId ||
        sample.sampledAtSimulationTimeSec < order.orderedAtSimulationTimeSec ||
        !Number.isInteger(sample.sourcePatientRevision) || sample.sourcePatientRevision < 0 ||
        !Number.isInteger(sample.sourceRuntimeStateVersion) || sample.sourceRuntimeStateVersion < 0 ||
        sample.snapshot.schemaVersion !== LAB_SAMPLE_SNAPSHOT_SCHEMA_VERSION ||
        !sample.snapshot.displayedVitals || !sample.snapshot.targetVitals || !sample.snapshot.runtimeFields ||
        Array.isArray(sample.snapshot.displayedVitals) || Array.isArray(sample.snapshot.targetVitals) ||
        Array.isArray(sample.snapshot.runtimeFields) ||
        !Array.isArray(sample.snapshot.clinicalProcessInputs)) throw new Error("LAB_INVALID_SAMPLE");
      const physiology = sample.snapshot.authoritativePhysiology;
      if (physiology && (![physiology.baselineMinuteVentilationLMin,
        physiology.effectiveMinuteVentilationLMin, physiology.fio2,
        physiology.arterialOxygenSaturationPct, physiology.meanArterialPressureMmHg,
        physiology.temperatureCelsius, physiology.effectiveIntravascularFluidVolumeMl]
        .every(Number.isFinite) || physiology.baselineMinuteVentilationLMin <= 0 ||
        physiology.effectiveMinuteVentilationLMin < 0 || physiology.fio2 < 0.21 || physiology.fio2 > 1 ||
        physiology.arterialOxygenSaturationPct < 0 || physiology.arterialOxygenSaturationPct > 100 ||
        typeof physiology.oxygenSupplyAdequate !== "boolean" || physiology.effectiveIntravascularFluidVolumeMl < 0)) {
        throw new Error("LAB_INVALID_PHYSIOLOGY_SNAPSHOT");
      }
      validTime(sample.sampledAtSimulationTimeSec, "SAMPLE_TIME");
      sampleIds.add(sample.sampleId); sampledOrderIds.add(sample.orderId);
    }
    for (const group of value.resultGroups) {
      const sample = value.samples.find(item => item.sampleId === group.sampleId);
      if (!Object.hasOwn(NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE, group.type) ||
        !["PROCESSING", "PARTIALLY_RESULTED", "RESULTED"].includes(group.status) ||
        groupIds.has(group.resultGroupId) || !sample || group.resultGroupId !== `${group.sampleId}:${group.type}` ||
        group.availableAtSimulationTimeSec !==
        sample.sampledAtSimulationTimeSec + NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE[group.type] ||
        (group.status !== "PROCESSING") !== Boolean(group.resultPayload && group.generationVersion) ||
        (group.status === "PROCESSING" && (group.resultPayload !== undefined || group.generationVersion !== undefined ||
          group.generatedAtSimulationTimeSec !== undefined)) ||
        (group.status !== "PROCESSING" && (group.generatedAtSimulationTimeSec === undefined ||
          group.generatedAtSimulationTimeSec < group.availableAtSimulationTimeSec))) {
        throw new Error("LAB_INVALID_RESULT_GROUP");
      }
      groupIds.add(group.resultGroupId);
    }
    for (const sample of value.samples) {
      const identity = sample.snapshot.patientBloodIdentity;
      const canonical = value.patientBloodIdentities[sample.patientId];
      if (identity && (!canonical || stableJson(identity) !== stableJson(canonical))) {
        throw new Error("LAB_AB0_IDENTITY_CONFLICT");
      }
    }
    for (const [patientId, identity] of Object.entries(value.patientBloodIdentities)) {
      if (!patientId || !["A", "B", "AB", "O"].includes(identity.ab0) ||
        !["POSITIVE", "NEGATIVE"].includes(identity.rhd)) {
        throw new Error("LAB_AB0_IDENTITY_CONFLICT");
      }
    }
    for (const sample of value.samples) {
      const result = sample.snapshot.authoredResults?.antibodyScreen;
      if (result !== undefined && !["POSITIVE", "NEGATIVE"].includes(result)) {
        throw new Error("LAB_INVALID_AUTHORED_RESULT");
      }
    }
    for (const sample of value.samples) {
      const order = value.orders.find(item => item.orderId === sample.orderId)!;
      const expected = resultGroupsForNarvaLabPackage(order.packageId);
      const actual = value.resultGroups.filter(item => item.sampleId === sample.sampleId).map(item => item.type);
      if (expected.some(type => !actual.includes(type)) || actual.length !== expected.length) throw new Error("LAB_RESULT_GROUP_SET_MISMATCH");
      const groups = value.resultGroups.filter(item => item.sampleId === sample.sampleId);
      const resulted = groups.filter(item => item.status === "RESULTED").length;
      const released = groups.filter(item => item.status !== "PROCESSING").length;
      const allowedStatus = resulted === groups.length ? "RESULTED" : released > 0 ? "PARTIALLY_RESULTED" : undefined;
      if (allowedStatus ? order.status !== allowedStatus : !["COLLECTED", "PROCESSING"].includes(order.status)) {
        throw new Error("LAB_ORDER_STATUS_MISMATCH");
      }
    }
    for (const order of value.orders.filter(item => !sampledOrderIds.has(item.orderId))) {
      if (order.status !== "ORDERED") throw new Error("LAB_ORDER_STATUS_MISMATCH");
    }
    if (value.terminalFencedAtSimulationTimeSec !== undefined) validTime(value.terminalFencedAtSimulationTimeSec, "TERMINAL_TIME");
  }
}

export function assertLabPackageAllowed(exercisePackageId: string, requested: NarvaLabPackageId): void {
  const allowed = exercisePackageId === "russicaptor.narva-trauma" ? "NARVA_POLYTRAUMA"
    : exercisePackageId === "russicaptor.narva-iro-evacuation" ? "NARVA_IRO_ASTRUP" : undefined;
  if (requested !== allowed) throw new Error("LAB_PACKAGE_SCOPE_DENIED");
}
