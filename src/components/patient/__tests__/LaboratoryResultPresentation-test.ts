import { NARVA_LAB_ANALYTES } from "@/config/NarvaLaboratoryCatalog";
import type { LaboratoryResultGroup, LabResultGroupType } from "@/models/LaboratoryWorkflow";
import { buildLaboratoryResultPresentation, laboratoryAbnormalFlag } from
  "../LaboratoryResultPresentation";

const group = (type: LabResultGroupType, status: LaboratoryResultGroup["status"],
  resultPayload?: Readonly<Record<string, unknown>>): LaboratoryResultGroup => Object.freeze({
  resultGroupId: `GROUP-${type}`, sampleId: "SAMPLE-1", type,
  availableAtSimulationTimeSec: 1_500, status, ...(resultPayload ? { resultPayload } : {}),
});

const payload = (analytes: readonly Readonly<Record<string, unknown>>[],
  pendingAnalyteIds: readonly string[] = [], notApplicableAnalyteIds: readonly string[] = []) =>
  Object.freeze({ analytes: Object.freeze(analytes), pendingAnalyteIds: Object.freeze(pendingAnalyteIds),
    notApplicableAnalyteIds: Object.freeze(notApplicableAnalyteIds) });

const result = (analyteId: string, value: unknown, unit = "", referenceRange?: string) => Object.freeze({
  analyteId, value, unit, ...(referenceRange ? { referenceRange } : {}),
});

function fullGroups(): readonly LaboratoryResultGroup[] {
  const types: readonly LabResultGroupType[] = ["COAGULATION", "CLINICAL_CHEMISTRY", "AB0",
    "HEMATOLOGY", "ASTRUP"];
  return Object.freeze(types.map(type => {
    const definitions = NARVA_LAB_ANALYTES.filter(item => item.resultGroup === type && item.reportable !== false);
    const analytes = definitions.filter(item => item.id !== "LAB_HCG")
      .map(item => result(item.id, item.id === "LAB_AB0" ? "AB" : item.id === "LAB_RHD" ? "POSITIVE"
        : item.id === "LAB_ANTIBODY_SCREEN" ? "NEGATIVE" : 1, item.unit ?? "", item.referenceRange));
    return group(type, "RESULTED", payload(analytes, [],
      type === "CLINICAL_CHEMISTRY" ? ["LAB_HCG"] : []));
  }));
}

