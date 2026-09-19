import { NARVA_LAB_ANALYTES, NARVA_LAB_PACKAGE_ANALYTE_IDS } from
  "@/config/NarvaLaboratoryCatalog";
import type { LabResultGroupType, LabSamplePhysiologySnapshot, LaboratoryOrder,
  LaboratorySample } from "@/models/LaboratoryWorkflow";
import { stableJson } from "@/utils/stableJson";
import { LaboratoryWorkflowRuntime } from "../LaboratoryWorkflowRuntime";
import { deriveNarvaLabPatientBloodIdentity } from "../NarvaLabPatientIdentity";
import { generateNarvaLabPhysiology, NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION,
  NARVA_LAB_STATIC_GENERATOR_VERSION } from "../NarvaLabPhysiologyV1Generator";

const groups: readonly LabResultGroupType[] = ["ASTRUP", "HEMATOLOGY", "AB0",
  "CLINICAL_CHEMISTRY", "COAGULATION"];
const order: LaboratoryOrder = Object.freeze({ orderId: "O", exerciseId: "EX", patientId: "PT-TRAUMA",
  packageId: "NARVA_POLYTRAUMA", orderedAtSimulationTimeSec: 0, orderedBy: "CM", status: "COLLECTED" });

function sample(input: Readonly<{ id?: string; patientId?: string; time?: number;
  overrides?: Readonly<Record<string, number | string>>; hcgApplicable?: boolean }> = {}): LaboratorySample {
  const patientId = input.patientId ?? order.patientId;
  const runtimeFields = Object.freeze({
    ...(input.overrides ? { laboratoryAnalyteOverrides: input.overrides } : {}),
    ...(input.hcgApplicable === undefined ? {} : {
      laboratoryPatientProfile: Object.freeze({ hcgApplicable: input.hcgApplicable }) }),
  });
  const snapshot: LabSamplePhysiologySnapshot = Object.freeze({ schemaVersion: 1,
    displayedVitals: Object.freeze({ sbp: 110, dbp: 70, rr: 14, spo2: 97, temperature: 37 }),
    targetVitals: Object.freeze({}), runtimeFields, clinicalProcessInputs: Object.freeze([]),
    authoritativePhysiology: Object.freeze({ baselineMinuteVentilationLMin: 6,
      effectiveMinuteVentilationLMin: 6, fio2: 0.21, oxygenSupplyAdequate: true,
      arterialOxygenSaturationPct: 97, meanArterialPressureMmHg: 83,
      temperatureCelsius: 37, effectiveIntravascularFluidVolumeMl: 0 }),
    patientBloodIdentity: deriveNarvaLabPatientBloodIdentity(patientId),
  });
  return Object.freeze({ sampleId: input.id ?? "S", orderId: order.orderId, exerciseId: order.exerciseId,
    patientId, sampledAtSimulationTimeSec: input.time ?? 100, sourcePatientRevision: 1,
    sourceRuntimeStateVersion: 1, snapshot });
}

function generate(group: LabResultGroupType, sampled = sample(), sourceOrder = order) {
  const value = generateNarvaLabPhysiology({ order: sourceOrder, sample: sampled, resultGroupType: group });
  if (!value) throw new Error(`Missing ${group}`);
  return value;
}

function analytes(group: LabResultGroupType, sampled = sample()) {
  return generate(group, sampled).payload.analytes as readonly Readonly<{
    analyteId: string; value: number | string; unit: string; sourceCode?: string;
    referenceRange?: string; valueSource: string;
  }>[];
}

