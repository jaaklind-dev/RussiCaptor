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
import type { VitalSignContributor, VitalSignKey } from "@/models/VitalSign";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";

const constants = {
  hrDeltaCap: 35,
  rrDeltaCap: 12,
  sbpSupportCap: 20,
  criticalRecoverySec: 120,
  attributionMaxSecondary: 5,
};

const vitalRules = {
  hr: { min: defaultVitalSignConfiguration.signs.heartRate.min, max: defaultVitalSignConfiguration.signs.heartRate.max, smoothing: defaultVitalSignConfiguration.signs.heartRate.responseFactor, maxChange: defaultVitalSignConfiguration.signs.heartRate.maxChangePerTick },
  sbp: { min: defaultVitalSignConfiguration.signs.systolicBp.min, max: defaultVitalSignConfiguration.signs.systolicBp.max, smoothing: defaultVitalSignConfiguration.signs.systolicBp.responseFactor, maxChange: defaultVitalSignConfiguration.signs.systolicBp.maxChangePerTick },
  dbp: { min: defaultVitalSignConfiguration.signs.diastolicBp.min, max: defaultVitalSignConfiguration.signs.diastolicBp.max, smoothing: defaultVitalSignConfiguration.signs.diastolicBp.responseFactor, maxChange: defaultVitalSignConfiguration.signs.diastolicBp.maxChangePerTick },
  rr: { min: defaultVitalSignConfiguration.signs.respiratoryRate.min, max: defaultVitalSignConfiguration.signs.respiratoryRate.max, smoothing: defaultVitalSignConfiguration.signs.respiratoryRate.responseFactor, maxChange: defaultVitalSignConfiguration.signs.respiratoryRate.maxChangePerTick },
  spo2: { min: defaultVitalSignConfiguration.signs.spo2.min, max: defaultVitalSignConfiguration.signs.spo2.max, smoothing: defaultVitalSignConfiguration.signs.spo2.responseFactor, maxChange: defaultVitalSignConfiguration.signs.spo2.maxChangePerTick },
  temperature: { min: defaultVitalSignConfiguration.signs.temperature.min, max: defaultVitalSignConfiguration.signs.temperature.max, smoothing: defaultVitalSignConfiguration.signs.temperature.responseFactor, maxChange: defaultVitalSignConfiguration.signs.temperature.maxChangePerTick },
  crt: { min: 0, max: 10, smoothing: 0.5, maxChange: 2 },
} as const;

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

type VitalName = keyof typeof vitalRules;
type RangeField = "hrTargetRange" | "sbpTargetRange" | "dbpTargetRange" | "rrTargetRange";
type PriorityField = "vitalPriority" | "respiratoryPriority" | "oxygenationPriority" | "neurologicPriority" | "statusPriority";

function midpoint(range: NumericRange): number {
  return (range.min + range.max) / 2;
}

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

function capContribution(
  values: number[],
  cap: number,
  field: string,
  events: AggregationEvent[]
): number {
  const raw = values.reduce((sum, value) => sum + value, 0);
  const applied = clamp(raw, -cap, cap);
  if (applied !== raw) {
    events.push({ eventType: "AGGREGATION_CAP_APPLIED", field, details: { raw, applied, cap } });
  }
  return applied;
}

function clampVital(
  field: VitalName,
  value: number,
  events: AggregationEvent[]
): number {
  const rule = vitalRules[field];
  const clamped = clamp(value, rule.min, rule.max);
  if (clamped !== value) {
    events.push({ eventType: "VALUE_CLAMPED", field, details: { raw: value, clamped } });
  }
  return clamped;
}

function smoothVital(field: VitalName, previous: number | undefined, target: number): number {
  if (previous === undefined) return target;
  const rule = vitalRules[field];
  const desiredChange = (target - previous) * rule.smoothing;
  return clampVitalWithoutEvent(previous + clamp(desiredChange, -rule.maxChange, rule.maxChange), rule.min, rule.max);
}

