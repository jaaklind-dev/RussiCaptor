import { NARVA_LAB_ANALYTES, resultGroupsForNarvaLabPackage } from
  "@/config/NarvaLaboratoryCatalog";
import type { LaboratoryResultGroup, LabResultGroupType, NarvaLabPackageId } from
  "@/models/LaboratoryWorkflow";

export type LaboratoryAbnormalFlag = "LOW" | "HIGH" | "NORMAL" | "UNCLASSIFIED";
export type LaboratoryPresentedRowState = "RESULT" | "PENDING" | "NOT_APPLICABLE" | "MISSING";
export type LaboratoryPresentedRowKind = "MEASUREMENT" | "QUALITATIVE" | "NOT_APPLICABLE" |
  "SOURCE_AMBIGUOUS" | "PENDING" | "MISSING";

export type LaboratoryPresentedRow = Readonly<{
  key: string;
  analyteId: string;
  name: string;
  state: LaboratoryPresentedRowState;
  kind: LaboratoryPresentedRowKind;
  valueText?: string;
  unit?: string;
  referenceRange?: string;
  sourceMetadata?: string;
  abnormalFlag: LaboratoryAbnormalFlag;
}>;

export type LaboratoryPresentedGroup = Readonly<{
  key: string;
  sampleId: string;
  type: LabResultGroupType;
  title: string;
  status: LaboratoryResultGroup["status"];
  statusLabel: string;
  availableAtSimulationTimeSec: number;
  generatedAtSimulationTimeSec?: number;
  generationVersion?: string;
  rows: readonly LaboratoryPresentedRow[];
  resultCount: number;
  unresolvedCount: number;
}>;

type CanonicalAnalyte = Readonly<{
  analyteId: string;
  value: unknown;
  unit?: string;
  referenceRange?: string;
}>;

const GROUP_TITLES: Readonly<Record<LabResultGroupType, string>> = Object.freeze({
  ASTRUP: "Astrup / veregaasid",
  HEMATOLOGY: "Hematoloogia / hemogramm",
  CLINICAL_CHEMISTRY: "Kliiniline keemia",
  COAGULATION: "Koagulatsioon",
  AB0: "Veregrupp ja antikehad",
});

const STATUS_LABELS: Readonly<Record<LaboratoryResultGroup["status"], string>> = Object.freeze({
  PROCESSING: "Ootel",
  PARTIALLY_RESULTED: "Osaliselt valmis",
  RESULTED: "Valmis",
});

const QUALITATIVE_ANALYTES = new Set(["LAB_AB0", "LAB_RHD", "LAB_ANTIBODY_SCREEN"]);
const SOURCE_AMBIGUOUS_ANALYTES = new Set(["LAB_ASTRUP_HB_FR"]);

function presentedRowKind(analyteId: string, state: LaboratoryPresentedRowState): LaboratoryPresentedRowKind {
  if (state === "RESULT") return QUALITATIVE_ANALYTES.has(analyteId) ? "QUALITATIVE" : "MEASUREMENT";
  if (state === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (state === "PENDING") return SOURCE_AMBIGUOUS_ANALYTES.has(analyteId) ? "SOURCE_AMBIGUOUS" : "PENDING";
  return "MISSING";
}

function arrayOfStrings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function canonicalAnalytes(group: LaboratoryResultGroup): readonly CanonicalAnalyte[] {
  const value = group.resultPayload?.analytes;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CanonicalAnalyte => Boolean(item && typeof item === "object" &&
    "analyteId" in item && typeof item.analyteId === "string" && "value" in item));
}

function qualitativeValue(value: unknown): string {
  if (value === "POSITIVE") return "Positiivne";
  if (value === "NEGATIVE") return "Negatiivne";
  return String(value);
}