describe("B32 laboratory result presentation", () => {
  test("B32-A1 renders every canonical full-result component without silent omission", () => {
    const groups = buildLaboratoryResultPresentation(fullGroups(), "NARVA_POLYTRAUMA");
    expect(groups.flatMap(item => item.rows)).toHaveLength(58);
    expect(groups.flatMap(item => item.rows).filter(item => item.state === "RESULT")).toHaveLength(57);
  });

  test("B32-A2 assigns each analyte to its canonical result group", () => {
    const groups = buildLaboratoryResultPresentation(fullGroups(), "NARVA_POLYTRAUMA");
    expect(groups.find(item => item.type === "ASTRUP")?.rows.map(item => item.analyteId)).toContain("LAB_PH");
    expect(groups.find(item => item.type === "AB0")?.rows.map(item => item.analyteId))
      .toEqual(["LAB_AB0", "LAB_RHD", "LAB_ANTIBODY_SCREEN"]);
  });

  test("B32-A3 preserves canonical group and catalog analyte order across renders", () => {
    const first = buildLaboratoryResultPresentation(fullGroups(), "NARVA_POLYTRAUMA");
    const second = buildLaboratoryResultPresentation([...fullGroups()].reverse(), "NARVA_POLYTRAUMA");
    expect(first.map(item => item.type)).toEqual(["ASTRUP", "HEMATOLOGY", "AB0",
      "CLINICAL_CHEMISTRY", "COAGULATION"]);
    expect(second.map(item => [item.type, item.rows.map(row => row.analyteId)]))
      .toEqual(first.map(item => [item.type, item.rows.map(row => row.analyteId)]));
  });

  test("B32-A4 presents a normal numeric result with exact unit and reference", () => {
    const [astrup] = buildLaboratoryResultPresentation([
      group("ASTRUP", "RESULTED", payload([result("LAB_LACTATE", 1, "mmol/L", "0.5–1.6")])),
    ], "NARVA_IRO_ASTRUP");
    expect(astrup.rows.find(item => item.analyteId === "LAB_LACTATE"))
      .toMatchObject({ valueText: "1", unit: "mmol/L", referenceRange: "0.5–1.6", abnormalFlag: "NORMAL" });
  });

  test("B32-A5 marks a numeric value above a valid range HIGH", () => {
    expect(laboratoryAbnormalFlag(2.4, "0.5–1.6")).toBe("HIGH");
  });

  test("B32-A6 marks a numeric value below a valid range LOW", () => {
    expect(laboratoryAbnormalFlag(0.2, "0.5–1.6")).toBe("LOW");
  });

  test("B32-A7 does not invent a flag without one unambiguous numeric reference", () => {
    expect(laboratoryAbnormalFlag(7.31)).toBe("UNCLASSIFIED");
    expect(laboratoryAbnormalFlag(7.31, "female 7.35–7.45; male 7.34–7.44")).toBe("UNCLASSIFIED");
  });

  test("B32-A8 presents qualitative AB0 and RhD values cleanly", () => {
    const [blood] = buildLaboratoryResultPresentation([group("AB0", "RESULTED", payload([
      result("LAB_AB0", "AB", "-"), result("LAB_RHD", "POSITIVE", "-"),
      result("LAB_ANTIBODY_SCREEN", "NEGATIVE", "-"),
    ]))], "NARVA_POLYTRAUMA");
    expect(blood.rows.find(item => item.analyteId === "LAB_AB0")?.valueText).toBe("AB");
    expect(blood.rows.find(item => item.analyteId === "LAB_RHD")?.valueText).toBe("Positiivne");
  });

  test("B32-A9 presents antibody screen as a qualitative result", () => {
    const [blood] = buildLaboratoryResultPresentation([group("AB0", "RESULTED", payload([
      result("LAB_ANTIBODY_SCREEN", "NEGATIVE", "-"),
    ]))], "NARVA_POLYTRAUMA");
    expect(blood.rows.find(item => item.analyteId === "LAB_ANTIBODY_SCREEN"))
      .toMatchObject({ valueText: "Negatiivne", abnormalFlag: "UNCLASSIFIED" });
  });

  test("B32-A10 displays hCG only when present in the canonical result", () => {
    const [chemistry] = buildLaboratoryResultPresentation([group("CLINICAL_CHEMISTRY", "RESULTED",
      payload([result("LAB_HCG", 1250, "IU/l")]))], "NARVA_POLYTRAUMA");
    expect(chemistry.rows.find(item => item.analyteId === "LAB_HCG"))
      .toMatchObject({ state: "RESULT", valueText: "1250", unit: "IU/l" });
  });

  test("B32-A11 renders not-applicable hCG without a misleading numeric value", () => {
    const [chemistry] = buildLaboratoryResultPresentation([group("CLINICAL_CHEMISTRY", "RESULTED",
      payload([], [], ["LAB_HCG"]))], "NARVA_POLYTRAUMA");
    expect(chemistry.rows.find(item => item.analyteId === "LAB_HCG"))
      .toMatchObject({ state: "NOT_APPLICABLE", abnormalFlag: "UNCLASSIFIED" });
  });

  test("B32-A12 excludes non-reportable aB-Hb-Fr even if a legacy payload marks it pending", () => {
    const [astrup] = buildLaboratoryResultPresentation([group("ASTRUP", "PARTIALLY_RESULTED",
      payload([], ["LAB_ASTRUP_HB_FR"]))], "NARVA_IRO_ASTRUP");
    expect(astrup.rows.find(item => item.analyteId === "LAB_ASTRUP_HB_FR"))
      .toBeUndefined();
  });

  test("B32-A13 distinguishes a pending group without fake result rows", () => {
    const [groupView] = buildLaboratoryResultPresentation([group("ASTRUP", "PROCESSING")],
      "NARVA_IRO_ASTRUP");
    expect(groupView).toMatchObject({ statusLabel: "Ootel", rows: [], resultCount: 0 });
  });

  test("B32-A14 replaces a pending group with canonical released rows without duplication", () => {
    const pending = buildLaboratoryResultPresentation([group("ASTRUP", "PROCESSING")],
      "NARVA_IRO_ASTRUP");
    const released = buildLaboratoryResultPresentation([group("ASTRUP", "RESULTED",
      payload([result("LAB_PH", 7.4)]))], "NARVA_IRO_ASTRUP");
    expect(pending[0].rows).toHaveLength(0);
    expect(released[0].rows.filter(item => item.analyteId === "LAB_PH" && item.state === "RESULT"))
      .toHaveLength(1);
  });

  test("B32-A15 renders the same canonical payload identically after rehydration", () => {
    const before = buildLaboratoryResultPresentation(fullGroups(), "NARVA_POLYTRAUMA");
    const rehydrated = JSON.parse(JSON.stringify(fullGroups())) as readonly LaboratoryResultGroup[];
    expect(buildLaboratoryResultPresentation(rehydrated, "NARVA_POLYTRAUMA")).toEqual(before);
  });

  test("B32-A16 suppresses duplicate payload analytes by stable canonical identity", () => {
    const duplicate = result("LAB_PH", 7.4);
    const [astrup] = buildLaboratoryResultPresentation([group("ASTRUP", "RESULTED",
      payload([duplicate, duplicate]))], "NARVA_IRO_ASTRUP");
    expect(astrup.rows.filter(item => item.analyteId === "LAB_PH")).toHaveLength(1);
  });

  test("B32-A17 builds the complete long payload without failure", () => {
    const rows = buildLaboratoryResultPresentation(fullGroups(), "NARVA_POLYTRAUMA")
      .flatMap(item => item.rows);
    expect(rows.filter(item => item.state === "RESULT")).toHaveLength(57);
    expect(new Set(rows.map(item => item.key)).size).toBe(58);
  });

  test("B32-A18 never mutates the canonical result payload", () => {
    const canonical = fullGroups();
    const before = JSON.stringify(canonical);
    buildLaboratoryResultPresentation(canonical, "NARVA_POLYTRAUMA");
    expect(JSON.stringify(canonical)).toBe(before);
  });
});
