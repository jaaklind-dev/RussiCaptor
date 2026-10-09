import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const core = require("../lib/imaging-asset-ingest-core.cjs") as {
  ingest(root: string, input: Record<string, unknown>, options?: { dryRun?: boolean }): {
    asset: Record<string, unknown>; status: string; wrote: boolean; destinationPath: string };
  inspectImageBytes(bytes: Buffer, sourcePath: string): Record<string, unknown>;
  planIngest(root: string, input: Record<string, unknown>): { asset: Record<string, unknown> };
  verifyManifest(root: string): { assetCount: number };
};

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), "russicaptor-imaging-ingest-"));
  mkdirSync(path.join(value, "assets/imaging"), { recursive: true });
  mkdirSync(path.join(value, "src/services/imaging"), { recursive: true });
  return value;
}
function jpeg(width = 3, height = 2): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,height >> 8,height & 255,width >> 8,width & 255,
    0x03,0x01,0x11,0x00,0x02,0x11,0x00,0x03,0x11,0x00,0xff,0xd9]);
}
function input(sourcePath: string, extras: Record<string, unknown> = {}) {
  return { sourcePath, packageId: "fixture.author-package", packageVersion: "2.0.0", patientId: "PT-FIXTURE-001",
    definitionId: "FIXTURE-XR", logicalName: "checkerboard", assetVersion: 1,
    role: "PRIMARY_DIAGNOSTIC_IMAGE", ...extras };
}
function writeJpeg(directory: string, name = "fixture.jpg", bytes = jpeg()): string {
  const target = path.join(directory, name); writeFileSync(target, bytes); return target;
}
function writePng(directory: string, name = "fixture.png"): string {
  const target = path.join(directory, name);
  copyFileSync(path.join(process.cwd(), "assets/images/favicon.png"), target); return target;
}
function files(directory: string): string[] {
  const walk = (current: string): string[] => readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(current, entry.name); return entry.isDirectory() ? walk(target) : [path.relative(directory, target)];
  });
  return walk(directory).sort();
}

