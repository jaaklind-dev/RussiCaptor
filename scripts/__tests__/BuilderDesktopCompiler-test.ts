import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ExerciseBuilderDraft } from "@/models/builder/ExerciseBuilderDraft";
import { newBuilderDraft, serializeBuilderSourceBundle } from "@/services/builder/ExerciseBuilderService";

const projectRoot = process.cwd();
function sandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), "russicaptor-builder-compiler-"));
  for (const part of ["src", "scripts", "assets"]) cpSync(path.join(projectRoot, part), path.join(root, part), { recursive: true });
  symlinkSync(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"));
  return root;
}
function jpeg(): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x00,0x02,0x00,0x03,
    0x03,0x01,0x11,0x00,0x02,0x11,0x00,0x03,0x11,0x00,0xff,0xd9]);
}
function draft(packageId: string, extension: "jpg" | "png"): ExerciseBuilderDraft {
  return { ...newBuilderDraft(), packageId, name: "Compiler test", description: "Local test fixture", author: "Test",
    patients: [{ id: "PT-001", name: "Patsient", triage: "P2", location: "ED", handover: "Test",
      vitals: { hr: 100, sbp: 90 }, labs: { LAB_CRP: 22 } }],
    studies: [{ id: "IMG-001", patientId: "PT-001", modality: "XR", title: "Test image",
      report: "Report", resultDelaySeconds: 420,
      image: { localUri: "", fileName: `image.${extension}`, source: "LOCAL_TEST", licenseId: "TEST",
        contributor: "Test owner" } }],
  };
}
function compile(root: string, source: string) {
  return spawnSync(process.execPath, [path.join(root, "scripts/builder-compile.mjs"), source],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

describe("Builder desktop packaging bridge", () => {
  test.each(["jpg", "png"] as const)("%s source becomes immutable package with existing static resolver", extension => {
    const root = sandbox();
    const packageId = `russicaptor.builder-${extension}-test`;
    const image = extension === "jpg" ? jpeg() : readFileSync(path.join(root, "assets/images/favicon.png"));
    const source = path.join(root, "source.json");
    writeFileSync(source, serializeBuilderSourceBundle({ schemaVersion: 1, draft: draft(packageId, extension),
      images: [{ studyId: "IMG-001", fileName: `image.${extension}`, base64: image.toString("base64") }] }));
    const result = compile(root, source);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/packageHash=[0-9a-f]{64}/);
    const generated = readFileSync(path.join(root, "src/services/imaging/ImagingBundledAssetRegistry.generated.ts"), "utf8");
    expect(generated).toContain("require(");
    expect(generated).toContain(`builder-${extension}-test`);
    const compiled = readFileSync(path.join(root, "src/services/builder/BuilderCompiledPackages.generated.ts"), "utf8");
    expect(compiled).toContain(packageId);
    const duplicate = compile(root, source);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("BUILDER_IMMUTABLE_VERSION_EXISTS");
    expect(readFileSync(path.join(root, "src/services/builder/BuilderCompiledPackages.generated.ts"), "utf8"))
      .toBe(compiled);
  }, 60_000);

  test("blank contributor source compiles identically in two isolated checkouts", () => {
    const packageId = "russicaptor.builder-optional-contributor-test";
    const sourceBundle = serializeBuilderSourceBundle({ schemaVersion: 1,
      draft: { ...draft(packageId, "jpg"), studies: [{ ...draft(packageId, "jpg").studies[0],
        image: { ...draft(packageId, "jpg").studies[0].image!, contributor: "   " } }] },
      images: [{ studyId: "IMG-001", fileName: "image.jpg", base64: jpeg().toString("base64") }] });
    const outputs = [sandbox(), sandbox()].map(root => {
      const source = path.join(root, "source.json"); writeFileSync(source, sourceBundle);
      const result = compile(root, source);
      expect(result.status).toBe(0);
      const manifest = JSON.parse(readFileSync(path.join(root, "assets/imaging/manifest.json"), "utf8")) as {
        assets: { provenance?: Record<string, unknown> }[] };
      expect(manifest.assets.at(-1)?.provenance).toMatchObject({ sourceUrl: "LOCAL_TEST", licenseId: "TEST" });
      expect(manifest.assets.at(-1)?.provenance).not.toHaveProperty("contributor");
      return result.stdout.match(/packageHash=[0-9a-f]{64}|datasetHash=[0-9a-f]{64}/g);
    });
    expect(outputs[0]).toEqual(outputs[1]);
  }, 120_000);
});
