import { LaboratoryWorkflowRuntime, assertLabPackageAllowed } from "../LaboratoryWorkflowRuntime";
import type { LaboratoryResultGenerator, LaboratoryWorkflowSnapshot } from "@/models/LaboratoryWorkflow";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const generator: LaboratoryResultGenerator = ({ sample, resultGroupType }) => Object.freeze({
  generationVersion: "TEST_FIXTURE_V1", payload: Object.freeze({
    group: resultGroupType, sampledAt: sample.sampledAtSimulationTimeSec,
    capturedLactate: sample.snapshot.runtimeFields.lactate,
  }),
});
const order = (runtime: LaboratoryWorkflowRuntime, orderId = "O-1", packageId = "NARVA_POLYTRAUMA" as const) =>
  runtime.order({ orderId, exerciseId: "EX-1", patientId: "PT-1", packageId,
    orderedAtSimulationTimeSec: 900, orderedBy: "CM-A" });
const collect = (runtime: LaboratoryWorkflowRuntime, overrides: Partial<Parameters<LaboratoryWorkflowRuntime["collect"]>[0]> = {}) =>
  runtime.collect({ sampleId: "S-1", orderId: "O-1", sampledAtSimulationTimeSec: 1000,
    sourcePatientRevision: 7, sourceRuntimeStateVersion: 11,
    snapshot: { displayedVitals: { hr: 92 }, targetVitals: { hr: 90 }, runtimeFields: { lactate: 3.2 },
      clinicalProcessInputs: [],
      patientBloodIdentity: { ab0: "O", rhd: "POSITIVE", antibodyScreen: "NEGATIVE" } }, ...overrides });

