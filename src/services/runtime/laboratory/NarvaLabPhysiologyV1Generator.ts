import { NARVA_LAB_ANALYTES } from "@/config/NarvaLaboratoryCatalog";
import type { LabResultGroupType, LabSamplePhysiologySnapshot, LaboratoryResultGenerator } from
  "@/models/LaboratoryWorkflow";
import { deriveNarvaLabPatientBloodIdentity } from "./NarvaLabPatientIdentity";

export const NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION = "narva-lab-physiology-v1" as const;
export const NARVA_LAB_STATIC_GENERATOR_VERSION = "narva-lab-static-v1" as const;

type GeneratedAnalyte = Readonly<{
  analyteId: string;
  value: number | string;
  unit: string;
  sourceCode?: string;
  referenceRange?: string;
  valueSource: "PHYSIOLOGY_V1" | "STATIC_BASELINE" | "SCENARIO_OVERRIDE" | "BLOOD_BANK_IDENTITY" |
    "AUTHORED_SAMPLE_RESULT";
}>;

type ProductTotals = Readonly<{
  rbcUnits: number;
  plasmaUnits: number;
  plateletUnits: number;
  totalVolumeMl: number;
  calciumAdministrations: readonly Readonly<{ completedAtSec: number }> [];
}>;

const finite = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const bounded = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));
const rounded = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const rows = (value: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(value) ? value.flatMap(item => record(item) ? [record(item)!] : []) : [];

function displayed(snapshot: LabSamplePhysiologySnapshot, names: readonly string[], fallback: number): number {
  for (const name of names) {
    const value = snapshot.displayedVitals[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function process(snapshot: LabSamplePhysiologySnapshot, type: string): readonly Record<string, unknown>[] {
  return snapshot.clinicalProcessInputs.filter(item => item.processType === type)
    .map(item => ({ ...item.runtimeContributions, ...(item.clinicalState ?? {}) }));
}

function productTotals(snapshot: LabSamplePhysiologySnapshot): ProductTotals {
  const mtp = process(snapshot, "MASSIVE_TRANSFUSION")[0];
  const administrations = rows(mtp?.administrations);
  const units = (product: string): number => administrations.reduce((sum, item) =>
    item.product === product ? sum + finite(item.deliveredUnits) : sum, 0);
  const calcium = record(mtp?.transfusionCalcium);
  return Object.freeze({
    rbcUnits: units("RBC"), plasmaUnits: units("PLASMA"), plateletUnits: units("PLATELETS"),
    totalVolumeMl: administrations.reduce((sum, item) => sum + finite(item.deliveredVolumeMl), 0),
    calciumAdministrations: rows(calcium?.calciumAdministrations).map(item => Object.freeze({
      completedAtSec: finite(item.completedAtSec),
    })),
  });
}

function hemorrhageInputs(snapshot: LabSamplePhysiologySnapshot): Readonly<{
  bloodLossMl: number;
  activeBleeding: boolean;
  coagulationFactor: number;
  fibrinogenDoseG: number;
  fibrinolysisFactor: number;
}> {
  const values = process(snapshot, "HEMORRHAGE");
  return Object.freeze({
    bloodLossMl: values.reduce((sum, item) => sum + finite(item.cumulativeLossMl,
      finite(item.cumulativeBloodLossMl)), 0),
    activeBleeding: values.some(item => item.activeHemorrhage === true || finite(item.bleedingRateMlMin) > 0),
    coagulationFactor: Math.max(1, ...values.map(item => finite(item.coagulationFactor, 1))),
    fibrinogenDoseG: Math.max(0, ...values.map(item => finite(item.fibrinogenDoseG))),
    fibrinolysisFactor: Math.max(1, ...values.map(item => finite(item.effectiveFibrinolysisFactor, 1))),
  });
}

function physiology(snapshot: LabSamplePhysiologySnapshot) {
  const explicit = snapshot.authoritativePhysiology;
  const systolic = displayed(snapshot, ["systolicBp", "sbp"], 120);
  const diastolic = displayed(snapshot, ["diastolicBp", "dbp"], 75);
  const respiratoryRate = displayed(snapshot, ["respiratoryRate", "rr"], 14);
  return {
    baselineMinuteVentilationLMin: explicit?.baselineMinuteVentilationLMin ?? respiratoryRate * 0.42,
    effectiveMinuteVentilationLMin: explicit?.effectiveMinuteVentilationLMin ?? respiratoryRate * 0.42,
    fio2: explicit?.fio2 ?? 0.21,
    oxygenSupplyAdequate: explicit?.oxygenSupplyAdequate ?? true,
    spo2: explicit?.arterialOxygenSaturationPct ?? displayed(snapshot, ["spo2", "SpO2"], 97),
    map: explicit?.meanArterialPressureMmHg ?? (systolic + 2 * diastolic) / 3,
    temperature: explicit?.temperatureCelsius ?? displayed(snapshot, ["temperature"], 37),
    effectiveFluidMl: explicit?.effectiveIntravascularFluidVolumeMl ?? 0,
  };
}

function hillSaturation(po2MmHg: number): number {
  const n = 2.7; const p50 = 26.8; const power = po2MmHg ** n;
  return 100 * power / (power + p50 ** n);
}

function po2FromSaturation(saturationPct: number): number {
  const fraction = bounded(saturationPct / 100, 0.01, 0.995);
  return 26.8 * (fraction / (1 - fraction)) ** (1 / 2.7);
}

function analyte(analyteId: string, value: number, unit: string, decimals: number): GeneratedAnalyte {
  if (!Number.isFinite(value)) throw new Error(`LAB_PHYSIOLOGY_NON_FINITE:${analyteId}`);
  return Object.freeze({ analyteId, value: rounded(value, decimals), unit, valueSource: "PHYSIOLOGY_V1" });
}

const STATIC_BASELINES: Readonly<Record<string, Readonly<{ value: number; decimals: number }>>> = Object.freeze({
  LAB_CRP: Object.freeze({ value: 2, decimals: 0 }),
  LAB_UREA: Object.freeze({ value: 5, decimals: 1 }),
  LAB_CREATININE: Object.freeze({ value: 72, decimals: 0 }),
  LAB_WBC: Object.freeze({ value: 7, decimals: 1 }),
  LAB_RBC: Object.freeze({ value: 4.8, decimals: 1 }),
  LAB_MCV: Object.freeze({ value: 90, decimals: 0 }),
  LAB_MCH: Object.freeze({ value: 30, decimals: 0 }),
  LAB_MCHC: Object.freeze({ value: 333, decimals: 0 }),
  LAB_RDW_CV: Object.freeze({ value: 13, decimals: 1 }),
  LAB_MPV: Object.freeze({ value: 10.5, decimals: 1 }),
  LAB_PDW: Object.freeze({ value: 12, decimals: 1 }),
  LAB_PCT: Object.freeze({ value: 0.25, decimals: 2 }),
  LAB_LCR: Object.freeze({ value: 30, decimals: 1 }),
  LAB_NEUT_ABS: Object.freeze({ value: 4.2, decimals: 1 }),
  LAB_NEUT_PCT: Object.freeze({ value: 60, decimals: 1 }),
  LAB_LYMPH_ABS: Object.freeze({ value: 2.1, decimals: 1 }),
  LAB_LYMPH_PCT: Object.freeze({ value: 30, decimals: 1 }),
  LAB_MONO_ABS: Object.freeze({ value: 0.49, decimals: 2 }),
  LAB_MONO_PCT: Object.freeze({ value: 7, decimals: 1 }),
  LAB_EO_ABS: Object.freeze({ value: 0.14, decimals: 2 }),
  LAB_EO_PCT: Object.freeze({ value: 2, decimals: 1 }),
  LAB_BASO_ABS: Object.freeze({ value: 0.04, decimals: 2 }),
  LAB_BASO_PCT: Object.freeze({ value: 0.5, decimals: 1 }),
  LAB_IG_ABS: Object.freeze({ value: 0.02, decimals: 2 }),
  LAB_IG_PCT: Object.freeze({ value: 0.3, decimals: 1 }),
  LAB_NRBC_ABS: Object.freeze({ value: 0, decimals: 2 }),
  LAB_NRBC_PCT: Object.freeze({ value: 0, decimals: 1 }),
  LAB_TROPONIN_T: Object.freeze({ value: 6, decimals: 0 }),
  LAB_CK: Object.freeze({ value: 120, decimals: 0 }),
  LAB_ALAT: Object.freeze({ value: 24, decimals: 0 }),
  LAB_ASAT: Object.freeze({ value: 25, decimals: 0 }),
  LAB_GGT: Object.freeze({ value: 25, decimals: 0 }),
  LAB_ALP: Object.freeze({ value: 75, decimals: 0 }),
  LAB_BILIRUBIN: Object.freeze({ value: 10, decimals: 0 }),
  LAB_LIPASE: Object.freeze({ value: 32, decimals: 0 }),
  LAB_ETHANOL: Object.freeze({ value: 0, decimals: 1 }),
  LAB_HCG: Object.freeze({ value: 2, decimals: 1 }),
});

function scenarioOverrides(snapshot: LabSamplePhysiologySnapshot): Readonly<Record<string, unknown>> {
  return record(snapshot.runtimeFields.laboratoryAnalyteOverrides) ?? Object.freeze({});
}

function staticAnalytes(input: Parameters<LaboratoryResultGenerator>[0]): Readonly<{
  analytes: readonly GeneratedAnalyte[];
  notApplicableAnalyteIds: readonly string[];
}> {
  const overrides = scenarioOverrides(input.sample.snapshot);
  const profile = record(input.sample.snapshot.runtimeFields.laboratoryPatientProfile);
  const hcgApplicable = profile?.hcgApplicable === true;
  const notApplicableAnalyteIds = input.resultGroupType === "CLINICAL_CHEMISTRY" && !hcgApplicable
    ? Object.freeze(["LAB_HCG"]) : Object.freeze([] as string[]);
  const generated: GeneratedAnalyte[] = [];
  for (const definition of NARVA_LAB_ANALYTES.filter(item => item.resultGroup === input.resultGroupType)) {
    if (definition.implementationClass === "STATIC_BASELINE" ||
      definition.implementationClass === "DEMOGRAPHIC_CONDITIONAL") {
      if (definition.id === "LAB_HCG" && !hcgApplicable) continue;
      const baseline = STATIC_BASELINES[definition.id];
      if (!baseline) continue;
      const override = overrides[definition.id];
      const overrideValue = typeof override === "number" && Number.isFinite(override) || typeof override === "string"
        ? override : undefined;
      generated.push(Object.freeze({ analyteId: definition.id,
        value: overrideValue ?? rounded(baseline.value, baseline.decimals), unit: definition.unit ?? "",
        ...(definition.sourceCode ? { sourceCode: definition.sourceCode } : {}),
        ...(definition.referenceRange ? { referenceRange: definition.referenceRange } : {}),
        valueSource: overrideValue === undefined ? "STATIC_BASELINE" : "SCENARIO_OVERRIDE" }));
    }
  }
  if (input.resultGroupType === "AB0") {
    const identity = input.sample.snapshot.patientBloodIdentity ??
      deriveNarvaLabPatientBloodIdentity(input.sample.patientId);
    const values: Readonly<Record<string, string>> = Object.freeze({ LAB_AB0: identity.ab0,
      LAB_RHD: identity.rhd });
    for (const definition of NARVA_LAB_ANALYTES.filter(item => item.resultGroup === "AB0" &&
      item.id !== "LAB_ANTIBODY_SCREEN")) {
      generated.push(Object.freeze({ analyteId: definition.id, value: values[definition.id],
        unit: definition.unit ?? "", ...(definition.sourceCode ? { sourceCode: definition.sourceCode } : {}),
        valueSource: "BLOOD_BANK_IDENTITY" }));
    }
    const antibodyScreen = input.sample.snapshot.authoredResults?.antibodyScreen;
    const antibodyDefinition = NARVA_LAB_ANALYTES.find(item => item.id === "LAB_ANTIBODY_SCREEN");
    if (antibodyScreen && antibodyDefinition) generated.push(Object.freeze({
      analyteId: antibodyDefinition.id, value: antibodyScreen, unit: antibodyDefinition.unit ?? "",
      ...(antibodyDefinition.sourceCode ? { sourceCode: antibodyDefinition.sourceCode } : {}),
      valueSource: "AUTHORED_SAMPLE_RESULT",
    }));
  }
  return Object.freeze({ analytes: Object.freeze(generated), notApplicableAnalyteIds });
}

function withSourceMetadata(value: GeneratedAnalyte): GeneratedAnalyte {
  const definition = NARVA_LAB_ANALYTES.find(item => item.id === value.analyteId);
  if (!definition) return value;
  return Object.freeze({ ...value, unit: definition.unit ?? value.unit,
    ...(definition.sourceCode ? { sourceCode: definition.sourceCode } : {}),
    ...(definition.referenceRange ? { referenceRange: definition.referenceRange } : {}) });
}

/**
 * Pragmatic deterministic adult-trauma model. It maps frozen authoritative Runtime state into a coherent
 * lab expression; it is not a second time-stepped patient simulator and has no release-time inputs.
 */
export function generateNarvaLabPhysiology(input: Parameters<LaboratoryResultGenerator>[0]) {
  const snapshot = input.sample.snapshot;
  const respiratory = physiology(snapshot);
  const hemorrhage = hemorrhageInputs(snapshot);
  const products = productTotals(snapshot);
  const referenceBloodVolumeMl = 4_900;
  const remainingBloodFraction = bounded(1 - hemorrhage.bloodLossMl / referenceBloodVolumeMl, 0.12, 1);
  const lossFraction = bounded(hemorrhage.bloodLossMl / 3_500, 0, 1.4);
  const dilutionFraction = bounded(respiratory.effectiveFluidMl / referenceBloodVolumeMl, 0, 1.5);
  const perfusionDeficit = bounded((70 - respiratory.map) / 40, 0, 1.5);
  const shockBurden = bounded(perfusionDeficit * 0.7 + lossFraction * 0.3 +
    (hemorrhage.activeBleeding ? 0.08 : 0), 0, 1.5);

  const baselineVentilation = bounded(respiratory.baselineMinuteVentilationLMin, 1, 20);
  const effectiveVentilation = bounded(respiratory.effectiveMinuteVentilationLMin, 0.4, 30);
  const pco2 = bounded(40 * baselineVentilation / effectiveVentilation, 18, 110);
  const lactate = bounded(1.1 + 4.2 * shockBurden + 0.65 * lossFraction, 0.5, 15);
  const bicarbonate = bounded(24 - 1.25 * Math.max(0, lactate - 1.1) - 1.5 * dilutionFraction, 8, 32);
  const ph = bounded(6.1 + Math.log10(bicarbonate / (0.03 * pco2)), 6.75, 7.7);
  const baseExcess = bounded(0.9287 * (bicarbonate - 24.4 + 14.83 * (ph - 7.4)), -30, 20);
  const alveolarPo2 = Math.max(0, (respiratory.oxygenSupplyAdequate ? respiratory.fio2 : 0.21) * 713 - pco2 / 0.8);
  const po2 = bounded(Math.min(alveolarPo2 * 0.88, po2FromSaturation(respiratory.spo2)), 0, 500);
  const so2 = bounded(hillSaturation(po2), 0, 100);

  const calciumEffect = products.calciumAdministrations.reduce((sum, item) => {
    const ageSec = Math.max(0, input.sample.sampledAtSimulationTimeSec - item.completedAtSec);
    return sum + 0.14 * Math.exp(-ageSec / 3_600);
  }, 0);
  const citrateBurden = 0.045 * products.rbcUnits + 0.025 * products.plasmaUnits +
    0.02 * products.plateletUnits;
  const ionizedCalcium = bounded(1.24 - citrateBurden - 0.045 * dilutionFraction + calciumEffect, 0.45, 1.8);

  const redCellMassG = 140 * 4.9 * remainingBloodFraction + 50 * products.rbcUnits;
  const circulatingVolumeL = Math.max(1.2, (referenceBloodVolumeMl * remainingBloodFraction +
    respiratory.effectiveFluidMl + products.totalVolumeMl) / 1_000);
  const hemoglobin = bounded(redCellMassG / circulatingVolumeL, 20, 220);
  const hematocrit = bounded(hemoglobin * 0.3, 6, 66);
  const platelets = bounded(250 * referenceBloodVolumeMl / 1_000 * remainingBloodFraction /
    circulatingVolumeL + 35 * products.plateletUnits, 5, 600);

  const coldBurden = bounded((36 - respiratory.temperature) / 3, 0, 1.5);
  const coagulopathy = bounded(0.48 * lossFraction + 0.34 * dilutionFraction + 0.28 * shockBurden +
    0.25 * coldBurden + 0.25 * (hemorrhage.coagulationFactor - 1) +
    0.18 * (hemorrhage.fibrinolysisFactor - 1) - 0.12 * products.plasmaUnits -
    0.06 * products.plateletUnits, 0, 2.5);
  const inr = bounded(1 + 0.55 * coagulopathy, 0.8, 3.5);
  const aptt = bounded(34 + 20 * coagulopathy, 20, 120);
  const fibrinogen = bounded(3 - 1.25 * coagulopathy + 0.18 * hemorrhage.fibrinogenDoseG, 0.2, 8);
  const sodium = bounded(140 - 1.2 * dilutionFraction, 125, 150);
  const potassium = bounded(4.1 + 0.16 * Math.max(0, lactate - 4), 3, 6.5);
  const glucose = bounded(5.3 + 1.8 * shockBurden, 2.5, 15);

  const dynamicByGroup: Readonly<Record<LabResultGroupType, readonly GeneratedAnalyte[]>> = {
    ASTRUP: Object.freeze([
      analyte("LAB_PH", ph, "", 2), analyte("LAB_PCO2", pco2, "mmHg", 1),
      analyte("LAB_PO2", po2, "mmHg", 1), analyte("LAB_HCO3", bicarbonate, "mmol/L", 1),
      analyte("LAB_BE", baseExcess, "mmol/L", 1), analyte("LAB_LACTATE", lactate, "mmol/L", 1),
      analyte("LAB_SO2", so2, "%", 1), analyte("LAB_ICA", ionizedCalcium, "mmol/L", 2),
      analyte("LAB_ASTRUP_GLUCOSE", glucose, "mmol/L", 1),
    ]),
    HEMATOLOGY: Object.freeze([
      analyte("LAB_HB", hemoglobin, "g/L", 0), analyte("LAB_HCT", hematocrit, "%", 1),
      analyte("LAB_PLATELETS", platelets, "E9/L", 0),
    ]),
    COAGULATION: Object.freeze([
      analyte("LAB_INR", inr, "", 2), analyte("LAB_APTT", aptt, "s", 1),
      analyte("LAB_FIBRINOGEN", fibrinogen, "g/L", 1),
    ]),
    CLINICAL_CHEMISTRY: Object.freeze([
      analyte("LAB_NA", sodium, "mmol/L", 0), analyte("LAB_K", potassium, "mmol/L", 1),
      analyte("LAB_GLUCOSE", glucose, "mmol/L", 1),
    ]),
    AB0: Object.freeze([]),
  };
  const dynamicGenerated = dynamicByGroup[input.resultGroupType];
  const staticGenerated = input.order.packageId === "NARVA_POLYTRAUMA"
    ? staticAnalytes(input) : Object.freeze({ analytes: Object.freeze([] as GeneratedAnalyte[]),
      notApplicableAnalyteIds: Object.freeze([] as string[]) });
  const generatedById = new Map([...dynamicGenerated, ...staticGenerated.analytes]
    .map(item => [item.analyteId, withSourceMetadata(item)]));
  const groupCatalog = NARVA_LAB_ANALYTES.filter(item => item.resultGroup === input.resultGroupType &&
    item.reportable !== false);
  const generated = groupCatalog.flatMap(item => generatedById.get(item.id) ?? []);
  if (!generated.length && !groupCatalog.some(item => item.implementationClass === "SOURCE_AMBIGUOUS")) return undefined;
  const notApplicable = new Set(staticGenerated.notApplicableAnalyteIds);
  const pendingAnalyteIds = groupCatalog.filter(item => !generatedById.has(item.id) && !notApplicable.has(item.id))
    .map(item => item.id);
  const hasDynamic = generated.some(item => item.valueSource === "PHYSIOLOGY_V1");
  const hasStatic = generated.some(item => item.valueSource !== "PHYSIOLOGY_V1");
  const generationVersion = hasDynamic && hasStatic
    ? `${NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION}+${NARVA_LAB_STATIC_GENERATOR_VERSION}`
    : hasStatic ? NARVA_LAB_STATIC_GENERATOR_VERSION : NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION;
  return Object.freeze({
    generationVersion,
    status: pendingAnalyteIds.length ? "PARTIALLY_RESULTED" as const : "RESULTED" as const,
    payload: Object.freeze({ schemaVersion: 1, sampledAtSimulationTimeSec: input.sample.sampledAtSimulationTimeSec,
      analytes: Object.freeze(generated), pendingAnalyteIds: Object.freeze(pendingAnalyteIds),
      notApplicableAnalyteIds: staticGenerated.notApplicableAnalyteIds,
      generatorVersions: Object.freeze([...(hasDynamic ? [NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION] : []),
        ...(hasStatic ? [NARVA_LAB_STATIC_GENERATOR_VERSION] : [])]) }),
  });
}

export const narvaLabPhysiologyV1Generator: LaboratoryResultGenerator = generateNarvaLabPhysiology;
