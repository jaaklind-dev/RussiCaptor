import { ImagingWorkflowRuntime } from "../ImagingWorkflowRuntime";
import type { ImagingOrderDefinitionSnapshot } from "@/models/ImagingWorkflow";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const definition = (overrides: Partial<ImagingOrderDefinitionSnapshot> = {}): ImagingOrderDefinitionSnapshot => ({
  definitionId: "P09-CXR", patientId: "P09", title: "Rindkere röntgen", modality: "XR",
  reportSource: "Kopsuväljad ilma infiltraadita.", delaySeconds: 420,
  packageId: "russicaptor.botulism-johvi", packageVersion: "2.0.0", packageHash: "hash", ...overrides,
});
const order = (runtime: ImagingWorkflowRuntime, commandId: string, at = 100) => runtime.order({ commandId,
  exerciseId: "EX-I2", patientId: "P09", orderedBy: "CM-A", orderedAtSimulationTimeSec: at,
  definition: definition() });

describe("I2 durable Imaging lifecycle / IMG-G11..IMG-G25", () => {
  test("I2-A1/A2 creates one deterministic instance and replays the same command idempotently", () => {
    const runtime = new ImagingWorkflowRuntime();
    expect(order(runtime, "CMD-1")).toMatchObject({ imagingInstanceId: "IMAGING:CMD-1", repeatOrdinal: 1,
      status: "ORDERED", availableAtSimulationTimeSec: 520 });
    expect(order(runtime, "CMD-1")).toEqual(runtime.snapshot().instances[0]);
    expect(runtime.snapshot().instances).toHaveLength(1);
  });

  test("I2-A3..A8 releases once at or beyond the simulation threshold, including huge jumps", () => {
    for (const target of [520, 521, 100_000]) {
      const runtime = new ImagingWorkflowRuntime(); order(runtime, `CMD-${target}`);
      expect(runtime.advanceTo(519)[0]).toMatchObject({ status: "PROCESSING" });
      expect(runtime.snapshot().instances[0]).not.toHaveProperty("result");
      expect(runtime.advanceTo(target)[0]).toMatchObject({ status: "RESULTED",
        result: { report: "Kopsuväljad ilma infiltraadita.", releasedAtSimulationTimeSec: target } });
      expect(runtime.advanceTo(target + 100)).toEqual([]);
      expect(runtime.snapshot().instances.filter(item => item.status === "RESULTED")).toHaveLength(1);
    }
  });

  test("I2-A9 result is immutable and package mutation cannot alter the captured source", () => {
    const source = definition(); const runtime = new ImagingWorkflowRuntime();
    runtime.order({ commandId: "CMD-I", exerciseId: "EX-I2", patientId: "P09", orderedBy: "CM",
      orderedAtSimulationTimeSec: 0, definition: source });
    (source as { reportSource: string }).reportSource = "changed";
    runtime.advanceTo(420); const before = runtime.snapshot(); const hash = sha256Text(stableJson(before));
    runtime.advanceTo(999); expect(sha256Text(stableJson(runtime.snapshot()))).toBe(hash);
    expect(before.instances[0].result?.report).toBe("Kopsuväljad ilma infiltraadita.");
  });

  test("I2-A10..A13 restart/takeover preserves pending state and releases overdue exactly once", () => {
    const source = new ImagingWorkflowRuntime(); order(source, "CMD-R", 20); source.advanceTo(100);
    const checkpoint = source.snapshot();
    const before = new ImagingWorkflowRuntime(); before.restore(checkpoint);
    expect(before.snapshot()).toEqual(checkpoint); expect(before.advanceTo(439)).toEqual([]);
    const overdue = new ImagingWorkflowRuntime(); overdue.restore(checkpoint);
    expect(overdue.advanceTo(440)).toHaveLength(1); expect(overdue.advanceTo(500)).toEqual([]);
    const secondTakeover = new ImagingWorkflowRuntime(); secondTakeover.restore(overdue.snapshot());
    expect(secondTakeover.advanceTo(600)).toEqual([]);
  });

  test("I2-A14 reader cannot mutate or release", () => {
    const writer = new ImagingWorkflowRuntime(); order(writer, "CMD-READ");
    const reader = new ImagingWorkflowRuntime(() => false); reader.restore(writer.snapshot());
    expect(() => order(reader, "CMD-NO")).toThrow("IMAGING_WRITER_REQUIRED");
    expect(reader.advanceTo(10_000)).toEqual([]);
    expect(reader.snapshot().instances[0].status).toBe("ORDERED");
  });

  test("I2-A15..A17 separates repeats, replay stays idempotent, first result remains unchanged", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime, "CMD-1", 0); runtime.advanceTo(420);
    const first = runtime.snapshot().instances[0]; order(runtime, "CMD-2", 500); order(runtime, "CMD-2", 500);
    expect(runtime.snapshot().instances.map(item => [item.imagingInstanceId, item.repeatOrdinal]))
      .toEqual([["IMAGING:CMD-1", 1], ["IMAGING:CMD-2", 2]]);
    runtime.advanceTo(920); expect(runtime.snapshot().instances[0]).toEqual(first);
  });

  test("I2-A18 terminal fence prevents orders and late releases", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime, "CMD-T", 0); runtime.fenceTerminal(10);
    expect(() => order(runtime, "CMD-LATE", 11)).toThrow("IMAGING_TERMINAL_FENCED");
    expect(runtime.advanceTo(1_000)).toEqual([]);
    expect(runtime.snapshot().instances[0]).not.toHaveProperty("result");
  });

  test("I2-A19/A20 checkpoint roundtrip retains identities, timestamps and package provenance", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime, "CMD-P", 4); runtime.advanceTo(424);
    const restored = new ImagingWorkflowRuntime(); restored.restore(runtime.snapshot());
    expect(restored.snapshot()).toEqual(runtime.snapshot());
    expect(restored.snapshot().instances[0]).toMatchObject({ packageId: "russicaptor.botulism-johvi",
      packageVersion: "2.0.0", packageHash: "hash", definitionId: "P09-CXR" });
  });

  test("I2-A21 pre-release state contains authored source but no released result", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime, "CMD-HIDDEN"); runtime.advanceTo(519);
    expect(runtime.snapshot().instances[0]).toMatchObject({ status: "PROCESSING" });
    expect(runtime.snapshot().instances[0].result).toBeUndefined();
  });
});