function parseSingleReference(referenceRange: string): Readonly<{ low?: number; high?: number }> | undefined {
  const normalized = referenceRange.replace(/,/g, ".").trim();
  if (normalized.includes(";") || /female|male|vary|week|source age band/i.test(normalized)) return undefined;
  const range = normalized.match(/(-?\d+(?:\.\d+)?)\s*[–—-]\s*(-?\d+(?:\.\d+)?)/u);
  if (range) return Object.freeze({ low: Number(range[1]), high: Number(range[2]) });
  const upper = normalized.match(/(?:≤|<=)\s*(-?\d+(?:\.\d+)?)/u);
  if (upper) return Object.freeze({ high: Number(upper[1]) });
  const lower = normalized.match(/(?:≥|>=)\s*(-?\d+(?:\.\d+)?)/u);
  if (lower) return Object.freeze({ low: Number(lower[1]) });
  return undefined;
}

export function laboratoryAbnormalFlag(value: unknown, referenceRange?: string): LaboratoryAbnormalFlag {
  if (typeof value !== "number" || !Number.isFinite(value) || !referenceRange) return "UNCLASSIFIED";
  const limits = parseSingleReference(referenceRange);
  if (!limits) return "UNCLASSIFIED";
  if (limits.low !== undefined && value < limits.low) return "LOW";
  if (limits.high !== undefined && value > limits.high) return "HIGH";
  return "NORMAL";
}

function presentGroup(group: LaboratoryResultGroup): LaboratoryPresentedGroup {
  const definitions = NARVA_LAB_ANALYTES.filter(item => item.resultGroup === group.type &&
    item.reportable !== false);
  const values = new Map<string, CanonicalAnalyte>();
  for (const item of canonicalAnalytes(group)) if (!values.has(item.analyteId)) values.set(item.analyteId, item);
  const pending = new Set(arrayOfStrings(group.resultPayload?.pendingAnalyteIds));
  const notApplicable = new Set(arrayOfStrings(group.resultPayload?.notApplicableAnalyteIds));
  const rows = group.status === "PROCESSING" ? [] : definitions.map(definition => {
    const value = values.get(definition.id);
    const state: LaboratoryPresentedRowState = value ? "RESULT" : pending.has(definition.id)
      ? "PENDING" : notApplicable.has(definition.id) ? "NOT_APPLICABLE" : "MISSING";
    const referenceRange = value?.referenceRange ?? definition.referenceRange;
    return Object.freeze({
      key: `${group.resultGroupId}:${definition.id}`,
      analyteId: definition.id,
      name: definition.name,
      state,
      kind: presentedRowKind(definition.id, state),
      ...(value ? { valueText: qualitativeValue(value.value) } : {}),
      ...(value?.unit && value.unit !== "-" ? { unit: value.unit } :
        definition.unit && definition.unit !== "-" ? { unit: definition.unit } : {}),
      ...(referenceRange ? { referenceRange } : {}),
      ...(definition.sourceMetadata ? { sourceMetadata: definition.sourceMetadata } : {}),
      abnormalFlag: value ? laboratoryAbnormalFlag(value.value, referenceRange) : "UNCLASSIFIED",
    });
  });
  return Object.freeze({
    key: group.resultGroupId,
    sampleId: group.sampleId,
    type: group.type,
    title: GROUP_TITLES[group.type],
    status: group.status,
    statusLabel: STATUS_LABELS[group.status],
    availableAtSimulationTimeSec: group.availableAtSimulationTimeSec,
    ...(group.generatedAtSimulationTimeSec !== undefined
      ? { generatedAtSimulationTimeSec: group.generatedAtSimulationTimeSec } : {}),
    ...(group.generationVersion ? { generationVersion: group.generationVersion } : {}),
    rows: Object.freeze(rows),
    resultCount: rows.filter(item => item.state === "RESULT").length,
    unresolvedCount: rows.filter(item => item.state !== "RESULT" && item.state !== "NOT_APPLICABLE").length,
  });
}

export function buildLaboratoryResultPresentation(
  groups: readonly LaboratoryResultGroup[],
  packageId: NarvaLabPackageId,
): readonly LaboratoryPresentedGroup[] {
  const order = resultGroupsForNarvaLabPackage(packageId);
  const rank = new Map(order.map((type, index) => [type, index]));
  return Object.freeze([...groups].sort((left, right) =>
    (rank.get(left.type) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.type) ?? Number.MAX_SAFE_INTEGER) ||
    left.resultGroupId.localeCompare(right.resultGroupId)).map(presentGroup));
}
