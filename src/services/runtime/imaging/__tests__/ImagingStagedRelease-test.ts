import { ImagingWorkflowRuntime } from "../ImagingWorkflowRuntime";
import { DEMO_HEAD_CT_ASSET } from "@/services/imaging/ImagingAssetRegistry";
import type { ImagingOrderDefinitionSnapshot, ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";

const definition = (extra: Partial<ImagingOrderDefinitionSnapshot> = {}): ImagingOrderDefinitionSnapshot => ({
  definitionId: "IMG-1", patientId: "PT-001", title: "XR", modality: "XR", reportSource: "REPORT AT TEN",
  asset: DEMO_HEAD_CT_ASSET, imageDelaySeconds: 420, delaySeconds: 600,
  packageId: "PKG", packageVersion: "1", packageHash: "HASH", ...extra,
});
const order = (runtime: ImagingWorkflowRuntime, at = 0, id = "CMD", extra: Partial<ImagingOrderDefinitionSnapshot> = {}) =>
  runtime.order({ commandId: id, exerciseId: "EX", patientId: "PT-001", orderedBy: "CM",
    orderedAtSimulationTimeSec: at, definition: definition(extra) });

describe("explicit staged Imaging image/report release", () => {
  test("image at seven and report at ten use absolute simulation time from order", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime, 100);
    expect(runtime.snapshot()).toMatchObject({ schemaVersion: 3, instances: [{
      imageAvailableAtSimulationTimeSec: 520, availableAtSimulationTimeSec: 700 }] });
    runtime.advanceTo(519);
    expect(runtime.snapshot().instances[0]).toMatchObject({ status: "PROCESSING" });
    expect(runtime.snapshot().instances[0].imageResult).toBeUndefined();
    expect(runtime.snapshot().instances[0].result).toBeUndefined();
    expect(runtime.advanceTo(520)).toHaveLength(1);
    const image = runtime.snapshot().instances[0].imageResult;
    expect(image).toMatchObject({ imageResultId: "IMAGING_IMAGE:IMAGING:CMD", asset: DEMO_HEAD_CT_ASSET,
      patientId: "PT-001", definitionId: "IMG-1", packageId: "PKG", packageVersion: "1", packageHash: "HASH",
      releasedAtSimulationTimeSec: 520 });
    expect(image).not.toHaveProperty("reportText");
    expect(runtime.snapshot().instances[0].result).toBeUndefined();
    expect(runtime.advanceTo(699)).toEqual([]);
    expect(runtime.advanceTo(700)).toHaveLength(1);
    expect(runtime.snapshot().instances[0].imageResult).toEqual(image);
    expect(runtime.snapshot().instances[0].result).toMatchObject({ reportText: "REPORT AT TEN",
      asset: DEMO_HEAD_CT_ASSET, releasedAtSimulationTimeSec: 700 });
    const final = runtime.snapshot(); expect(runtime.advanceTo(10000)).toEqual([]);
    expect(runtime.snapshot()).toEqual(final);
  });

  test.each([0, 419, 420, 599, 600])("cold restore at %i preserves both stages and reader cannot advance", at => {
    const writer = new ImagingWorkflowRuntime(); order(writer); writer.advanceTo(at);
    const saved = writer.snapshot();
    const restored = new ImagingWorkflowRuntime(); restored.restore(saved);
    expect(restored.snapshot()).toEqual(saved);
    const reader = new ImagingWorkflowRuntime(() => false); reader.restore(saved);
    expect(reader.advanceTo(900)).toEqual([]); expect(reader.snapshot()).toEqual(saved);
    expect(() => order(reader, 0, "UNAUTHORIZED")).toThrow("IMAGING_WRITER_REQUIRED");
    restored.advanceTo(600);
    const final = restored.snapshot();
    expect(final.instances[0]).toMatchObject({ status: "RESULTED", result: { reportText: "REPORT AT TEN" } });
    const takeover = new ImagingWorkflowRuntime(); takeover.restore(final);
    expect(takeover.advanceTo(999)).toEqual([]); expect(takeover.snapshot()).toEqual(final);
  });

  test("late reconciliation releases image and report once in one canonical change", () => {
    const writer = new ImagingWorkflowRuntime(); order(writer); const restored = new ImagingWorkflowRuntime();
    restored.restore(writer.snapshot()); expect(restored.advanceTo(10000)).toHaveLength(1);
    expect(restored.snapshot().instances[0]).toMatchObject({ imageResult: { releasedAtSimulationTimeSec: 10000 },
      result: { releasedAtSimulationTimeSec: 10000 } });
    expect(restored.advanceTo(10001)).toEqual([]);
  });

  test("terminal fence between stages retains image without late report", () => {
    const writer = new ImagingWorkflowRuntime(); order(writer); writer.advanceTo(420);
    writer.fenceTerminal(500); const saved = writer.snapshot();
    const restored = new ImagingWorkflowRuntime(); restored.restore(saved);
    expect(restored.advanceTo(900)).toEqual([]); expect(restored.snapshot()).toEqual(saved);
    expect(restored.snapshot().instances[0].imageResult).toBeDefined();
    expect(restored.snapshot().instances[0].result).toBeUndefined();
  });

  test("repeated orders have independent deadlines and immutable first results", () => {
    const runtime = new ImagingWorkflowRuntime(); const first = order(runtime);
    expect(order(runtime)).toEqual(first);
    runtime.advanceTo(420); const image = runtime.snapshot().instances[0].imageResult;
    order(runtime, 100, "REPEAT"); order(runtime, 100, "REPEAT");
    expect(runtime.snapshot().instances.map(i => i.repeatOrdinal)).toEqual([1, 2]);
    runtime.advanceTo(519); expect(runtime.snapshot().instances[1].imageResult).toBeUndefined();
    runtime.advanceTo(520); expect(runtime.snapshot().instances[1].imageResult).toBeDefined();
    runtime.advanceTo(600); expect(runtime.snapshot().instances[0].imageResult).toEqual(image);
    expect(runtime.snapshot().instances[1].result).toBeUndefined();
    runtime.advanceTo(700); expect(runtime.snapshot().instances[1].result).toBeDefined();
  });

  test.each([-1, NaN, Infinity, 601])("invalid image delay %p fails closed", imageDelaySeconds => {
    const runtime = new ImagingWorkflowRuntime();
    expect(() => order(runtime, 0, "BAD", { imageDelaySeconds })).toThrow("IMAGING_DEFINITION_SCOPE_DENIED");
    expect(runtime.snapshot().instances).toEqual([]);
  });

  test("staging requires an image; equal image/report deadlines are supported", () => {
    const runtime = new ImagingWorkflowRuntime();
    expect(() => order(runtime, 0, "NO-IMAGE", { asset: undefined })).toThrow("IMAGING_DEFINITION_SCOPE_DENIED");
    order(runtime, 0, "EQUAL", { imageDelaySeconds: 600 });
    runtime.advanceTo(599); expect(runtime.snapshot().instances[0].imageResult).toBeUndefined();
    runtime.advanceTo(600); expect(runtime.snapshot().instances[0].imageResult).toBeDefined();
    expect(runtime.snapshot().instances[0].result).toBeDefined();
  });

  test("schema 2 combined image/report behavior remains unchanged and roundtrips exactly", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime, 0, "LEGACY", { imageDelaySeconds: undefined });
    expect(runtime.snapshot().schemaVersion).toBe(2);
    runtime.advanceTo(599); expect(runtime.snapshot().instances[0].imageResult).toBeUndefined();
    runtime.advanceTo(600); const saved = runtime.snapshot();
    expect(saved.instances[0].result).toMatchObject({ asset: DEMO_HEAD_CT_ASSET, reportText: "REPORT AT TEN" });
    expect(saved.instances[0].imageResult).toBeUndefined();
    const restored = new ImagingWorkflowRuntime(); restored.restore(saved); expect(restored.snapshot()).toEqual(saved);
  });

  test.each(["early-image", "wrong-patient", "wrong-image", "report-in-image", "schema-downgrade", "missing-image", "early-report"])(
    "rejects malformed checkpoint: %s", kind => {
      const runtime = new ImagingWorkflowRuntime(); order(runtime); runtime.advanceTo(600);
      const snapshot = structuredClone(runtime.snapshot()) as any;
      const item = snapshot.instances[0];
      if (kind === "early-image") item.imageResult.releasedAtSimulationTimeSec = 419;
      if (kind === "wrong-patient") item.imageResult.patientId = "OTHER";
      if (kind === "wrong-image") item.imageResult.asset = { ...DEMO_HEAD_CT_ASSET, sha256: "0".repeat(64) };
      if (kind === "report-in-image") item.imageResult.reportText = "SECRET";
      if (kind === "schema-downgrade") snapshot.schemaVersion = 2;
      if (kind === "missing-image") delete item.imageResult;
      if (kind === "early-report") item.result.releasedAtSimulationTimeSec = 599;
      expect(() => new ImagingWorkflowRuntime().restore(snapshot as ImagingWorkflowSnapshot)).toThrow(/IMAGING_INVALID/);
    });
});
