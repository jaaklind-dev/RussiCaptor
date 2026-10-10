import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";
import { DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { EXERCISE_DEFINITION_CATALOG } from "@/services/exercise/ExerciseDefinitionService";
import { ExercisePackageLoader } from "@/services/exercise/ExercisePackageLoader";
import { ExercisePackageRegistry } from "@/services/exercise/ExercisePackageRegistry";
import { ExercisePackageValidator } from "@/services/exercise/ExercisePackageValidator";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageRegistry, exercisePackageValidator } from "@/services/exercise/ExercisePackageService";
import { createImagingAuthoredPackage, loadImagingAuthoredPackageRecipes,
  type ImagingAuthoredPackageRecipe } from "@/services/imaging/ImagingAuthoredPackageLoader";
import { DEMO_HEAD_CT_ASSET } from "@/services/imaging/ImagingAssetRegistry";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";

const core = require("../lib/imaging-author-core.cjs") as {
  authorPackage(root: string, input: Record<string, unknown>, context: AuthoringContext,
    options?: { dryRun?: boolean; afterIngest?: () => void; validateAfterWrite?: () => void }): Record<string, unknown>;
  planAuthoring(root: string, input: Record<string, unknown>, context: AuthoringContext): {
    authored: { packageHash: string; imagingConfiguration: { definitions: readonly Record<string, unknown>[] } };
  };
};
type AuthoringContext = {
  registry: { get(id: string, version: string): any };
  validator: { assertValid(value: unknown): void };
  datasets: { resolve(id: string): any };
  createImagingAuthoredPackage(base: any, recipe: any, asset: any): any;
};

const projectRoot = process.cwd();
const runtimeContext: AuthoringContext = {
  registry: exercisePackageRegistry,
  validator: exercisePackageValidator,
  datasets: packagePatientDatasetRegistry,
  createImagingAuthoredPackage,
};
function jpeg(width = 3, height = 2): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,height >> 8,height & 255,width >> 8,width & 255,
    0x03,0x01,0x11,0x00,0x02,0x11,0x00,0x03,0x11,0x00,0xff,0xd9]);
}
function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "russicaptor-imaging-author-"));
  mkdirSync(path.join(root, "assets/imaging"), { recursive: true });
  mkdirSync(path.join(root, "src/services/imaging"), { recursive: true });
  copyFileSync(path.join(projectRoot, "assets/imaging/image01.jpg"), path.join(root, "assets/imaging/image01.jpg"));
  cpSync(path.join(projectRoot, "assets/imaging/packages"), path.join(root, "assets/imaging/packages"), { recursive: true });
  for (const relative of ["assets/imaging/manifest.json", "assets/imaging/package-authoring-manifest.json",
    "src/services/imaging/ImagingBundledAssetRegistry.generated.ts",
    "src/services/imaging/ImagingAuthoredPackageVersions.generated.ts"]) {
    copyFileSync(path.join(projectRoot, relative), path.join(root, relative));
  }
  return root;
}
function source(root: string, name = "fixture.jpg", bytes = jpeg()): string {
  const file = path.join(root, name); writeFileSync(file, bytes); return file;
}
function input(root: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { sourcePath: source(root), packageId: "russicaptor.botulism-johvi", baseVersion: "2.0.0",
    newVersion: "2.0.1", patientId: "P09", definitionId: "P09-CXR", logicalName: "author-fixture",
    role: "PRIMARY_DIAGNOSTIC_IMAGE", ...extra };
}
function files(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (directory: string) => readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else result[path.relative(root, target)] = readFileSync(target).toString("base64");
  });
  walk(root); return result;
}