function analyte(group: LabResultGroupType, id: string, sampled = sample()) {
  const found = analytes(group, sampled).find(item => item.analyteId === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}

function runtime() {
  const value = new LaboratoryWorkflowRuntime(generateNarvaLabPhysiology);
  value.order({ ...order, status: undefined } as unknown as Omit<LaboratoryOrder, "status">);
  const { schemaVersion: _schemaVersion, patientBloodIdentity: _patientBloodIdentity, ...snapshot } = sample().snapshot;
  value.collect({ sampleId: "S", orderId: "O", sampledAtSimulationTimeSec: 100,
    sourcePatientRevision: 1, sourceRuntimeStateVersion: 1, snapshot });
  return value;
}

describe("Narva laboratory static/scenario v1", () => {
  test("B31-A1/A2/A21/A22 freezes complete POLÜTRAUMA membership, exclusions and unchanged IRO scope", () => {
    const actual = new Set(groups.flatMap(group => analytes(group).map(item => item.analyteId)));
    const expected = NARVA_LAB_ANALYTES.filter(item => item.reportable !== false &&
      item.implementationClass !== "SOURCE_AMBIGUOUS" && item.id !== "LAB_HCG").map(item => item.id);
    expect([...actual].sort()).toEqual([...expected].sort());
    expect(NARVA_LAB_PACKAGE_ANALYTE_IDS.NARVA_POLYTRAUMA).toEqual(NARVA_LAB_ANALYTES.map(item => item.id));
    expect(JSON.stringify(NARVA_LAB_ANALYTES)).not.toMatch(/SARS-CoV-2|influenza|U-Narco|urine analysis/i);
    expect(NARVA_LAB_PACKAGE_ANALYTE_IDS.NARVA_IRO_ASTRUP).toEqual(
      NARVA_LAB_ANALYTES.filter(item => item.resultGroup === "ASTRUP").map(item => item.id));
    expect(generate("ASTRUP").generationVersion).toBe(NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION);
    expect(generate("ASTRUP").payload.pendingAnalyteIds).toEqual(["LAB_ASTRUP_HB_FR"]);
  });

  test("B31-A3/A4/A5/A13 makes static values deterministic, baseline-stable and explicitly overridable", () => {
    const first = generate("CLINICAL_CHEMISTRY", sample({ id: "S-1", time: 100 }));
    const replay = generate("CLINICAL_CHEMISTRY", structuredClone(sample({ id: "S-1", time: 100 })));
    expect(stableJson(first)).toBe(stableJson(replay));
    expect(analyte("CLINICAL_CHEMISTRY", "LAB_CRP", sample({ id: "S-2", time: 500 })).value)
      .toBe(analyte("CLINICAL_CHEMISTRY", "LAB_CRP").value);
    expect(analyte("CLINICAL_CHEMISTRY", "LAB_CRP", sample({ overrides: { LAB_CRP: 48 } })))
      .toMatchObject({ value: 48, valueSource: "SCENARIO_OVERRIDE" });
    expect(analyte("CLINICAL_CHEMISTRY", "LAB_ETHANOL"))
      .toMatchObject({ value: 0, unit: "g/L", valueSource: "STATIC_BASELINE" });
  });

  test("B31-A6 reports every IVKH-derived CBC component without replacing dynamic Hb/Hct/platelets", () => {
    const expected = ["LAB_WBC", "LAB_RBC", "LAB_HB", "LAB_HCT", "LAB_MCV", "LAB_MCH", "LAB_MCHC",
      "LAB_RDW_CV", "LAB_PLATELETS", "LAB_MPV", "LAB_PDW", "LAB_PCT", "LAB_LCR", "LAB_NEUT_ABS",
      "LAB_NEUT_PCT", "LAB_LYMPH_ABS", "LAB_LYMPH_PCT", "LAB_MONO_ABS", "LAB_MONO_PCT",
      "LAB_EO_ABS", "LAB_EO_PCT", "LAB_BASO_ABS", "LAB_BASO_PCT", "LAB_IG_ABS", "LAB_IG_PCT",
      "LAB_NRBC_ABS", "LAB_NRBC_PCT"];
    const values = analytes("HEMATOLOGY");
    expect(values.map(item => item.analyteId)).toEqual(expected);
    for (const id of ["LAB_HB", "LAB_HCT", "LAB_PLATELETS"]) {
      expect(values.find(item => item.analyteId === id)?.valueSource).toBe("PHYSIOLOGY_V1");
    }
    expect(values.find(item => item.analyteId === "LAB_WBC"))
      .toMatchObject({ unit: "E9/L", referenceRange: "adult 4.1–9.7" });
  });

  test("B31-A7/A8/A9/A10/A11 keeps blood-bank identity stable by patient, sample, restart and takeover", () => {
    expect(deriveNarvaLabPatientBloodIdentity("PT-A")).toEqual(deriveNarvaLabPatientBloodIdentity("PT-A"));
    const first = sample({ id: "S-A", patientId: "PT-A" });
    const second = sample({ id: "S-B", patientId: "PT-A", time: 200 });
    expect(analytes("AB0", first)).toEqual(analytes("AB0", second));
    expect(analyte("AB0", "LAB_ANTIBODY_SCREEN", first).value).toBe("NEGATIVE");
    const source = runtime(); const persisted = source.snapshot();
    const restarted = new LaboratoryWorkflowRuntime(generateNarvaLabPhysiology); restarted.restore(persisted);
    const takeover = new LaboratoryWorkflowRuntime(generateNarvaLabPhysiology); takeover.restore(restarted.snapshot());
    expect(restarted.snapshot().patientBloodIdentities).toEqual(takeover.snapshot().patientBloodIdentities);
    expect(sample({ id: "S-A", patientId: "PT-A" }).sampleId)
      .not.toBe(sample({ id: "S-B", patientId: "PT-B" }).sampleId);
  });

  test("B31-A12 reports hCG only when an authoritative applicability fact is present", () => {
    const notApplicable = generate("CLINICAL_CHEMISTRY", sample({ hcgApplicable: false })).payload;
    expect((notApplicable.analytes as readonly { analyteId: string }[]).some(item => item.analyteId === "LAB_HCG"))
      .toBe(false);
    expect(notApplicable.notApplicableAnalyteIds).toEqual(["LAB_HCG"]);
    expect(analyte("CLINICAL_CHEMISTRY", "LAB_HCG", sample({ hcgApplicable: true })))
      .toMatchObject({ value: 2, unit: "IU/l", valueSource: "STATIC_BASELINE" });
    expect(analyte("CLINICAL_CHEMISTRY", "LAB_HCG",
      sample({ hcgApplicable: true, overrides: { LAB_HCG: 1250 } })))
      .toMatchObject({ value: 1250, valueSource: "SCENARIO_OVERRIDE" });
  });

  test("B31-A14 preserves authoritative codes, units and references without filling source gaps", () => {
    expect(analyte("CLINICAL_CHEMISTRY", "LAB_CREATININE"))
      .toMatchObject({ sourceCode: "P4-Crea", unit: "µmol/L", referenceRange: "male 62–106; female 44–80" });
    expect(analyte("CLINICAL_CHEMISTRY", "LAB_TROPONIN_T"))
      .toMatchObject({ sourceCode: "P4-cTnT-hs", unit: "ng/L", referenceRange: "≤14" });
    expect(NARVA_LAB_ANALYTES.find(item => item.id === "LAB_ANTIBODY_SCREEN")?.sourceCode).toBeUndefined();
    expect(NARVA_LAB_ANALYTES.find(item => item.id === "LAB_ASTRUP_HB_FR"))
      .toMatchObject({ implementationClass: "SOURCE_AMBIGUOUS" });
  });

  test("B31-A15 keeps static/scenario values anchored to the immutable sample snapshot", () => {
    const before = sample({ overrides: { LAB_CRP: 48 } });
    const released = generate("CLINICAL_CHEMISTRY", before);
    const later = generate("CLINICAL_CHEMISTRY", sample({ time: 500, overrides: { LAB_CRP: 2 } }));
    expect((released.payload.analytes as readonly { analyteId: string; value: unknown }[])
      .find(item => item.analyteId === "LAB_CRP")?.value).toBe(48);
    expect((later.payload.analytes as readonly { analyteId: string; value: unknown }[])
      .find(item => item.analyteId === "LAB_CRP")?.value).toBe(2);
    expect((generate("CLINICAL_CHEMISTRY", before).payload.analytes as readonly unknown[])).toEqual(
      released.payload.analytes);
  });

  test("B31-A16/A17 releases independent result groups at their sampledAt thresholds exactly once", () => {
    const value = runtime();
    value.advanceTo(1_599);
    expect(value.snapshot().resultGroups.every(item => item.status === "PROCESSING")).toBe(true);
    value.advanceTo(1_600);
    expect(value.snapshot().resultGroups.filter(item => item.status !== "PROCESSING").map(item => item.type))
      .toEqual(["ASTRUP"]);
    value.advanceTo(1_900);
    expect(value.snapshot().resultGroups.filter(item => item.status !== "PROCESSING").map(item => item.type))
      .toEqual(["ASTRUP", "HEMATOLOGY", "AB0"]);
    value.advanceTo(2_500);
    expect(value.snapshot().resultGroups.filter(item => item.status !== "PROCESSING")).toHaveLength(5);
    const hash = stableJson(value.snapshot()); value.advanceTo(2_500); expect(stableJson(value.snapshot())).toBe(hash);
  });

  test("B31-A18/A19/A20 restores pending state, releases overdue once by writer and never by reader", () => {
    const source = runtime(); source.advanceTo(1_599); const persisted = source.snapshot();
    const reader = new LaboratoryWorkflowRuntime(generateNarvaLabPhysiology, () => false);
    reader.restore(persisted); expect(reader.advanceTo(2_500)).toEqual([]);
    expect(reader.snapshot().resultGroups.every(item => item.status === "PROCESSING")).toBe(true);
    const takeover = new LaboratoryWorkflowRuntime(generateNarvaLabPhysiology, () => true);
    takeover.restore(reader.snapshot()); expect(takeover.advanceTo(2_500)).toHaveLength(5);
    expect(takeover.advanceTo(2_500)).toEqual([]);
    expect(takeover.snapshot().resultGroups.find(item => item.type === "AB0"))
      .toMatchObject({ status: "RESULTED", generationVersion: NARVA_LAB_STATIC_GENERATOR_VERSION });
  });
});
