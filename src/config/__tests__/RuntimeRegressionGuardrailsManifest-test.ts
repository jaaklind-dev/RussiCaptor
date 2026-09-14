import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type GuardrailManifest = Readonly<{
  schemaVersion: number;
  document: string;
  runner: string;
  guardrails: readonly Readonly<{ id: string; name: string; tests: readonly string[] }>[];
  groups: Readonly<Record<string, readonly string[]>>;
  historicalFailures: readonly Readonly<{
    id: string;
    failure: string;
    invariant: string;
    tests: readonly string[];
    physicalGate: string;
  }>[];
}>;

const root = resolve(__dirname, "../../..");
const manifestPath = resolve(root, "test/runtime-regression-guardrails.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GuardrailManifest;
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const alphabet = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

describe("RussiCaptor Runtime Regression Guardrails manifest", () => {
  test("keeps the complete A-Z guardrail catalog and all historical blockers mapped", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.guardrails.map(guardrail => guardrail.id)).toEqual(alphabet);
    expect(manifest.guardrails.every(guardrail => guardrail.name.length > 0 && guardrail.tests.length > 0)).toBe(true);
    expect(manifest.historicalFailures.map(failure => failure.id))
      .toEqual(Array.from({ length: 16 }, (_, index) => `H${String(index + 1).padStart(2, "0")}`));
    expect(manifest.historicalFailures.every(failure => failure.invariant.length > 0 &&
      failure.tests.length > 0 && failure.physicalGate.length > 0)).toBe(true);
  });

  test("fails when a canonical document, runner or executable regression disappears", () => {
    const referencedPaths = new Set([
      manifest.document,
      manifest.runner,
      ...manifest.guardrails.flatMap(guardrail => guardrail.tests),
      ...Object.values(manifest.groups).flat(),
      ...manifest.historicalFailures.flatMap(failure => failure.tests),
    ]);
    expect([...referencedPaths].filter(file => !existsSync(resolve(root, file)))).toEqual([]);
  });

  test("exposes stable grouped commands through the manifest-backed runner", () => {
    expect(Object.keys(manifest.groups).sort()).toEqual(["multi-device", "persistence", "runtime"]);
    expect(Object.values(manifest.groups).every(files => files.length > 0)).toBe(true);
    expect(packageJson.scripts).toMatchObject({
      "test:guardrails": "node scripts/run-runtime-guardrails.mjs all",
      "test:runtime-guardrails": "node scripts/run-runtime-guardrails.mjs runtime",
      "test:multi-device-guardrails": "node scripts/run-runtime-guardrails.mjs multi-device",
      "test:persistence-guardrails": "node scripts/run-runtime-guardrails.mjs persistence",
    });
  });

  test("keeps the mandatory policy, checklist, impact matrix and frozen IRO hashes repository-visible", () => {
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    expect(document).toContain("All RussiCaptor Runtime Regression Guardrails are mandatory acceptance gates");
    expect(document).toContain("## Mandatory feature checklist");
    expect(document).toContain("## Feature impact classification");
    expect(document).toContain("## Historical blocker mapping");
    expect(document).toContain("da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95");
    expect(document).toContain("6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0");
  });
});
