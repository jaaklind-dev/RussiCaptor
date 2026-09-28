import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ImagingOrderDefinitionSnapshot } from "@/models/ImagingWorkflow";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { NARVA_TRAUMA_P02_IMAGING_SOURCE } from "@/services/exercise/NarvaTraumaImagingDefinitions";
import { exercisePackageValidator } from "@/services/exercise/ExercisePackageService";
import {
  DEMO_HEAD_CT_ASSET, classifyLegacyImagingAttachment, resolveImagingAsset,
  validateImagingAssetReference,
} from "@/services/imaging/ImagingAssetRegistry";
import { sha256Text } from "@/utils/sha256";
import { ImagingWorkflowRuntime } from "../ImagingWorkflowRuntime";

const definition = (asset = DEMO_HEAD_CT_ASSET): ImagingOrderDefinitionSnapshot => ({
  definitionId: "IMG-001", patientId: "PT-001", title: "KT pea", modality: "CT",
  reportSource: "Ägeda intrakraniaalse verejooksu tunnuseid ei ole.", asset, delaySeconds: 60,
  packageId: "russicaptor.demo", packageVersion: "1.0.0", packageHash: "demo-hash",
});
const order = (runtime: ImagingWorkflowRuntime, commandId = "CMD-1", asset = DEMO_HEAD_CT_ASSET) => runtime.order({
  commandId, exerciseId: "EX-I4", patientId: "PT-001", orderedBy: "CM",
  orderedAtSimulationTimeSec: 0, definition: definition(asset),
});

