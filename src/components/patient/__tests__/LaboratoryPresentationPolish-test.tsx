import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { NARVA_LAB_ANALYTES } from "@/config/NarvaLaboratoryCatalog";
import type { LaboratoryResultGroup, LaboratoryWorkflowSnapshot, LabResultGroupType } from
  "@/models/LaboratoryWorkflow";
import LaboratoryWorkflowCard, { defaultLaboratoryGroupExpanded } from "../LaboratoryWorkflowCard";
import { buildLaboratoryResultPresentation } from "../LaboratoryResultPresentation";

const resultGroup = (type: LabResultGroupType, resultPayload: Readonly<Record<string, unknown>>,
  status: LaboratoryResultGroup["status"] = "RESULTED"): LaboratoryResultGroup => Object.freeze({
  resultGroupId: `RESULT-${type}`, sampleId: "SAMPLE-1", type,
  availableAtSimulationTimeSec: 1_600, generatedAtSimulationTimeSec: 1_600,
  generationVersion: "test-v1", status, resultPayload,
});

const workflow = (resultGroups: readonly LaboratoryResultGroup[]): LaboratoryWorkflowSnapshot => Object.freeze({
  schemaVersion: 1,
  orders: [Object.freeze({ orderId: "ORDER-1", exerciseId: "EX", patientId: "PT",
    packageId: "NARVA_POLYTRAUMA", orderedAtSimulationTimeSec: 80, orderedBy: "CM", status: "RESULTED" })],
  samples: [Object.freeze({ sampleId: "SAMPLE-1", orderId: "ORDER-1", exerciseId: "EX", patientId: "PT",
    sampledAtSimulationTimeSec: 100, sourcePatientRevision: 7, sourceRuntimeStateVersion: 9,
    snapshot: Object.freeze({ schemaVersion: 1, displayedVitals: {}, targetVitals: {}, runtimeFields: {},
      clinicalProcessInputs: [] }) })],
  resultGroups, patientBloodIdentities: {},
});

const render = async (resultGroups: readonly LaboratoryResultGroup[]) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard
    workflow={workflow(resultGroups)} packageId="NARVA_POLYTRAUMA"
    onOrder={jest.fn()} onCollect={jest.fn()} />); });
  return renderer;
};

const payload = (analytes: readonly Readonly<Record<string, unknown>>[],
  pendingAnalyteIds: readonly string[] = [], notApplicableAnalyteIds: readonly string[] = []) =>
  Object.freeze({ analytes: Object.freeze(analytes), pendingAnalyteIds: Object.freeze(pendingAnalyteIds),
    notApplicableAnalyteIds: Object.freeze(notApplicableAnalyteIds) });

function fullResultGroups(): readonly LaboratoryResultGroup[] {
  const types: readonly LabResultGroupType[] = ["ASTRUP", "HEMATOLOGY", "AB0",
    "CLINICAL_CHEMISTRY", "COAGULATION"];
  return Object.freeze(types.map(type => {
    const definitions = NARVA_LAB_ANALYTES.filter(item => item.resultGroup === type && item.reportable !== false);
    const analytes = definitions.filter(item => item.id !== "LAB_ASTRUP_HB_FR" && item.id !== "LAB_HCG")
      .map(item => Object.freeze({ analyteId: item.id,
        value: item.id === "LAB_AB0" ? "AB" : item.id === "LAB_RHD" ? "POSITIVE"
          : item.id === "LAB_ANTIBODY_SCREEN" ? "NEGATIVE" : 1,
        unit: item.unit ?? "", ...(item.referenceRange ? { referenceRange: item.referenceRange } : {}) }));
    return resultGroup(type, payload(analytes,
      type === "ASTRUP" ? ["LAB_ASTRUP_HB_FR"] : [],
      type === "CLINICAL_CHEMISTRY" ? ["LAB_HCG"] : []),
    type === "ASTRUP" ? "PARTIALLY_RESULTED" : "RESULTED");
  }));
}

