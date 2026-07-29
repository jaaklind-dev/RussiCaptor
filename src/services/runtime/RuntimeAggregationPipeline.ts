import type {
  AggregationEvent,
  AggregationInput,
  AggregationResult,
  MentalStatusCode,
  NumericRange,
  ProcessOutput,
  RuntimeFinding,
  RuntimeState,
  RuntimeStatus,
  RuntimeVitalTargets,
} from "@/models/RuntimeAggregation";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import type { VitalRuntimeResolution } from "@/services/runtime/vitals/VitalSignRuntimeResolver";
import { projectVitalSignState } from "@/services/runtime/vitals/VitalSignProjection";

const constants = {
  criticalRecoverySec: 120,
  attributionMaxSecondary: 5,
};

const mentalRank: Record<MentalStatusCode, number> = {
  Alert: 0,
  Anxious: 1,
  Confused: 2,
  Drowsy: 3,
  Obtunded: 4,
  Unresponsive: 5,
  Arrest: 6,
};

const statusRank: Record<RuntimeStatus, number> = {
  Stable: 0,
  Resolved: 0,
  Critical: 1,
  Arrest: 2,
  Dead: 3,
};

type RangeField = "hrTargetRange" | "sbpTargetRange" | "dbpTargetRange" | "rrTargetRange";
type PriorityField = "vitalPriority" | "respiratoryPriority" | "oxygenationPriority" | "neurologicPriority" | "statusPriority";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function score(output: ProcessOutput, priority: PriorityField): number {
  return (output[priority] ?? 10) * output.globalSeverityScore;
}

function stableSort(
  outputs: ProcessOutput[],
  priority: PriorityField,
  secondary?: (left: ProcessOutput, right: ProcessOutput) => number
): ProcessOutput[] {
  return [...outputs].sort((left, right) =>
    score(right, priority) - score(left, priority) ||
    (secondary?.(left, right) ?? 0) ||
    left.processId.localeCompare(right.processId)
  );
}

