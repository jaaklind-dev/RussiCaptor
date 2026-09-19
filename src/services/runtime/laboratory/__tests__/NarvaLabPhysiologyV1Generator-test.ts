import type { LabResultGroupType, LabSamplePhysiologySnapshot, LaboratoryOrder,
  LaboratorySample } from "@/models/LaboratoryWorkflow";
import { getMtpCalciumRecommendationThreshold } from "@/models/MassiveTransfusion";
import { generateNarvaLabPhysiology, NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION } from
  "../NarvaLabPhysiologyV1Generator";
import { stableJson } from "@/utils/stableJson";
import { LaboratoryWorkflowRuntime } from "../LaboratoryWorkflowRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import type { NarvaIroVentilationFault } from "@/models/NarvaIroScenario";

type Overrides = Readonly<{
  time?: number;
  ventilation?: number;
  fio2?: number;
  oxygenAdequate?: boolean;
  spo2?: number;
  map?: number;
  temperature?: number;
  fluidMl?: number;
  lossMl?: number;
  activeBleeding?: boolean;
  coagulationFactor?: number;
  fibrinogenDoseG?: number;
  fibrinolysisFactor?: number;
  rbcUnits?: number;
  plasmaUnits?: number;
  plateletUnits?: number;
  calciumAt?: readonly number[];
}>;

const order: LaboratoryOrder = Object.freeze({ orderId: "O", exerciseId: "EX", patientId: "PT",
  packageId: "NARVA_POLYTRAUMA", orderedAtSimulationTimeSec: 0, orderedBy: "CM", status: "COLLECTED" });

function sample(o: Overrides = {}): LaboratorySample {
  const time = o.time ?? 1_000;
  const blood = [
    { product: "RBC", deliveredUnits: o.rbcUnits ?? 0, deliveredVolumeMl: (o.rbcUnits ?? 0) * 300 },
    { product: "PLASMA", deliveredUnits: o.plasmaUnits ?? 0, deliveredVolumeMl: (o.plasmaUnits ?? 0) * 250 },
    { product: "PLATELETS", deliveredUnits: o.plateletUnits ?? 0, deliveredVolumeMl: (o.plateletUnits ?? 0) * 300 },
  ];
  const snapshot: LabSamplePhysiologySnapshot = Object.freeze({ schemaVersion: 1,
    displayedVitals: { systolicBp: o.map ?? 90, diastolicBp: o.map ?? 90, spo2: o.spo2 ?? 97,
      respiratoryRate: 14, temperature: o.temperature ?? 37 },
    targetVitals: {}, runtimeFields: {},
    authoritativePhysiology: { baselineMinuteVentilationLMin: 6,
      effectiveMinuteVentilationLMin: o.ventilation ?? 6, fio2: o.fio2 ?? 0.21,
      oxygenSupplyAdequate: o.oxygenAdequate ?? true, arterialOxygenSaturationPct: o.spo2 ?? 97,
      meanArterialPressureMmHg: o.map ?? 90, temperatureCelsius: o.temperature ?? 37,
      effectiveIntravascularFluidVolumeMl: o.fluidMl ?? 0 },
    clinicalProcessInputs: [{ processId: "H", processType: "HEMORRHAGE", runtimeContributions: {},
      clinicalState: { cumulativeLossMl: o.lossMl ?? 0, activeHemorrhage: o.activeBleeding ?? false,
        coagulationFactor: o.coagulationFactor ?? 1, fibrinogenDoseG: o.fibrinogenDoseG ?? 0,
        effectiveFibrinolysisFactor: o.fibrinolysisFactor ?? 1 } },
    { processId: "M", processType: "MASSIVE_TRANSFUSION", runtimeContributions: {},
      clinicalState: { administrations: blood, transfusionCalcium: { calciumRecommended: true,
        calciumAdministrations: (o.calciumAt ?? []).map((completedAtSec, index) => ({
          administrationId: `CA-${index}`, completedAtSec })) } } }],
  });
  return Object.freeze({ sampleId: "S", orderId: "O", exerciseId: "EX", patientId: "PT",
    sampledAtSimulationTimeSec: time, sourcePatientRevision: 1, sourceRuntimeStateVersion: 1, snapshot });
}

function result(group: LabResultGroupType, overrides: Overrides = {}) {
  const value = generateNarvaLabPhysiology({ order, sample: sample(overrides), resultGroupType: group });
  if (!value) throw new Error(`No generated ${group} result`);
  return value;
}

