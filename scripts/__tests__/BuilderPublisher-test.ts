import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const packageId = "russicaptor.builder-picker-test153";
const version = "1.0.0";
const packageHash = "993ec01c571c158afc9f8715520887dd83dacaac535efd5d3f7cde0f7488129c";
const imageSha = "a4e030697a7571b3e95d31860e4da55d2f98e5e861e2b55e414f45a8556828ba";
const imageAssetId = "russicaptor.builder-picker-test153.img-001.img-001.v1";
const publication = path.join(root, "assets/builder/published", packageId, version);
const source = path.join(publication, "source.json");
const evidence = path.join(publication, "publication.json");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const run = (directory: string, script: string, args: string[] = []) => spawnSync(process.execPath,
  [path.join(directory, "scripts", script), ...args], { cwd: directory, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
function sandbox() {
  const directory = mkdtempSync(path.join(tmpdir(), "russicaptor-builder-publish-test-"));
  for (const item of ["src", "scripts", "assets"]) cpSync(path.join(root, item), path.join(directory, item), { recursive: true });
  symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"));
  return directory;
}
function withCorruption(file: string, contents: Buffer | string, assertion: () => void) {
  const original = readFileSync(file);
  try { writeFileSync(file, contents); assertion(); }
  finally { writeFileSync(file, original); }
}

describe("explicit Builder package publication", () => {
  test("BUILDER-PUBLISH-01 draft-only source is not runtime-published", () => {
    const index = JSON.parse(readFileSync(path.join(root, "assets/builder/published/index.json"), "utf8"));
    expect(index.packages).toHaveLength(1);
    expect(index.packages.some((item: { packageId: string }) => item.packageId === "russicaptor.unpublished-draft")).toBe(false);
  });

  test("BUILDER-PUBLISH-02 validated source export does not publish automatically", () => {
    const directory = sandbox();
    try {
      const input = JSON.parse(readFileSync(source, "utf8"));
      input.draft.packageId = "russicaptor.validated-unpublished-fixture";
      input.draft.studies = [];
      input.images = [];
      const exported = path.join(directory, "validated-source.json");
      writeFileSync(exported, JSON.stringify(input));
      expect(run(directory, "builder-validate.mjs", [exported]).status).toBe(0);
      expect(readFileSync(path.join(directory, "assets/builder/published/index.json"), "utf8"))
        .not.toContain(input.draft.packageId);
      expect(readFileSync(path.join(directory, "src/services/builder/BuilderCompiledPackages.generated.ts"), "utf8"))
        .not.toContain(input.draft.packageId);
      expect(run(directory, "builder-verify-published.mjs").status).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  test("BUILDER-PUBLISH-03 explicit promotion records exact immutable identity", () => {
    const record = JSON.parse(readFileSync(evidence, "utf8"));
    expect(record).toMatchObject({ validation: "PASS", packageId, packageVersion: version, packageHash });
    expect(record.sourceSha256).toBe(digest(readFileSync(source)));
  });

  test("BUILDER-PUBLISH-04 published package is in the runtime registry", () => {
    const registry = readFileSync(path.join(root, "src/services/builder/BuilderCompiledPackages.generated.ts"), "utf8");
    expect(registry).toContain(packageId);
    expect(run(root, "builder-verify-published.mjs", ["--require", `${packageId}@${version}`]).status).toBe(0);
  });

  test("BUILDER-PUBLISH-05 imaging asset is in static require registry", () => {
    const registry = readFileSync(path.join(root, "src/services/imaging/ImagingBundledAssetRegistry.generated.ts"), "utf8");
    expect(registry).toContain(imageAssetId);
    expect(registry).toContain("require(");
  });

  test("BUILDER-PUBLISH-06 identical republish is idempotent", () => {
    const directory = sandbox();
    try {
      const before = readFileSync(path.join(directory, "assets/builder/compiled-packages.json"));
      const result = run(directory, "builder-publish.mjs", [path.join(directory, "assets/builder/published", packageId, version, "source.json")]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("IDEMPOTENT");
      expect(readFileSync(path.join(directory, "assets/builder/compiled-packages.json"))).toEqual(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  test("BUILDER-PUBLISH-07 same ID/version with changed content is rejected", () => {
    const directory = sandbox();
    try {
      const input = JSON.parse(readFileSync(source, "utf8"));
      input.draft.name = "Different immutable content";
      const altered = path.join(directory, "altered-source.json");
      writeFileSync(altered, JSON.stringify(input));
      const result = run(directory, "builder-publish.mjs", [altered]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("BUILDER_PUBLISH_IMMUTABLE_VERSION_CONFLICT");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  test("BUILDER-PUBLISH-08 clean copied checkout verifies package without temporary authoring directory", () => {
    const directory = sandbox();
    try { expect(run(directory, "builder-verify-published.mjs").status).toBe(0); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  test("BUILDER-PUBLISH-09 clean copied checkout verifies image registry", () => {
    const directory = sandbox();
    try {
      expect(run(directory, "builder-verify-published.mjs").stdout).toContain("assets=2");
      expect(readFileSync(path.join(directory, "src/services/imaging/ImagingBundledAssetRegistry.generated.ts"), "utf8"))
        .toContain("img-001.v1.png");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  test("BUILDER-PUBLISH-10 package hash is unchanged", () => {
    const compiled = JSON.parse(readFileSync(path.join(root, "assets/builder/compiled-packages.json"), "utf8"));
    expect(compiled.packages[0].exercisePackage.packageHash).toBe(packageHash);
    expect(JSON.parse(readFileSync(evidence, "utf8")).packageHash).toBe(packageHash);
  });

  test("BUILDER-PUBLISH-11 published asset bytes retain their SHA-256", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "assets/imaging/manifest.json"), "utf8"));
    const asset = manifest.assets.find((item: { assetId: string }) => item.assetId === imageAssetId);
    expect(asset.sha256).toBe(imageSha);
    expect(digest(readFileSync(path.join(root, "assets/imaging", asset.resolverKey)))).toBe(imageSha);
  });

  test("BUILDER-PUBLISH-12 runtime build verifier needs no Google Drive", () => {
    const directory = sandbox();
    try {
      const result = run(directory, "builder-verify-published.mjs");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("BUILDER_PUBLISHED_VERIFIED");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  test("BUILDER-PUBLISH-13 runtime build verifier needs no device draft storage", () => {
    const directory = sandbox();
    try {
      expect(run(directory, "builder-verify-published.mjs").status).toBe(0);
      expect(readFileSync(path.join(directory, "assets/builder/published/index.json"), "utf8")).toContain(packageId);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  test("BUILDER-PUBLISH-14 build fails early when indexed package is missing", () => {
    const directory = sandbox();
    try {
      const manifestPath = path.join(directory, "assets/builder/compiled-packages.json");
      withCorruption(manifestPath, '{"schemaVersion":1,"packages":[]}', () => {
        const result = run(directory, "builder-verify-published.mjs");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("BUILDER_PUBLISHED_SET_MISMATCH");
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);
});