describe("I4 immutable Imaging report/asset contract / IMG-G35..IMG-G45", () => {
  test("I4-A1 supports Narva P02 report-only result with complete immutable provenance", () => {
    const runtime = new ImagingWorkflowRuntime();
    runtime.order({ commandId: "CMD-P02", exerciseId: "EX-NARVA", patientId: "PT-CHEST-001", orderedBy: "CM",
      orderedAtSimulationTimeSec: 10, definition: { definitionId: "P02-CXR", patientId: "PT-CHEST-001",
        title: "Rindkere röntgen", modality: "XR", reportSource: NARVA_TRAUMA_P02_IMAGING_SOURCE.report,
        delaySeconds: 420, packageId: NARVA_TRAUMA_EXERCISE_PACKAGE.packageId,
        packageVersion: NARVA_TRAUMA_EXERCISE_PACKAGE.packageVersion,
        packageHash: NARVA_TRAUMA_EXERCISE_PACKAGE.packageHash } });
    expect(runtime.advanceTo(430)[0].result).toEqual({ resultId: "IMAGING_RESULT:IMAGING:CMD-P02",
      imagingInstanceId: "IMAGING:CMD-P02", patientId: "PT-CHEST-001", definitionId: "P02-CXR",
      packageId: "russicaptor.narva-trauma", packageVersion: NARVA_TRAUMA_EXERCISE_PACKAGE.packageVersion,
      packageHash: NARVA_TRAUMA_EXERCISE_PACKAGE.packageHash,
      reportText: NARVA_TRAUMA_P02_IMAGING_SOURCE.report,
      authoredReportSha256: sha256Text(NARVA_TRAUMA_P02_IMAGING_SOURCE.report), releasedAtSimulationTimeSec: 430 });
  });

  test("I4-A2 bundled demo asset has stable semantic identity, verified bytes and a working resolver", () => {
    const bytes = readFileSync(path.join(process.cwd(), "assets/imaging/image01.jpg"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(DEMO_HEAD_CT_ASSET.sha256);
    expect(bytes.byteLength).toBe(DEMO_HEAD_CT_ASSET.byteLength);
    expect(resolveImagingAsset(DEMO_HEAD_CT_ASSET)).toMatchObject({ status: "RESOLVED",
      asset: { assetId: "demo.head-ct.image01.v1", resolverKey: "image01.jpg", mediaType: "image/jpeg",
        width: 606, height: 606, packageVersion: "1.0.0", patientId: "PT-001" } });
  });

  test("I4-A3/A4 rejects hash mismatch and resolves missing registry keys safely", () => {
    expect(() => validateImagingAssetReference({ ...DEMO_HEAD_CT_ASSET, sha256: "0".repeat(64) }))
      .toThrow("IMAGING_ASSET_INTEGRITY_MISMATCH");
    expect(resolveImagingAsset({ ...DEMO_HEAD_CT_ASSET, assetId: "missing" }))
      .toEqual({ status: "MISSING_REGISTRY_KEY", detail: "missing" });
  });

  test("I4-A5/A6 hides result before release and freezes authored report and asset at order time", () => {
    const source = definition(); const runtime = new ImagingWorkflowRuntime();
    runtime.order({ commandId: "CMD-FREEZE", exerciseId: "EX-I4", patientId: "PT-001", orderedBy: "CM",
      orderedAtSimulationTimeSec: 0, definition: source });
    runtime.advanceTo(59); expect(runtime.snapshot().instances[0].result).toBeUndefined();
    (source as { reportSource: string; asset: typeof DEMO_HEAD_CT_ASSET }).reportSource = "changed";
    (source as { asset: typeof DEMO_HEAD_CT_ASSET }).asset = { ...DEMO_HEAD_CT_ASSET, assetId: "changed" };
    runtime.advanceTo(60);
    expect(runtime.snapshot().instances[0].result).toMatchObject({ reportText: definition().reportSource,
      asset: DEMO_HEAD_CT_ASSET });
  });

  test("I4-A7/A8 checkpoint restore and takeover preserve identical result metadata", () => {
    const writer = new ImagingWorkflowRuntime(); order(writer); writer.advanceTo(60);
    const checkpoint = writer.snapshot(); const takeover = new ImagingWorkflowRuntime(); takeover.restore(checkpoint);
    expect(takeover.snapshot()).toEqual(checkpoint); expect(takeover.advanceTo(600)).toEqual([]);
  });

  test("I4-A9 repeats share immutable source asset but retain distinct result identities", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime, "CMD-1"); runtime.advanceTo(60);
    order(runtime, "CMD-2"); runtime.advanceTo(60);
    expect(runtime.snapshot().instances.map(item => item.result?.resultId))
      .toEqual(["IMAGING_RESULT:IMAGING:CMD-1", "IMAGING_RESULT:IMAGING:CMD-2"]);
    expect(runtime.snapshot().instances.map(item => item.result?.asset?.assetId))
      .toEqual([DEMO_HEAD_CT_ASSET.assetId, DEMO_HEAD_CT_ASSET.assetId]);
  });

  test("I4-A10 package validation rejects asset provenance leakage", () => {
    const pkg = structuredClone(NARVA_TRAUMA_EXERCISE_PACKAGE);
    const definitions = pkg.imagingConfiguration!.definitions as unknown as {
      study: { asset?: typeof DEMO_HEAD_CT_ASSET };
    }[];
    definitions[0].study.asset = DEMO_HEAD_CT_ASSET;
    expect(exercisePackageValidator.validate(pkg).map(issue => issue.code)).toContain("INVALID_IMAGING_CONFIGURATION");
  });

  test("I4-A11 external workbook paths and URLs remain explicitly unresolved", () => {
    for (const value of ["/Volumes/PACS/study.jpg", "https://example.test/study.jpg", "OneDrive/study.jpg"]) {
      expect(classifyLegacyImagingAttachment(value)).toEqual({ status: "UNRESOLVED_LEGACY_ATTACHMENT", detail: value });
    }
  });

  test("legacy schema-1 attachment is adapted once at restore into the canonical asset contract", () => {
    const runtime = new ImagingWorkflowRuntime();
    runtime.restore({ schemaVersion: 1, instances: [{ imagingInstanceId: "IMAGING:LEGACY",
      orderCommandId: "LEGACY", exerciseId: "EX-I4", patientId: "PT-001", definitionId: "IMG-001",
      packageId: "russicaptor.demo", packageVersion: "1.0.0", packageHash: "demo-hash", title: "KT pea",
      modality: "CT", orderedBy: "CM", orderedAtSimulationTimeSec: 0, availableAtSimulationTimeSec: 60,
      repeatOrdinal: 1, status: "RESULTED", authoredSource: { report: "Legacy", attachment: "image01.jpg" },
      result: { report: "Legacy", attachment: "image01.jpg", releasedAtSimulationTimeSec: 60 } }] } as never);
    expect(runtime.snapshot()).toMatchObject({ schemaVersion: 2, instances: [{ authoredSource: {
      reportText: "Legacy", asset: DEMO_HEAD_CT_ASSET }, result: { reportText: "Legacy", asset: DEMO_HEAD_CT_ASSET } }] });
    expect(JSON.stringify(runtime.snapshot())).not.toContain('"attachment"');
  });

  test("pre-ingest schema-2 demo references remain compatible without weakening new package provenance", () => {
    const { packageVersion: _packageVersion, patientId: _patientId, width: _width, height: _height,
      ...legacyDemo } = DEMO_HEAD_CT_ASSET;
    expect(() => validateImagingAssetReference(legacyDemo)).not.toThrow();
    expect(resolveImagingAsset(legacyDemo)).toMatchObject({ status: "RESOLVED" });
  });

  test("legacy checkpoint with unregistered attachment fails closed instead of trusting the path", () => {
    const runtime = new ImagingWorkflowRuntime();
    expect(() => runtime.restore({ schemaVersion: 1, instances: [{ imagingInstanceId: "IMAGING:BAD",
      orderCommandId: "BAD", exerciseId: "EX-I4", patientId: "PT-001", definitionId: "IMG-001",
      packageId: "russicaptor.demo", packageVersion: "1", packageHash: "hash", title: "KT pea",
      modality: "CT", orderedBy: "CM", orderedAtSimulationTimeSec: 0, availableAtSimulationTimeSec: 60,
      repeatOrdinal: 1, status: "ORDERED", authoredSource: { report: "Legacy", attachment: "https://bad" } }] } as never))
      .toThrow("IMAGING_UNRESOLVED_LEGACY_ATTACHMENT");
  });

  test("I4-A12 canonical checkpoint contains references, never binary image bytes", () => {
    const runtime = new ImagingWorkflowRuntime(); order(runtime); runtime.advanceTo(60);
    const serialized = JSON.stringify(runtime.snapshot());
    expect(serialized).toContain(DEMO_HEAD_CT_ASSET.sha256);
    expect(serialized).not.toMatch(/data:image|\/9j\/|base64/i);
    expect(serialized.length).toBeLessThan(5_000);
  });

  test("I4-A13 reader restores identical metadata and cannot generate or mutate it locally", () => {
    const writer = new ImagingWorkflowRuntime(); order(writer); writer.advanceTo(60);
    const reader = new ImagingWorkflowRuntime(() => false); reader.restore(writer.snapshot());
    expect(reader.snapshot()).toEqual(writer.snapshot());
    expect(reader.advanceTo(600)).toEqual([]);
    expect(() => order(reader, "CMD-READER")).toThrow("IMAGING_WRITER_REQUIRED");
  });
});