describe("B33 laboratory presentation polish", () => {
  test("B33-A1 exposes HIGH and LOW as textual accessible status with aligned value and unit", async () => {
    const renderer = await render([resultGroup("ASTRUP", payload([
      { analyteId: "LAB_LACTATE", value: 4.6, unit: "mmol/L", referenceRange: "0.5–1.6" },
      { analyteId: "LAB_ICA", value: 0.9, unit: "mmol/L", referenceRange: "1.15–1.35" },
    ]))]);
    expect(renderer.root.findByProps({ accessibilityLabel: "Tulemus KÕRGE" })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: "Tulemus MADAL" })).toBeTruthy();
    expect(renderer.root.findAll(node => typeof node.type === "string" && node.props.children === "4.6"))
      .toHaveLength(1);
    expect(renderer.root.findAll(node => typeof node.type === "string" &&
      node.props.children === "mmol/L").length).toBeGreaterThan(0);
  });

  test("B33-A2 keeps NORMAL visually quiet and B33-A3 infers no decoration without a reference", async () => {
    const renderer = await render([resultGroup("ASTRUP", payload([
      { analyteId: "LAB_LACTATE", value: 1, unit: "mmol/L", referenceRange: "0.5–1.6" },
      { analyteId: "LAB_PH", value: 7.31 },
    ]))]);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Tulemus Normis" })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: "laboratory-result-LAB_PH" }).props.accessibilityLabel)
      .not.toMatch(/KÕRGE|MADAL/);
  });

  test("B33-A4 renders qualitative blood-bank values without numeric reference chrome", async () => {
    const renderer = await render([resultGroup("AB0", payload([
      { analyteId: "LAB_AB0", value: "AB", unit: "-" },
      { analyteId: "LAB_RHD", value: "POSITIVE", unit: "-" },
      { analyteId: "LAB_ANTIBODY_SCREEN", value: "NEGATIVE", unit: "-" },
    ]))]);
    await act(async () => renderer.root.findByProps({ testID: "laboratory-group-toggle-AB0" }).props.onPress());
    const blood = renderer.root.findByProps({ testID: "laboratory-result-LAB_AB0" });
    expect(blood.findAll(node => typeof node.type === "string" && node.props.children === "AB")).toHaveLength(1);
    expect(blood.findAll(node => typeof node.type === "string" && typeof node.props.children === "string" &&
      node.props.children.startsWith("Võrdlus:"))).toHaveLength(0);
  });

  test("B33-A5 distinguishes hCG not-applicable and omits the non-reportable Hb-Fr source token", async () => {
    const renderer = await render([
      resultGroup("ASTRUP", payload([], ["LAB_ASTRUP_HB_FR"]), "PARTIALLY_RESULTED"),
      resultGroup("CLINICAL_CHEMISTRY", payload([], [], ["LAB_HCG"])),
    ]);
    expect(renderer.root.findAllByProps({ testID: "laboratory-result-LAB_ASTRUP_HB_FR" })).toHaveLength(0);
    await act(async () => renderer.root.findByProps({ testID: "laboratory-group-toggle-CLINICAL_CHEMISTRY" })
      .props.onPress());
    const hcg = renderer.root.findByProps({ testID: "laboratory-result-LAB_HCG" });
    expect(hcg.findAll(node => typeof node.type === "string" && node.props.children === "Ei kohaldu"))
      .toHaveLength(1);
    expect(hcg.findAll(node => typeof node.type === "string" &&
      node.props.children === "Pole negatiivne tulemus")).toHaveLength(1);
  });

  test("B33-A7 applies deterministic priority expansion and preserves explicit expand/collapse", async () => {
    const presented = buildLaboratoryResultPresentation(fullResultGroups(), "NARVA_POLYTRAUMA");
    expect(presented.map(group => defaultLaboratoryGroupExpanded(group)))
      .toEqual([true, false, false, false, false]);
    const renderer = await render(fullResultGroups());
    const toggle = renderer.root.findByProps({ testID: "laboratory-group-toggle-HEMATOLOGY" });
    await act(async () => toggle.props.onPress());
    expect(renderer.root.findAll(node => typeof node.type === "string" &&
      node.props.testID === "laboratory-group-content-HEMATOLOGY")).toHaveLength(1);
    await act(async () => toggle.props.onPress());
    expect(renderer.root.findAllByProps({ testID: "laboratory-group-content-HEMATOLOGY" })).toHaveLength(0);
  });

  test("B33-A8 keeps all 58 reportable rows reachable and B33-A9 never mutates canonical payload", async () => {
    const canonical = fullResultGroups();
    const before = JSON.stringify(canonical);
    const renderer = await render(canonical);
    for (const type of ["HEMATOLOGY", "AB0", "CLINICAL_CHEMISTRY", "COAGULATION"] as const) {
      await act(async () => renderer.root.findByProps({ testID: `laboratory-group-toggle-${type}` }).props.onPress());
    }
    expect(renderer.root.findAll(node => typeof node.type === "string" &&
      node.props.testID?.startsWith("laboratory-result-"))).toHaveLength(58);
    expect(JSON.stringify(canonical)).toBe(before);
  });
});