function stableValueKey(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function validRange(value: NumericRange | undefined): value is NumericRange {
  return Boolean(value && Number.isFinite(value.min) && Number.isFinite(value.max) && value.min <= value.max);
}

function normalizeOutputs(
  input: AggregationInput,
  events: AggregationEvent[]
): { accepted: ProcessOutput[]; rejectedIds: string[] } {
  const accepted: ProcessOutput[] = [];
  const rejectedIds: string[] = [];
  for (const source of [...input.processOutputs].sort((left, right) =>
    left.processId.localeCompare(right.processId)
  )) {
    if (source.encounterId !== input.previous.encounterId) {
      rejectedIds.push(source.processId);
      events.push({
        eventType: "PROCESS_OUTPUT_REJECTED",
        processId: source.processId,
        details: { reason: "ProcessOutput ei kuulu praeguse Encounteri alla." },
      });
      continue;
    }
    if (source.status !== "Active" && source.status !== "Controlled") continue;
    const output = structuredClone(source);
    if (!Number.isFinite(output.globalSeverityScore)) {
      rejectedIds.push(source.processId);
      events.push({ eventType: "PROCESS_OUTPUT_REJECTED", processId: source.processId, details: { reason: "globalSeverityScore on vigane." } });
      continue;
    }
    output.globalSeverityScore = clamp(output.globalSeverityScore, 0, 1);
    for (const field of ["hrTargetRange", "sbpTargetRange", "dbpTargetRange", "rrTargetRange"] as RangeField[]) {
      if (output[field] && !validRange(output[field])) {
        delete output[field];
        events.push({ eventType: "PROCESS_OUTPUT_REJECTED", processId: source.processId, field, details: { reason: "Vigane target range eemaldati." } });
      }
    }
    accepted.push(output);
  }
  return { accepted, rejectedIds };
}

function authorizeContribution(
  resolver: RuntimeOwnershipResolver,
  field: string,
  output: ProcessOutput,
  events: AggregationEvent[]
): boolean {
  try {
    const decision = resolver.authorize({
      objectType: "RuntimeField",
      field,
      writerId: output.moduleId,
      writerKind: "PROCESS",
      channel: "PROCESS_CONTRIBUTION",
      attributed: true,
      active: true,
    });
    if (!decision.accepted) {
      events.push({
        eventType: "PROCESS_OUTPUT_REJECTED",
        processId: output.processId,
        field,
        details: { reason: decision.reason, conflictAction: decision.conflictAction },
      });
    }
    return decision.accepted;
  } catch (error) {
    events.push({
      eventType: "PROCESS_OUTPUT_REJECTED",
      processId: output.processId,
      field,
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
    return false;
  }
}

function aggregateMentalStatus(
  outputs: ProcessOutput[],
  resolver: RuntimeOwnershipResolver,
  events: AggregationEvent[]
): { value: MentalStatusCode; primaryProcessId?: string; supportingProcessIds: string[]; gcs?: number } {
  const candidates = outputs.filter((output) =>
    output.mentalStatusCeiling && authorizeContribution(resolver, "mentalStatusCode", output, events)
  );
  const ranked = [...candidates].sort((left, right) =>
    mentalRank[right.mentalStatusCeiling!] - mentalRank[left.mentalStatusCeiling!] ||
    score(right, "neurologicPriority") - score(left, "neurologicPriority") ||
    left.processId.localeCompare(right.processId)
  );
  const primary = ranked[0];
  if (!primary?.mentalStatusCeiling) return { value: "Alert", supportingProcessIds: [] };
  const winningRank = mentalRank[primary.mentalStatusCeiling];
  return {
    value: primary.mentalStatusCeiling,
    primaryProcessId: primary.processId,
    supportingProcessIds: ranked.filter((item) =>
      item.processId !== primary.processId && mentalRank[item.mentalStatusCeiling!] >= winningRank
    ).slice(0, constants.attributionMaxSecondary).map((item) => item.processId),
    gcs: primary.gcsCeiling,
  };
}

function aggregateStatus(
  input: AggregationInput,
  outputs: ProcessOutput[],
  resolver: RuntimeOwnershipResolver,
  events: AggregationEvent[]
): { status: RuntimeStatus; primaryProcessId?: string; supportingProcessIds: string[]; clearSince?: number } {
  if (input.previous.globalStatus === "Dead") {
    return { status: "Dead", ...input.previous.statusAttribution };
  }
  const candidates = outputs.filter((output) =>
    output.statusProposal && authorizeContribution(resolver, "globalStatus", output, events)
  ).sort((left, right) =>
    statusRank[right.statusProposal!] - statusRank[left.statusProposal!] ||
    score(right, "statusPriority") - score(left, "statusPriority") ||
    left.processId.localeCompare(right.processId)
  );
  const primary = candidates[0];
  let status = primary?.statusProposal ?? "Stable";
  let clearSince = input.previous.criticalClearSinceSec;
  if (input.previous.globalStatus === "Critical" && status === "Stable") {
    clearSince ??= input.exerciseTimeSec;
    if (input.exerciseTimeSec - clearSince < constants.criticalRecoverySec) status = "Critical";
    else clearSince = undefined;
  } else if (status !== "Stable") {
    clearSince = undefined;
  }
  return {
    status,
    primaryProcessId: primary?.processId,
    supportingProcessIds: candidates.filter((item) => item.processId !== primary?.processId && item.statusProposal === status)
      .slice(0, constants.attributionMaxSecondary).map((item) => item.processId),
    clearSince,
  };
}

function aggregateCollections(outputs: ProcessOutput[]) {
  const symptomTags = [...new Set(outputs.flatMap((output) => output.symptomTags ?? []))].sort();
  const activeAlerts = [...new Set(outputs.flatMap((output) => output.alerts ?? []))].sort();
  const findings = new Map<string, RuntimeFinding>();
  for (const finding of outputs.flatMap((output) => output.visibleFindings ?? [])) {
    if (finding.visible === false) continue;
    const findingKey = `${finding.code}\u0000${finding.location ?? ""}`;
    const existing = findings.get(findingKey);
    if (!existing || (finding.severity ?? 0) > (existing.severity ?? 0)) findings.set(findingKey, finding);
  }
  return {
    symptomTags,
    activeAlerts,
    visibleFindings: [...findings.values()].sort((a, b) =>
      a.code.localeCompare(b.code) || (a.location ?? "").localeCompare(b.location ?? "")
    ),
  };
}

function aggregateRuntimeFields(
  previous: RuntimeState,
  outputs: ProcessOutput[],
  resolver: RuntimeOwnershipResolver,
  events: AggregationEvent[]
): Record<string, unknown> {
  const result = { ...previous.runtimeFields };
  const fields = [...new Set(outputs.flatMap((output) => Object.keys(output.runtimeContributions ?? {})))];
  for (const field of fields) {
    const candidates = outputs.filter((output) =>
      output.runtimeContributions?.[field] !== undefined && authorizeContribution(resolver, field, output, events)
    );
    if (candidates.length === 0) continue;
    const ownership = resolver.resolve("RuntimeField", field);
    const rule = ownership.aggregationOrWriteRule.toUpperCase();
    if (rule.includes("UNION")) {
      const values = candidates.flatMap((output) => {
        const value = output.runtimeContributions![field];
        return Array.isArray(value) ? value : [value];
      });
      result[field] = [...new Map(values.map((value) => [stableValueKey(value), value])).entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, value]) => value);
      continue;
    }
    const latest = rule.includes("LATEST") || rule.includes("MEASURED")
      ? [...candidates].sort((a, b) => (b.observedAtSec ?? 0) - (a.observedAtSec ?? 0) || a.processId.localeCompare(b.processId))[0]
      : stableSort(candidates, "vitalPriority")[0];
    result[field] = latest.runtimeContributions![field];
    if (candidates.length > 1 && !rule.includes("UNION")) {
      events.push({
        eventType: "AGGREGATION_CONFLICT_RESOLVED",
        field,
        details: { winner: latest.processId, suppressed: candidates.filter((item) => item !== latest).map((item) => item.processId) },
      });
    }
  }
  return result;
}

function applyNonVitalOverrides(
  input: AggregationInput,
  state: RuntimeState,
  events: AggregationEvent[],
  resolvedVitalFields: Set<string>
): void {
  const targetMap: Record<string, keyof RuntimeVitalTargets> = {
    hrTarget: "hr", sbpTarget: "sbp", dbpTarget: "dbp", rrTarget: "rr",
    spo2Target: "spo2", temperatureTarget: "temperature", crtSec: "crt",
  };
  const active = (input.overrides ?? []).filter((override) =>
    override.expiresAtSec === undefined || override.expiresAtSec >= input.exerciseTimeSec
  );
  for (const override of active) {
    if (targetMap[override.field]) {
      if (resolvedVitalFields.has(override.field)) state.overrideMap[override.field] = override.value;
      continue;
    }
    if (!override.authorized) {
      events.push({ eventType: "MANUAL_OVERRIDE_REJECTED", field: override.field, details: { eventId: override.eventId, actorId: override.actorId } });
      continue;
    }
    if (
      override.field === "mentalStatusCode" &&
      typeof override.value === "string" &&
      override.value in mentalRank
    ) {
      state.mentalStatusCode = override.value as MentalStatusCode;
    } else if (override.field in state.runtimeFields) {
      state.runtimeFields[override.field] = override.value;
    } else {
      events.push({ eventType: "MANUAL_OVERRIDE_REJECTED", field: override.field, details: { reason: "Väli pole override'iks lubatud." } });
      continue;
    }
    state.overrideMap[override.field] = override.value;
    events.push({ eventType: "MANUAL_OVERRIDE_APPLIED", field: override.field, details: { eventId: override.eventId, actorId: override.actorId } });
  }
  state.manualOverrideActive = Object.keys(state.overrideMap).length > 0;
}

export function prepareProcessOutputs(input: AggregationInput): ProcessOutput[] {
  return normalizeOutputs(input, []).accepted;
}

export function aggregateResolvedRuntimeState(
  input: AggregationInput,
  resolver: RuntimeOwnershipResolver,
  vitalResolution: VitalRuntimeResolution
): AggregationResult {
  if (input.expectedStateVersion !== input.previous.stateVersion) {
    throw new Error(`RUNTIME_COMMIT_CONFLICT: oodatud ${input.expectedStateVersion}, tegelik ${input.previous.stateVersion}.`);
  }
  const events: AggregationEvent[] = [{ eventType: "AGGREGATION_STARTED" }, ...vitalResolution.events];
  const normalized = normalizeOutputs(input, events);
  const outputs = normalized.accepted;
  const mental = aggregateMentalStatus(outputs, resolver, events);
  const status = aggregateStatus(input, outputs, resolver, events);
  const collections = aggregateCollections(outputs);
  const runtimeFields = aggregateRuntimeFields(input.previous, outputs, resolver, events);
  const dominant = [...outputs].sort((left, right) =>
    right.globalSeverityScore - left.globalSeverityScore || left.processId.localeCompare(right.processId)
  )[0];
  const monitor = vitalResolution.state;
  const projection = projectVitalSignState(monitor);

  const state: RuntimeState = {
    ...structuredClone(input.previous),
    stateVersion: input.previous.stateVersion + 1,
    exerciseTimeSec: input.exerciseTimeSec,
    globalStatus: status.status,
    dominantProcessId: status.primaryProcessId ?? dominant?.processId,
    targetVitals: projection.targetVitals,
    displayedVitals: projection.displayedVitals,
    vitalSignState: monitor,
    vitalSignConfiguration: vitalResolution.configuration,
    mapCalculated: projection.mapCalculated,
    mentalStatusCode: status.status === "Arrest" ? "Arrest" : mental.value,
    gcsTarget: projection.gcsTarget,
    symptomTags: collections.symptomTags,
    visibleFindings: collections.visibleFindings,
    activeAlerts: collections.activeAlerts,
    runtimeFields,
    vitalAttribution: vitalResolution.attribution,
    statusAttribution: {
      primaryProcessId: status.primaryProcessId,
      supportingProcessIds: status.supportingProcessIds,
    },
    criticalClearSinceSec: status.clearSince,
    aggregationConfigVersion: input.aggregationConfigVersion,
  };
  applyNonVitalOverrides(input, state, events, new Set(vitalResolution.acceptedOverrideFields));
  if (state.globalStatus !== input.previous.globalStatus) {
    events.push({ eventType: "GLOBAL_STATUS_CHANGED", details: { from: input.previous.globalStatus, to: state.globalStatus } });
  }
  events.push({ eventType: "AGGREGATION_COMPLETED", details: { stateVersion: state.stateVersion } });
  return {
    state,
    events,
    acceptedProcessIds: outputs.map((output) => output.processId),
    rejectedProcessIds: normalized.rejectedIds,
  };
}

// Compatibility import path for pre-freeze callers and unchanged Golden tests.
export { aggregateRuntimeState } from "@/services/runtime/AlignedRuntimePipeline";

export async function commitAggregationResult(
  result: AggregationResult,
  expectedStateVersion: number,
  committer: { commit(result: AggregationResult, expectedStateVersion: number): Promise<void> }
): Promise<void> {
  await committer.commit(result, expectedStateVersion);
}