function value(group: LabResultGroupType, id: string, overrides: Overrides = {}): number {
  const payload = result(group, overrides).payload;
  const analytes = payload.analytes as readonly Readonly<{ analyteId: string; value: number }>[];
  const found = analytes.find(item => item.analyteId === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found.value;
}

describe("Narva laboratory physiology v1", () => {
  test("keeps pH, pCO2, HCO3 and BE coherent and bounded", () => {
    const pco2 = value("ASTRUP", "LAB_PCO2");
    const hco3 = value("ASTRUP", "LAB_HCO3");
    const ph = value("ASTRUP", "LAB_PH");
    const be = value("ASTRUP", "LAB_BE");
    expect(ph).toBeCloseTo(6.1 + Math.log10(hco3 / (0.03 * pco2)), 1);
    expect(be).toBeCloseTo(0.9287 * (hco3 - 24.4 + 14.83 * (ph - 7.4)), 0);
    expect(ph).toBeGreaterThan(6.75); expect(pco2).toBeGreaterThan(0);
  });

  test("maps effective ventilation faults and oxygen supply with distinct directionality", () => {
    const normal = { ventilation: 6, fio2: 0.4, spo2: 97 };
    const disconnect = { ventilation: 0.72, fio2: 0.4, spo2: 80 };
    const kink = { ventilation: 2.7, fio2: 0.4, spo2: 88 };
    const depleted = { ventilation: 6, fio2: 0.21, oxygenAdequate: false, spo2: 82 };
    expect(value("ASTRUP", "LAB_PCO2", disconnect)).toBeGreaterThan(value("ASTRUP", "LAB_PCO2", kink));
    expect(value("ASTRUP", "LAB_PCO2", kink)).toBeGreaterThan(value("ASTRUP", "LAB_PCO2", normal));
    expect(value("ASTRUP", "LAB_PH", disconnect)).toBeLessThan(value("ASTRUP", "LAB_PH", normal));
    expect(value("ASTRUP", "LAB_PO2", disconnect)).toBeLessThan(value("ASTRUP", "LAB_PO2", normal));
    expect(value("ASTRUP", "LAB_SO2", disconnect)).toBeLessThan(value("ASTRUP", "LAB_SO2", normal));
    expect(value("ASTRUP", "LAB_PO2", depleted)).toBeLessThan(value("ASTRUP", "LAB_PO2", normal));
    expect(value("ASTRUP", "LAB_PCO2", depleted)).toBe(value("ASTRUP", "LAB_PCO2", normal));
    const corrected = { ventilation: 5.4, fio2: 0.4, spo2: 95 };
    expect(value("ASTRUP", "LAB_PCO2", corrected)).toBeLessThan(value("ASTRUP", "LAB_PCO2", kink));
  });

  test("captures real IRO ventilation projections as authoritative physiology rather than fault labels", () => {
    const run = (fault?: NarvaIroVentilationFault) => {
      const fixture = packagePatientDatasetRegistry.resolve("patients.narva-iro-evacuation.v2")
        .patients[0].runtimeFixture!;
      const engine = new ClinicalScenarioEngine(undefined, () => true);
      engine.reset(structuredClone(fixture));
      if (fault) engine.triggerNarvaIroVentilationFault(fault, 0);
      engine.advanceTo(60);
      engine.orderLaboratory({ orderId: "IRO-O", exerciseId: "EX-IRO", patientId: "PT-IRO-001",
        exercisePackageId: "russicaptor.narva-iro-evacuation", labPackageId: "NARVA_IRO_ASTRUP",
        orderedBy: "CM", orderedAtSimulationTimeSec: 60 });
      engine.collectLaboratorySample({ sampleId: "IRO-S", orderId: "IRO-O",
        sampledAtSimulationTimeSec: 60, sourcePatientRevision: 1 });
      const captured = engine.getLaboratoryWorkflow().samples[0].snapshot.authoritativePhysiology!;
      engine.advanceTo(1_560);
      const payload = engine.getLaboratoryWorkflow().resultGroups[0].resultPayload!;
      const values = payload.analytes as readonly Readonly<{ analyteId: string; value: number }>[];
      return { captured, values, get: (id: string) => values.find(item => item.analyteId === id)!.value };
    };
    const normal = run(); const disconnect = run("CIRCUIT_DISCONNECT");
    const kink = run("HIGH_PRESSURE_KINK"); const depleted = run("OXYGEN_DEPLETION");
    expect(disconnect.captured.effectiveMinuteVentilationLMin).toBeLessThan(
      kink.captured.effectiveMinuteVentilationLMin);
    expect(kink.captured.effectiveMinuteVentilationLMin).toBeLessThan(normal.captured.effectiveMinuteVentilationLMin);
    expect(depleted.captured.effectiveMinuteVentilationLMin).toBe(normal.captured.effectiveMinuteVentilationLMin);
    expect(depleted.captured.oxygenSupplyAdequate).toBe(false);
    expect(disconnect.get("LAB_PCO2")).toBeGreaterThan(kink.get("LAB_PCO2"));
    expect(kink.get("LAB_PCO2")).toBeGreaterThan(normal.get("LAB_PCO2"));
    expect(depleted.get("LAB_PCO2")).toBe(normal.get("LAB_PCO2"));
    expect(depleted.get("LAB_PO2")).toBeLessThan(normal.get("LAB_PO2"));
  });

  test("expresses hemorrhagic shock, dilution, red-cell and coagulation support directionally", () => {
    const baseline = {};
    const moderate = { lossMl: 1_200, map: 65, activeBleeding: true };
    const severe = { lossMl: 2_800, map: 42, activeBleeding: true, fluidMl: 1_500,
      coagulationFactor: 1.4, fibrinolysisFactor: 1.5 };
    const resuscitated = { ...severe, map: 75, activeBleeding: false, rbcUnits: 4,
      plasmaUnits: 4, plateletUnits: 1, fibrinogenDoseG: 4 };
    for (const id of ["LAB_LACTATE"] as const) {
      expect(value("ASTRUP", id, moderate)).toBeGreaterThan(value("ASTRUP", id, baseline));
      expect(value("ASTRUP", id, severe)).toBeGreaterThan(value("ASTRUP", id, moderate));
      expect(value("ASTRUP", id, resuscitated)).toBeLessThan(value("ASTRUP", id, severe));
    }
    expect(value("ASTRUP", "LAB_HCO3", severe)).toBeLessThan(value("ASTRUP", "LAB_HCO3", baseline));
    expect(value("ASTRUP", "LAB_BE", severe)).toBeLessThan(value("ASTRUP", "LAB_BE", baseline));
    expect(value("HEMATOLOGY", "LAB_HB", { lossMl: 1_500 })).toBeGreaterThan(
      value("HEMATOLOGY", "LAB_HB", { lossMl: 1_500, fluidMl: 1_500 }));
    expect(value("HEMATOLOGY", "LAB_HB", { lossMl: 1_500, fluidMl: 1_500, rbcUnits: 3 })).toBeGreaterThan(
      value("HEMATOLOGY", "LAB_HB", { lossMl: 1_500, fluidMl: 1_500 }));
    expect(value("HEMATOLOGY", "LAB_HCT", severe)).toBeCloseTo(value("HEMATOLOGY", "LAB_HB", severe) * 0.3, 0);
    expect(value("HEMATOLOGY", "LAB_PLATELETS", severe)).toBeLessThan(value("HEMATOLOGY", "LAB_PLATELETS", baseline));
    expect(value("HEMATOLOGY", "LAB_PLATELETS", resuscitated)).toBeGreaterThan(
      value("HEMATOLOGY", "LAB_PLATELETS", { ...resuscitated, plateletUnits: 0 }));
    expect(value("COAGULATION", "LAB_INR", severe)).toBeGreaterThan(value("COAGULATION", "LAB_INR", baseline));
    expect(value("COAGULATION", "LAB_APTT", severe)).toBeGreaterThan(value("COAGULATION", "LAB_APTT", baseline));
    expect(value("COAGULATION", "LAB_FIBRINOGEN", severe)).toBeLessThan(value("COAGULATION", "LAB_FIBRINOGEN", baseline));
    expect(value("COAGULATION", "LAB_FIBRINOGEN", resuscitated)).toBeGreaterThan(value("COAGULATION", "LAB_FIBRINOGEN", severe));
  });

  test("keeps MTP protocol cadence distinct from snapshot iCa physiology", () => {
    const baseline = value("ASTRUP", "LAB_ICA");
    const escalating = value("ASTRUP", "LAB_ICA", { rbcUnits: 4, plasmaUnits: 4 });
    const afterCalcium = value("ASTRUP", "LAB_ICA", { rbcUnits: 4, plasmaUnits: 4, calciumAt: [900] });
    expect(escalating).toBeLessThan(baseline);
    expect(afterCalcium).toBeGreaterThan(escalating);
    expect(getMtpCalciumRecommendationThreshold({ rbcUnitsPerCalcium: 3, calciumAdministrationCount: 0 })).toBe(4);
    expect(getMtpCalciumRecommendationThreshold({ rbcUnitsPerCalcium: 3, calciumAdministrationCount: 1 })).toBe(3);
    expect(generateNarvaLabPhysiology.toString()).not.toContain("calciumRecommended");
  });

  test("keeps sodium/potassium conservative and glucose stress-linked", () => {
    const shock = { lossMl: 2_500, map: 45, activeBleeding: true };
    expect(Math.abs(value("CLINICAL_CHEMISTRY", "LAB_NA", shock) -
      value("CLINICAL_CHEMISTRY", "LAB_NA"))).toBeLessThanOrEqual(2);
    expect(value("CLINICAL_CHEMISTRY", "LAB_K", shock)).toBeGreaterThanOrEqual(
      value("CLINICAL_CHEMISTRY", "LAB_K"));
    expect(value("CLINICAL_CHEMISTRY", "LAB_GLUCOSE", shock)).toBeGreaterThan(
      value("CLINICAL_CHEMISTRY", "LAB_GLUCOSE"));
  });

  test("is sample-time deterministic, immutable, versioned and explicit about static pending analytes", () => {
    const before = sample({ lossMl: 2_500, map: 45, rbcUnits: 4, plasmaUnits: 4 });
    const first = generateNarvaLabPhysiology({ order, sample: before, resultGroupType: "ASTRUP" });
    const replay = generateNarvaLabPhysiology({ order, sample: structuredClone(before), resultGroupType: "ASTRUP" });
    const after = generateNarvaLabPhysiology({ order, sample: sample({ lossMl: 2_500, map: 75,
      rbcUnits: 4, plasmaUnits: 4, calciumAt: [1_100], time: 1_200 }), resultGroupType: "ASTRUP" });
    expect(stableJson(replay)).toBe(stableJson(first));
    expect(first?.generationVersion).toBe(NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION);
    expect(first?.status).toBe("PARTIALLY_RESULTED");
    expect(first?.payload.pendingAnalyteIds).toEqual(["LAB_ASTRUP_HB_FR"]);
    expect((after?.payload.analytes as readonly { analyteId: string; value: number }[])
      .find(item => item.analyteId === "LAB_ICA")!.value).toBeGreaterThan(
      (first?.payload.analytes as readonly { analyteId: string; value: number }[])
        .find(item => item.analyteId === "LAB_ICA")!.value);
    expect(generateNarvaLabPhysiology({ order, sample: before, resultGroupType: "AB0" }))
      .toMatchObject({ status: "RESULTED", generationVersion: "narva-lab-static-v1" });
  });

  test("releases pre- and post-treatment samples from their own immutable collection snapshots", () => {
    const runtime = new LaboratoryWorkflowRuntime(generateNarvaLabPhysiology);
    const frozenBefore = structuredClone(sample({ lossMl: 2_500, map: 45, rbcUnits: 4, plasmaUnits: 4 }).snapshot);
    const { schemaVersion: _beforeSchema, ...beforeSnapshot } = frozenBefore;
    runtime.order({ orderId: "O-BEFORE", exerciseId: "EX", patientId: "PT", packageId: "NARVA_POLYTRAUMA",
      orderedAtSimulationTimeSec: 0, orderedBy: "CM" });
    runtime.collect({ sampleId: "S-BEFORE", orderId: "O-BEFORE", sampledAtSimulationTimeSec: 1_000,
      sourcePatientRevision: 1, sourceRuntimeStateVersion: 1,
      snapshot: beforeSnapshot });
    const treated = structuredClone(sample({ time: 1_200, lossMl: 2_500, map: 75,
      rbcUnits: 4, plasmaUnits: 4, calciumAt: [1_100] }).snapshot);
    const { schemaVersion: _afterSchema, ...afterSnapshot } = treated;
    runtime.order({ orderId: "O-AFTER", exerciseId: "EX", patientId: "PT", packageId: "NARVA_POLYTRAUMA",
      orderedAtSimulationTimeSec: 1_100, orderedBy: "CM" });
    runtime.collect({ sampleId: "S-AFTER", orderId: "O-AFTER", sampledAtSimulationTimeSec: 1_200,
      sourcePatientRevision: 2, sourceRuntimeStateVersion: 2,
      snapshot: afterSnapshot });
    runtime.advanceTo(4_000);
    const groups = runtime.snapshot().resultGroups.filter(item => item.type === "ASTRUP");
    const ica = (index: number) => (groups[index].resultPayload?.analytes as readonly Readonly<{
      analyteId: string; value: number;
    }> [])
      .find(item => item.analyteId === "LAB_ICA")!.value;
    expect(ica(0)).toBeLessThan(ica(1));
    expect(groups[0].resultPayload?.sampledAtSimulationTimeSec).toBe(1_000);
    expect(groups[1].resultPayload?.sampledAtSimulationTimeSec).toBe(1_200);
    expect(runtime.advanceTo(4_000)).toEqual([]);
  });
});