describe("IMAGING-AUTHORING-UX-01 / IMG-AUTH-G01..G16", () => {
  test("G01/G02/G10-G13 creates a valid new package version and preserves base clinical semantics", () => {
    const root = workspace(); const request = input(root);
    const base = runtimeContext.registry.get(request.packageId as string, request.baseVersion as string) as ExercisePackage;
    const before = JSON.stringify(base); const plan = core.planAuthoring(root, request, runtimeContext);
    const result = core.authorPackage(root, request, runtimeContext, { validateAfterWrite: () => undefined });
    expect(result).toMatchObject({ status: "AUTHORED", operation: "ADD", packageId: request.packageId,
      baseVersion: "2.0.0", newVersion: "2.0.1", patientId: "P09", definitionId: "P09-CXR",
      studyHadAsset: false, provenancePresent: false, licenseMetadataPresent: false });
    expect(JSON.stringify(base)).toBe(before);
    expect(plan.authored.packageHash).toBe(result.packageHash);
    const oldDefinition = base.imagingConfiguration!.definitions.find(item => item.study.id === "P09-CXR")!;
    const newDefinition = (plan.authored as ExercisePackage).imagingConfiguration!.definitions
      .find(item => item.study.id === "P09-CXR")!;
    const { asset: _asset, ...newStudy } = newDefinition.study;
    expect(newStudy).toEqual(oldDefinition.study);
    expect(newDefinition.order).toEqual(oldDefinition.order);
  });

  test("G03 dry-run reports exact changes and writes nothing", () => {
    const root = workspace(); const request = input(root); const before = files(root);
    const result = core.authorPackage(root, request, runtimeContext, { dryRun: true });
    expect(result).toMatchObject({ status: "DRY_RUN", operation: "ADD", files: expect.arrayContaining([
      "assets/imaging/manifest.json", "assets/imaging/package-authoring-manifest.json",
      "src/services/imaging/ImagingBundledAssetRegistry.generated.ts",
      "src/services/imaging/ImagingAuthoredPackageVersions.generated.ts",
    ]) });
    expect(files(root)).toEqual(before);
  });

  test.each([
    [{ packageId: "missing.package" }, "IMAGING_AUTHOR_BASE_PACKAGE_NOT_FOUND"],
    [{ patientId: "P11" }, "IMAGING_AUTHOR_DEFINITION_PATIENT_MISMATCH"],
    [{ definitionId: "MISSING-CXR" }, "IMAGING_AUTHOR_DEFINITION_NOT_FOUND"],
  ])("G04-G06 rejects an invalid exact target before writing", (change, error) => {
    const root = workspace(); const request = input(root, change); const before = files(root);
    expect(() => core.authorPackage(root, request, runtimeContext)).toThrow(error);
    expect(files(root)).toEqual(before);
  });

  test("G07 rejects an existing proposed package version", () => {
    const root = workspace(); const request = input(root); const context = {
      ...runtimeContext, registry: { get: (id: string, version: string) => version === "2.0.1"
        ? { packageId: id, packageVersion: version } : runtimeContext.registry.get(id, version) },
    } as AuthoringContext;
    expect(() => core.authorPackage(root, request, context)).toThrow("IMAGING_AUTHOR_NEW_VERSION_EXISTS");
  });

  test("G08 replacement creates a later package and a new immutable asset identity", () => {
    const root = workspace(); const firstInput = input(root);
    const firstPlan = core.planAuthoring(root, firstInput, runtimeContext);
    core.authorPackage(root, firstInput, runtimeContext, { validateAfterWrite: () => undefined });
    const overlayContext = { ...runtimeContext, validator: { assertValid: () => undefined }, registry: {
      get: (id: string, version: string) => id === "russicaptor.botulism-johvi" && version === "2.0.1"
        ? firstPlan.authored : runtimeContext.registry.get(id, version),
    } } as AuthoringContext;
    const replacementSource = source(root, "replacement.jpg", jpeg(4, 2));
    const result = core.authorPackage(root, { ...firstInput, sourcePath: replacementSource, baseVersion: "2.0.1",
      newVersion: "2.0.2", assetVersion: 2 }, overlayContext, { validateAfterWrite: () => undefined });
    expect(result).toMatchObject({ status: "AUTHORED", operation: "REPLACE", studyHadAsset: true,
      previousAssetId: "russicaptor.botulism-johvi.p09-cxr.author-fixture.v1",
      assetId: "russicaptor.botulism-johvi.p09-cxr.author-fixture.v2" });
  });

  test("G08 refuses replacement when the immutable asset identity is reused", () => {
    const root = workspace(); const firstInput = input(root);
    const firstPlan = core.planAuthoring(root, firstInput, runtimeContext);
    core.authorPackage(root, firstInput, runtimeContext, { validateAfterWrite: () => undefined });
    const overlayContext = { ...runtimeContext, validator: { assertValid: () => undefined }, registry: {
      get: (id: string, version: string) => id === "russicaptor.botulism-johvi" && version === "2.0.1"
        ? firstPlan.authored : runtimeContext.registry.get(id, version),
    } } as AuthoringContext;
    const before = files(root);
    expect(() => core.authorPackage(root, { ...firstInput, baseVersion: "2.0.1", newVersion: "2.0.2" },
      overlayContext)).toThrow("IMMUTABLE_ASSET_COLLISION");
    expect(files(root)).toEqual(before);
  });

  test("G09 rolls back asset, manifests and generated registries after a controlled partial failure", () => {
    const root = workspace(); const request = input(root); const before = files(root);
    expect(() => core.authorPackage(root, request, runtimeContext, { afterIngest: () => {
      throw new Error("CONTROLLED_FAILURE");
    } })).toThrow("CONTROLLED_FAILURE");
    expect(files(root)).toEqual(before);
    expect(existsSync(path.join(root, "assets/imaging/packages/russicaptor.botulism-johvi"))).toBe(false);
  });

  test("G14/G15 preserves provenance and bounded JSON-safe output without raw bytes", () => {
    const root = workspace(); const result = core.authorPackage(root, input(root, {
      sourceUrl: "https://institution.example/fixture", contributor: "Exercise author",
      licenseId: "INSTITUTION-OWNED", licenseUrl: "https://institution.example/license",
      attribution: "Institution fixture", modificationNote: "Unmodified",
    }), runtimeContext, { dryRun: true });
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({ provenancePresent: true, licenseMetadataPresent: true });
    expect(serialized).not.toMatch(/base64|data:image|\/9j\//i);
    expect(serialized.length).toBeLessThan(5000);
  });

  test("G16 generated recipe loads through the normal package loader", () => {
    const validator = new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG);
    const registry = new ExercisePackageRegistry(validator);
    const base = createExercisePackage({
      packageId: "russicaptor.demo", packageVersion: "0.9.0", definition: DEFAULT_EXERCISE_PACKAGE.definition,
      patientDatasetId: DEFAULT_EXERCISE_PACKAGE.patientDatasetId,
      enabledPatientProcesses: DEFAULT_EXERCISE_PACKAGE.enabledPatientProcesses,
      enabledAnalyticsProviders: DEFAULT_EXERCISE_PACKAGE.enabledAnalyticsProviders,
      enabledMetricProviders: DEFAULT_EXERCISE_PACKAGE.enabledMetricProviders,
      metadata: DEFAULT_EXERCISE_PACKAGE.metadata,
      imagingConfiguration: { schemaVersion: 1, definitions: [{ study: { id: "IMG-001", patientId: "PT-001",
        modality: "CT", title: "Fixture CT", report: "Fixture report", status: "processing",
        imageVisibility: "hidden", reportVisibility: "hidden" }, order: { id: "IMG-ORD-001", title: "Fixture CT",
        status: "available", visibility: "revealed", workflow: { resultAction: "imaging.available",
          resultTargetId: "IMG-001", delayMinutes: 1, resultTitle: "Fixture CT available",
          resultDescription: "Fixture CT is ready." } } }] },
    });
    registry.register(base);
    const recipeBase = { packageId: "russicaptor.demo", baseVersion: "0.9.0", basePackageHash: base.packageHash,
      newVersion: "1.0.0", patientId: "PT-001", definitionId: "IMG-001",
      assetId: DEMO_HEAD_CT_ASSET.assetId, expectedPackageHash: "" };
    const authored = createImagingAuthoredPackage(base, recipeBase, DEMO_HEAD_CT_ASSET);
    const recipe: ImagingAuthoredPackageRecipe = { ...recipeBase, expectedPackageHash: authored.packageHash };
    const packageLoader = new ExercisePackageLoader(validator, registry);
    expect(loadImagingAuthoredPackageRecipes([recipe], packageLoader, registry)).toEqual([authored]);
    expect(registry.require("russicaptor.demo", "1.0.0").packageHash).toBe(authored.packageHash);
  });
});