describe("LaboratoryWorkflowRuntime LAB-G01..LAB-G16", () => {
  test("captures one immutable sample and remains uncontaminated by later physiology (G01/G02/G03/G13)", () => {
    const runtime = new LaboratoryWorkflowRuntime(generator); order(runtime);
    const source = { displayedVitals: { hr: 92 }, targetVitals: { hr: 90 }, runtimeFields: { lactate: 3.2 },
      clinicalProcessInputs: [] };
    const sample = collect(runtime, { snapshot: source });
    source.runtimeFields.lactate = 9.9;
    expect(sample.snapshot.runtimeFields.lactate).toBe(3.2);
    expect(Object.isFrozen(sample.snapshot.runtimeFields)).toBe(true);
    try { (sample.snapshot.runtimeFields as Record<string, unknown>).lactate = 8; } catch { /* strict engines throw */ }
    expect(sample.snapshot.runtimeFields.lactate).toBe(3.2);
    expect(collect(runtime)).toEqual(sample);
    runtime.advanceTo(2500);
    expect(runtime.snapshot().resultGroups.find(item => item.type === "ASTRUP")?.resultPayload)
      .toMatchObject({ sampledAt: 1000, capturedLactate: 3.2 });
  });

  test("anchors independent result groups to sample time, never order/release time (G07/G08/G09)", () => {
    const runtime = new LaboratoryWorkflowRuntime(generator); order(runtime); collect(runtime);
    expect(runtime.snapshot().resultGroups.map(group => [group.type, group.availableAtSimulationTimeSec])).toEqual([
      ["ASTRUP", 2500], ["HEMATOLOGY", 2800], ["AB0", 2800],
      ["CLINICAL_CHEMISTRY", 3400], ["COAGULATION", 3400],
    ]);
    expect(runtime.advanceTo(2499)).toEqual([]);
    expect(runtime.advanceTo(2500).map(item => item.type)).toEqual(["ASTRUP"]);
    expect(runtime.snapshot().orders[0].status).toBe("PARTIALLY_RESULTED");
    expect(runtime.advanceTo(2800).map(item => item.type)).toEqual(["HEMATOLOGY", "AB0"]);
    expect(runtime.advanceTo(3400).map(item => item.type)).toEqual(["CLINICAL_CHEMISTRY", "COAGULATION"]);
    expect(runtime.snapshot().orders[0].status).toBe("RESULTED");
  });

  test("restores canonically for reader/restart/takeover and releases exactly once (G03/G05/G06/G16)", () => {
    const writer = new LaboratoryWorkflowRuntime(generator); order(writer); collect(writer); writer.advanceTo(2400);
    const persisted = writer.snapshot(); const hash = sha256Text(stableJson(persisted));
    const reader = new LaboratoryWorkflowRuntime(); reader.restore(persisted); reader.advanceTo(4000);
    expect(reader.snapshot()).toEqual(persisted); // no reader-local generator or revision
    const takeover = new LaboratoryWorkflowRuntime(generator); takeover.restore(reader.snapshot());
    expect(sha256Text(stableJson(takeover.snapshot()))).toBe(hash);
    expect(takeover.advanceTo(2500)).toHaveLength(1);
    expect(takeover.advanceTo(2500)).toHaveLength(0);
    const restarted = new LaboratoryWorkflowRuntime(generator); restarted.restore(takeover.snapshot());
    expect(restarted.snapshot()).toEqual(takeover.snapshot());
  });

  test("fences all progression and resurrection after terminal completion (G10)", () => {
    const runtime = new LaboratoryWorkflowRuntime(generator); order(runtime); collect(runtime);
    runtime.fenceTerminal(1200); const terminal = runtime.snapshot();
    expect(runtime.advanceTo(4000)).toEqual([]);
    expect(() => order(runtime, "O-2")).toThrow("LAB_TERMINAL_FENCED");
    expect(() => collect(runtime, { sampleId: "S-2" })).toThrow("LAB_TERMINAL_FENCED");
    const restarted = new LaboratoryWorkflowRuntime(generator); restarted.restore(terminal);
    expect(restarted.advanceTo(4000)).toEqual([]); expect(restarted.snapshot()).toEqual(terminal);
  });

  test("keeps AB0 identity stable and RESULTED payload immutable (G12/G15)", () => {
    const runtime = new LaboratoryWorkflowRuntime(generator); order(runtime); collect(runtime); runtime.advanceTo(4000);
    const result = runtime.snapshot().resultGroups.find(item => item.type === "AB0")!;
    expect(Object.isFrozen(result.resultPayload)).toBe(true);
    try { (result.resultPayload as Record<string, unknown>).sampledAt = 7; } catch { /* strict engines throw */ }
    expect(result.resultPayload?.sampledAt).toBe(1000);
    order(runtime, "O-2");
    expect(() => collect(runtime, { sampleId: "S-2", orderId: "O-2", snapshot: {
      displayedVitals: {}, targetVitals: {}, runtimeFields: {},
      clinicalProcessInputs: [],
      patientBloodIdentity: { ab0: "A", rhd: "NEGATIVE" } } })).toThrow("LAB_AB0_IDENTITY_CONFLICT");
    expect(runtime.snapshot().patientBloodIdentities["PT-1"]).toEqual({ ab0: "O", rhd: "POSITIVE", antibodyScreen: "NEGATIVE" });
  });

  test("fails closed on corrupt persisted timing or result state", () => {
    const runtime = new LaboratoryWorkflowRuntime(generator); order(runtime); collect(runtime);
    const persisted = structuredClone(runtime.snapshot()) as LaboratoryWorkflowSnapshot;
    (persisted.resultGroups[0] as { availableAtSimulationTimeSec: number }).availableAtSimulationTimeSec += 1;
    expect(() => new LaboratoryWorkflowRuntime().restore(persisted)).toThrow("LAB_INVALID_RESULT_GROUP");
  });

  test("enforces EMO/IRO package isolation (G11)", () => {
    expect(() => assertLabPackageAllowed("russicaptor.narva-iro-evacuation", "NARVA_POLYTRAUMA"))
      .toThrow("LAB_PACKAGE_SCOPE_DENIED");
    expect(() => assertLabPackageAllowed("russicaptor.narva-trauma", "NARVA_IRO_ASTRUP"))
      .toThrow("LAB_PACKAGE_SCOPE_DENIED");
    expect(() => assertLabPackageAllowed("russicaptor.narva-iro-evacuation", "NARVA_IRO_ASTRUP")).not.toThrow();
  });

  test("has no independent writer and no MTP/iCa substitution (G04/G14)", () => {
    const source = LaboratoryWorkflowRuntime.toString();
    expect(source).not.toMatch(/lease|heartbeat|Mtp|MassiveTransfusion/);
    expect(source).toContain("this.generator");
  });
});
