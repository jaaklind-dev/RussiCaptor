import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import type { LaboratoryResultGroup, LaboratoryWorkflowSnapshot } from "@/models/LaboratoryWorkflow";
import LaboratoryWorkflowCard from "../LaboratoryWorkflowCard";

const resultGroup = (type: LaboratoryResultGroup["type"], status: LaboratoryResultGroup["status"],
  resultPayload?: Readonly<Record<string, unknown>>): LaboratoryResultGroup => Object.freeze({
  resultGroupId: `RESULT-${type}`, sampleId: "SAMPLE-1", type,
  availableAtSimulationTimeSec: 1_600, status, ...(resultPayload ? { resultPayload } : {}),
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

const render = async (value: LaboratoryWorkflowSnapshot) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={value}
    packageId="NARVA_POLYTRAUMA" onOrder={jest.fn()} onCollect={jest.fn()} />); });
  return renderer;
};

describe("B32 LaboratoryWorkflowCard presentation", () => {
  test("uses compact expandable canonical group sections for a long result", async () => {
    const renderer = await render(workflow([
      resultGroup("ASTRUP", "RESULTED", { analytes: [{ analyteId: "LAB_PH", value: 7.4 }] }),
      resultGroup("AB0", "RESULTED", { analytes: [
        { analyteId: "LAB_AB0", value: "AB", unit: "-" },
        { analyteId: "LAB_RHD", value: "POSITIVE", unit: "-" },
        { analyteId: "LAB_ANTIBODY_SCREEN", value: "NEGATIVE", unit: "-" },
      ] }),
    ]));
    expect(renderer.root.findAllByProps({ testID: "laboratory-group-content-ASTRUP" }).length)
      .toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ testID: "laboratory-group-content-AB0" })).toHaveLength(0);
    await act(async () => { renderer.root.findByProps({ testID: "laboratory-group-toggle-AB0" }).props.onPress(); });
    expect(renderer.root.findByProps({ testID: "laboratory-result-LAB_AB0" })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: "laboratory-result-LAB_RHD" })).toBeTruthy();
  });

  test("shows pending group status without placeholder values", async () => {
    const renderer = await render(workflow([resultGroup("COAGULATION", "PROCESSING")]));
    const toggle = renderer.root.findByProps({ testID: "laboratory-group-toggle-COAGULATION" });
    expect(toggle.props.accessibilityLabel).toContain("Ootel");
    await act(async () => { toggle.props.onPress(); });
    expect(renderer.root.findAll(node => node.props.testID?.startsWith("laboratory-result-"))).toHaveLength(0);
  });

  test("updates a stable group from pending to released canonical result", async () => {
    const pending = workflow([resultGroup("COAGULATION", "PROCESSING")]);
    const renderer = await render(pending);
    const section = renderer.root.findByProps({ testID: "laboratory-group-section-COAGULATION" });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={workflow([
      resultGroup("COAGULATION", "RESULTED", { analytes: [
        { analyteId: "LAB_INR", value: 1.4, referenceRange: "0.85–1.15" },
      ] }),
    ])} packageId="NARVA_POLYTRAUMA" onOrder={jest.fn()} onCollect={jest.fn()} />); });
    expect(renderer.root.findByProps({ testID: "laboratory-group-section-COAGULATION" })).toBe(section);
    await act(async () => { renderer.root.findByProps({ testID: "laboratory-group-toggle-COAGULATION" })
      .props.onPress(); });
    expect(renderer.root.findAllByProps({ testID: "laboratory-result-LAB_INR" }).length).toBeGreaterThan(0);
  });

  test("renders abnormal state with text and border semantics rather than color alone", async () => {
    const renderer = await render(workflow([resultGroup("ASTRUP", "RESULTED", { analytes: [
      { analyteId: "LAB_LACTATE", value: 4.6, unit: "mmol/L", referenceRange: "0.5–1.6" },
    ] })]));
    expect(renderer.root.findByProps({ accessibilityLabel: "Tulemus KÕRGE" })).toBeTruthy();
  });

  test("renders ambiguous and not-applicable states without measured values", async () => {
    const renderer = await render(workflow([
      resultGroup("ASTRUP", "PARTIALLY_RESULTED", { analytes: [],
        pendingAnalyteIds: ["LAB_ASTRUP_HB_FR"] }),
      resultGroup("CLINICAL_CHEMISTRY", "RESULTED", { analytes: [],
        notApplicableAnalyteIds: ["LAB_HCG"] }),
    ]));
    const ambiguous = renderer.root.findByProps({ testID: "laboratory-result-LAB_ASTRUP_HB_FR" });
    expect(ambiguous.findAll(node => node.props.children === "Lahendamata").length).toBeGreaterThan(0);
    await act(async () => { renderer.root.findByProps({ testID: "laboratory-group-toggle-CLINICAL_CHEMISTRY" })
      .props.onPress(); });
    const hcg = renderer.root.findByProps({ testID: "laboratory-result-LAB_HCG" });
    expect(hcg.findAll(node => node.props.children === "Ei kohaldu").length).toBeGreaterThan(0);
  });
});