function clampVitalWithoutEvent(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function dominantRange(
  outputs: ProcessOutput[],
  rangeField: RangeField,
  priorityField: PriorityField,
  restrictiveLow = false
): ProcessOutput | undefined {
  const candidates = outputs.filter((output) => validRange(output[rangeField]));
  return stableSort(candidates, priorityField, restrictiveLow
    ? (left, right) => midpoint(left[rangeField]!) - midpoint(right[rangeField]!)
    : undefined)[0];
}

function aggregateVitals(
  outputs: ProcessOutput[],
  previous: RuntimeState,
  events: AggregationEvent[]
): { targets: RuntimeVitalTargets; attribution: RuntimeState["vitalAttribution"] } {
  const targets: RuntimeVitalTargets = { ...previous.targetVitals };
  const attribution: RuntimeState["vitalAttribution"] = {};

  const hrPrimary = dominantRange(outputs, "hrTargetRange", "vitalPriority");
  if (hrPrimary?.hrTargetRange) {
    const contributors = outputs.filter((output) => output.processId !== hrPrimary.processId && Number.isFinite(output.hrDelta));
    const applied = capContribution(contributors.map((output) => output.hrDelta!), constants.hrDeltaCap, "hr", events);
    targets.hr = clampVital("hr", midpoint(hrPrimary.hrTargetRange) + applied, events);
    attribution.hr = {
      primaryProcessId: hrPrimary.processId,
      contributorProcessIds: contributors.slice(0, constants.attributionMaxSecondary).map((item) => item.processId),
      rawContributions: contributors.map((item) => item.hrDelta!),
      appliedContribution: applied,
    };
  }

  const sbpPrimary = dominantRange(outputs, "sbpTargetRange", "vitalPriority", true);
  if (sbpPrimary?.sbpTargetRange) {
    const supporters = outputs.filter((output) => output.processId !== sbpPrimary.processId && Number.isFinite(output.sbpSupportDelta));
    const support = capContribution(supporters.map((output) => output.sbpSupportDelta!), constants.sbpSupportCap, "sbp", events);
    targets.sbp = clampVital("sbp", midpoint(sbpPrimary.sbpTargetRange) + support, events);
    attribution.sbp = {
      primaryProcessId: sbpPrimary.processId,
      contributorProcessIds: supporters.slice(0, constants.attributionMaxSecondary).map((item) => item.processId),
      rawContributions: supporters.map((item) => item.sbpSupportDelta!),
      appliedContribution: support,
    };
  }

  const dbpPrimary = dominantRange(outputs, "dbpTargetRange", "vitalPriority", true);
  if (dbpPrimary?.dbpTargetRange) {
    targets.dbp = clampVital("dbp", midpoint(dbpPrimary.dbpTargetRange), events);
    attribution.dbp = { primaryProcessId: dbpPrimary.processId, contributorProcessIds: [] };
  } else if (targets.sbp !== undefined) {
    targets.dbp = clampVital("dbp", Math.min(targets.sbp - 1, targets.sbp * 0.6), events);
    attribution.dbp = { primaryProcessId: "SYSTEM_DERIVED", contributorProcessIds: [] };
  }

  const rrPrimary = dominantRange(outputs, "rrTargetRange", "respiratoryPriority");
  if (rrPrimary?.rrTargetRange) {
    const contributors = outputs.filter((output) => output.processId !== rrPrimary.processId && Number.isFinite(output.rrDelta));
    const applied = capContribution(contributors.map((output) => output.rrDelta!), constants.rrDeltaCap, "rr", events);
    targets.rr = clampVital("rr", midpoint(rrPrimary.rrTargetRange) + applied, events);
    attribution.rr = {
      primaryProcessId: rrPrimary.processId,
      contributorProcessIds: contributors.slice(0, constants.attributionMaxSecondary).map((item) => item.processId),
      rawContributions: contributors.map((item) => item.rrDelta!),
      appliedContribution: applied,
    };
  }

  const spo2Candidates = outputs.filter((output) => Number.isFinite(output.spo2Ceiling));
  const spo2Primary = [...spo2Candidates].sort((left, right) =>
    left.spo2Ceiling! - right.spo2Ceiling! ||
    score(right, "oxygenationPriority") - score(left, "oxygenationPriority") ||
    left.processId.localeCompare(right.processId)
  )[0];
  if (spo2Primary) {
    targets.spo2 = clampVital("spo2", spo2Primary.spo2Ceiling!, events);
    attribution.spo2 = { primaryProcessId: spo2Primary.processId, contributorProcessIds: [] };
  }

  const temperaturePrimary = stableSort(
    outputs.filter((output) => Number.isFinite(output.temperatureTarget)), "vitalPriority"
  )[0];
  if (temperaturePrimary?.temperatureTarget !== undefined) {
    const deltas = outputs.filter((output) => Number.isFinite(output.temperatureDelta));
    const delta = capContribution(deltas.map((output) => output.temperatureDelta!), 2, "temperature", events);
    targets.temperature = clampVital("temperature", temperaturePrimary.temperatureTarget + delta, events);
    attribution.temperature = {
      primaryProcessId: temperaturePrimary.processId,
      contributorProcessIds: deltas.slice(0, constants.attributionMaxSecondary).map((item) => item.processId),
      rawContributions: deltas.map((item) => item.temperatureDelta!),
      appliedContribution: delta,
    };
  }

  const crtCandidates = outputs.filter((output) => Number.isFinite(output.crtTarget));
  const crtPrimary = [...crtCandidates].sort((left, right) =>
    right.crtTarget! - left.crtTarget! || left.processId.localeCompare(right.processId)
  )[0];
  if (crtPrimary) {
    targets.crt = clampVital("crt", crtPrimary.crtTarget!, events);
    attribution.crt = { primaryProcessId: crtPrimary.processId, contributorProcessIds: [] };
  }

  return { targets, attribution };
}

const runtimeToVital: Partial<Record<keyof RuntimeVitalTargets, VitalSignKey>> = {
  hr: "heartRate", sbp: "systolicBp", dbp: "diastolicBp", rr: "respiratoryRate",
  spo2: "spo2", temperature: "temperature",
};

function synthesizeMonitor(
  previous: RuntimeState,
  targets: RuntimeVitalTargets,
  attribution: RuntimeState["vitalAttribution"],
  outputs: ProcessOutput[],
  gcs: number | undefined,
  exerciseTimeSec: number,
  events: AggregationEvent[]
) {
  const configuration = previous.vitalSignConfiguration ?? defaultVitalSignConfiguration;
  const contributors: VitalSignContributor[] = Object.entries(targets).flatMap(([field, value]) => {
    const vital = runtimeToVital[field as keyof RuntimeVitalTargets];
    return vital && typeof value === "number" ? [{
      contributorId: `runtime-target:${field}`, sourceType: "RUNTIME_TARGET" as const,
      sourceId: attribution[field]?.primaryProcessId ?? "RUNTIME_AGGREGATION",
      layer: "PROCESS" as const, vital, operation: "TARGET" as const, value,
    }] : [];
  });
  for (const output of [...outputs].sort((a, b) => a.processId.localeCompare(b.processId))) {
    for (const [index, item] of (output.vitalContributions ?? []).entries()) {
      contributors.push({ contributorId: `${output.processId}:${index}`, sourceType: "PATIENT_PROCESS", sourceId: output.processId, layer: "PROCESS", ...item });
    }
  }
  if (gcs !== undefined) contributors.push({ contributorId: "runtime-target:gcs", sourceType: "RUNTIME_TARGET", sourceId: "RUNTIME_AGGREGATION", layer: "PROCESS", vital: "gcs", operation: "TARGET", value: gcs });
  let previousMonitor = previous.vitalSignState;
  if (!previousMonitor && Object.keys(previous.displayedVitals).length > 0) {
    previousMonitor = new VitalSignEngine().resolve({ timestamp: previous.exerciseTimeSec, configuration, contributors: [] }).state;
    for (const [runtimeField, vital] of Object.entries(runtimeToVital) as [keyof RuntimeVitalTargets, VitalSignKey][]) {
      const value = previous.displayedVitals[runtimeField];
      if (typeof value === "number") previousMonitor.readings[vital] = { ...previousMonitor.readings[vital], current: value, target: previous.targetVitals[runtimeField] ?? value };
    }
  }
  const resolved = new VitalSignEngine().resolve({
    timestamp: exerciseTimeSec,
    configuration,
    previous: previousMonitor,
    contributors,
  });
  events.push(...resolved.events.map(event => ({ eventType: event.eventType, field: event.vital, details: { from: event.from, to: event.to, sourceProcessId: event.sourceProcessId } })));
  return resolved.state;
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

function applyOverrides(
  input: AggregationInput,
  state: RuntimeState,
  events: AggregationEvent[]
): void {
  const targetMap: Record<string, keyof RuntimeVitalTargets> = {
    hrTarget: "hr", sbpTarget: "sbp", dbpTarget: "dbp", rrTarget: "rr",
    spo2Target: "spo2", temperatureTarget: "temperature", crtSec: "crt",
  };
  const active = (input.overrides ?? []).filter((override) =>
    override.expiresAtSec === undefined || override.expiresAtSec >= input.exerciseTimeSec
  );
  for (const override of active) {
    if (!override.authorized) {
      events.push({ eventType: "MANUAL_OVERRIDE_REJECTED", field: override.field, details: { eventId: override.eventId, actorId: override.actorId } });
      continue;
    }
    const vital = targetMap[override.field];
    if (vital && typeof override.value === "number") {
      state.targetVitals[vital] = clampVital(vital, override.value, events);
      state.displayedVitals[vital] = state.targetVitals[vital];
    } else if (
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

export function aggregateRuntimeState(
  input: AggregationInput,
  resolver: RuntimeOwnershipResolver
): AggregationResult {
  if (input.expectedStateVersion !== input.previous.stateVersion) {
    throw new Error(`RUNTIME_COMMIT_CONFLICT: oodatud ${input.expectedStateVersion}, tegelik ${input.previous.stateVersion}.`);
  }
  const events: AggregationEvent[] = [{ eventType: "AGGREGATION_STARTED" }];
  const normalized = normalizeOutputs(input, events);
  const outputs = normalized.accepted;
  const vitals = aggregateVitals(outputs, input.previous, events);
  const mental = aggregateMentalStatus(outputs, resolver, events);
  const status = aggregateStatus(input, outputs, resolver, events);
  const collections = aggregateCollections(outputs);
  const runtimeFields = aggregateRuntimeFields(input.previous, outputs, resolver, events);
  const dominant = [...outputs].sort((left, right) =>
    right.globalSeverityScore - left.globalSeverityScore || left.processId.localeCompare(right.processId)
  )[0];
  const monitor = synthesizeMonitor(input.previous, vitals.targets, vitals.attribution, outputs, status.status === "Arrest" ? 3 : mental.gcs, input.exerciseTimeSec, events);

  const state: RuntimeState = {
    ...structuredClone(input.previous),
    stateVersion: input.previous.stateVersion + 1,
    exerciseTimeSec: input.exerciseTimeSec,
    globalStatus: status.status,
    dominantProcessId: status.primaryProcessId ?? dominant?.processId,
    targetVitals: vitals.targets,
    displayedVitals: {
      hr: monitor.readings.heartRate.current, sbp: monitor.readings.systolicBp.current,
      dbp: monitor.readings.diastolicBp.current, rr: monitor.readings.respiratoryRate.current,
      spo2: monitor.readings.spo2.current, temperature: monitor.readings.temperature.current,
      crt: vitals.targets.crt === undefined ? input.previous.displayedVitals.crt : smoothVital("crt", input.previous.displayedVitals.crt, vitals.targets.crt),
    },
    vitalSignState: monitor,
    vitalSignConfiguration: input.previous.vitalSignConfiguration ?? defaultVitalSignConfiguration,
    mapCalculated: monitor.derived.meanArterialPressure,
    mentalStatusCode: status.status === "Arrest" ? "Arrest" : mental.value,
    gcsTarget: status.status === "Arrest" ? 3 : mental.gcs,
    symptomTags: collections.symptomTags,
    visibleFindings: collections.visibleFindings,
    activeAlerts: collections.activeAlerts,
    runtimeFields,
    vitalAttribution: vitals.attribution,
    statusAttribution: {
      primaryProcessId: status.primaryProcessId,
      supportingProcessIds: status.supportingProcessIds,
    },
    criticalClearSinceSec: status.clearSince,
    aggregationConfigVersion: input.aggregationConfigVersion,
  };
  applyOverrides(input, state, events);
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

export async function commitAggregationResult(
  result: AggregationResult,
  expectedStateVersion: number,
  committer: { commit(result: AggregationResult, expectedStateVersion: number): Promise<void> }
): Promise<void> {
  await committer.commit(result, expectedStateVersion);
}
