import { NARVA_LAB_ANALYTES } from "@/config/NarvaLaboratoryCatalog";
import type { LabResultGroupType, LabSamplePhysiologySnapshot, LaboratoryResultGenerator } from
  "@/models/LaboratoryWorkflow";

export const NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION = "narva-lab-physiology-v1" as const;

type GeneratedAnalyte = Readonly<{
  analyteId: string;
  value: number;
  unit: string;
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
  return Object.freeze({ analyteId, value: rounded(value, decimals), unit });
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

  const byGroup: Readonly<Record<LabResultGroupType, readonly GeneratedAnalyte[]>> = {
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
  const generated = byGroup[input.resultGroupType];
  if (!generated.length) return undefined;
  const generatedIds = new Set(generated.map(item => item.analyteId));
  const pendingAnalyteIds = NARVA_LAB_ANALYTES.filter(item => item.resultGroup === input.resultGroupType &&
    !generatedIds.has(item.id)).map(item => item.id);
  return Object.freeze({
    generationVersion: NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION,
    status: pendingAnalyteIds.length ? "PARTIALLY_RESULTED" as const : "RESULTED" as const,
    payload: Object.freeze({ schemaVersion: 1, sampledAtSimulationTimeSec: input.sample.sampledAtSimulationTimeSec,
      analytes: generated, pendingAnalyteIds: Object.freeze(pendingAnalyteIds) }),
  });
}

export const narvaLabPhysiologyV1Generator: LaboratoryResultGenerator = generateNarvaLabPhysiology;