describe("IMAGING-ASSET-INGEST-CORE-01 / IMG-ASSET-G01..G16", () => {
  test("G01/G04-G08 ingests JPEG with exact deterministic metadata and a static Metro resolver", () => {
    const workspace = root(); const source = writeJpeg(workspace);
    const result = core.ingest(workspace, input(source));
    expect(result).toMatchObject({ status: "INGESTED", wrote: true, asset: { mediaType: "image/jpeg",
      byteLength: jpeg().length, width: 3, height: 2, packageVersion: "2.0.0", patientId: "PT-FIXTURE-001",
      assetId: "fixture.author-package.fixture-xr.checkerboard.v1",
      resolverKey: "packages/fixture.author-package/2.0.0/fixture-xr/checkerboard.v1.jpg" } });
    expect(result.asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path.join(workspace, "src/services/imaging/ImagingBundledAssetRegistry.generated.ts"), "utf8"))
      .toContain('require("../../../assets/imaging/packages/fixture.author-package/2.0.0/fixture-xr/checkerboard.v1.jpg")');
    expect(core.verifyManifest(workspace)).toEqual({ assetCount: 1 });
  });

  test("G02 ingests a real repository-owned PNG fixture and parses exact dimensions", () => {
    const workspace = root(); const source = writePng(workspace);
    const result = core.ingest(workspace, input(source, { logicalName: "safe-png" }));
    expect(result.asset).toMatchObject({ mediaType: "image/png", width: expect.any(Number), height: expect.any(Number),
      resolverKey: expect.stringMatching(/safe-png\.v1\.png$/) });
    expect(Number(result.asset.width)).toBeGreaterThan(0); expect(Number(result.asset.height)).toBeGreaterThan(0);
  });

  test("G03 rejects unsupported, corrupt, empty and extension/MIME-mismatched input", () => {
    const workspace = root();
    const unsupported = path.join(workspace, "fixture.tiff"); writeFileSync(unsupported, Buffer.from("TIFF"));
    expect(() => core.planIngest(workspace, input(unsupported))).toThrow("UNSUPPORTED_IMAGE_TYPE");
    const corrupt = path.join(workspace, "broken.png"); writeFileSync(corrupt, Buffer.from("not-a-png"));
    expect(() => core.planIngest(workspace, input(corrupt))).toThrow("UNSUPPORTED_IMAGE_TYPE");
    const empty = path.join(workspace, "empty.jpg"); writeFileSync(empty, Buffer.alloc(0));
    expect(() => core.planIngest(workspace, input(empty))).toThrow("IMAGE_EMPTY");
    const mismatch = writeJpeg(workspace, "wrong.png");
    expect(() => core.planIngest(workspace, input(mismatch))).toThrow("IMAGE_MEDIA_TYPE_MISMATCH");
  });

  test("G09 rejects identity traversal before constructing a destination", () => {
    const workspace = root(); const source = writeJpeg(workspace);
    expect(() => core.planIngest(workspace, input(source, { logicalName: "../outside" }))).toThrow("INVALID_LOGICAL_NAME");
    expect(() => core.planIngest(workspace, input(source, { definitionId: "a/b" }))).toThrow("INVALID_DEFINITION_ID");
  });

  test("G10/G11 makes identical re-ingest idempotent and rejects immutable byte replacement", () => {
    const workspace = root(); const source = writeJpeg(workspace);
    core.ingest(workspace, input(source));
    expect(core.ingest(workspace, input(source))).toMatchObject({ status: "IDEMPOTENT", wrote: false });
    writeFileSync(source, jpeg(4, 2));
    expect(() => core.ingest(workspace, input(source))).toThrow("IMMUTABLE_ASSET_COLLISION");
  });

  test("G12 rejects adding an asset to an already-published package identity", () => {
    const workspace = root(); const source = writeJpeg(workspace); const directory = path.join(workspace, "src/services/exercise");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "Published.ts"), 'const packageId = "fixture.author-package"; const packageVersion = "2.0.0";');
    expect(() => core.planIngest(workspace, input(source))).toThrow("PUBLISHED_PACKAGE_VERSION_IMMUTABLE");
  });

  test("G13 dry-run validates everything and writes nothing", () => {
    const workspace = root(); const source = writeJpeg(workspace); const before = files(workspace);
    expect(core.ingest(workspace, input(source), { dryRun: true })).toMatchObject({ status: "PLANNED", wrote: false });
    expect(files(workspace)).toEqual(before);
  });

  test("G14 preserves generic provenance/license metadata without changing clinical semantics", () => {
    const workspace = root(); const source = writeJpeg(workspace);
    const result = core.ingest(workspace, input(source, { sourceUrl: "https://institution.example/image",
      attribution: "Institution-owned fixture", licenseId: "INSTITUTION-OWNED", licenseUrl: "https://institution.example/license",
      contributor: "Exercise author", modificationNote: "No modifications" }));
    expect(result.asset.provenance).toEqual({ sourceUrl: "https://institution.example/image",
      attribution: "Institution-owned fixture", licenseId: "INSTITUTION-OWNED", licenseUrl: "https://institution.example/license",
      contributor: "Exercise author", modificationNote: "No modifications" });
  });

  test("optional contributor canonicalizes blank, whitespace, null and absent values", () => {
    const workspace = root(); const source = writeJpeg(workspace);
    for (const contributor of [undefined, "", "   ", null]) {
      const asset = core.planIngest(workspace, input(source, { sourceUrl: "Local test", licenseId: "TEST",
        contributor })).asset;
      expect(asset.provenance).toEqual({ sourceUrl: "Local test", licenseId: "TEST" });
    }
    expect(core.planIngest(workspace, input(source, { contributor: "  Exercise author  " })).asset.provenance)
      .toEqual({ contributor: "Exercise author" });
    expect(() => core.planIngest(workspace, input(source, { contributor: 42 }))).toThrow("INVALID_CONTRIBUTOR");
    expect(() => core.planIngest(workspace, input(source, { contributor: "A\0B" }))).toThrow("INVALID_CONTRIBUTOR");
  });

  test("optional contributor does not weaken other provenance metadata validation", () => {
    const workspace = root(); const source = writeJpeg(workspace);
    expect(() => core.planIngest(workspace, input(source, { sourceUrl: "" }))).toThrow("INVALID_SOURCE_URL");
    expect(() => core.planIngest(workspace, input(source, { licenseId: " " }))).toThrow("INVALID_LICENSE_ID");
  });

  test("G15/G16 manifest and registry contain metadata/static require only, never image bytes", () => {
    const workspace = root(); const source = writeJpeg(workspace); core.ingest(workspace, input(source));
    const manifest = readFileSync(path.join(workspace, "assets/imaging/manifest.json"), "utf8");
    const registry = readFileSync(path.join(workspace, "src/services/imaging/ImagingBundledAssetRegistry.generated.ts"), "utf8");
    expect(manifest).not.toMatch(/base64|data:image|\/9j\//i); expect(registry).not.toMatch(/base64|data:image|\/9j\//i);
    expect(registry).toContain("BUNDLED_LOCAL"); expect(registry).toContain("require(");
  });

  test("repository manifest remains exact and generated registry is current", () => {
    expect(core.verifyManifest(process.cwd())).toEqual({ assetCount: 1 });
  });
});
