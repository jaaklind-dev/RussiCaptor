import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { summarizeFidelity, sha256File } = require("./lib/narva-source-fidelity-core.cjs");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "test/narva-source-fidelity.manifest.json"), "utf8"));
for (const source of [manifest.sources.originalWorkbook, manifest.sources.canonicalWorkbook]) {
  if (sha256File(resolve(root, source.path)) !== source.fileSha256) {
    console.error(`Narva source artifact drift: ${source.path}`);
    process.exit(1);
  }
}
const verification = readFileSync(resolve(root, manifest.sources.canonicalWorkbook.verificationPath), "utf8");
if (!verification.includes(manifest.sources.canonicalWorkbook.semanticSha256)) {
  console.error("Narva canonical semantic checksum is absent from verification output.");
  process.exit(1);
}
const jest = spawnSync(process.execPath, [resolve(root, "node_modules/jest/bin/jest.js"), "--runInBand",
  "--runTestsByPath", "src/services/exercise/__tests__/NarvaSourceFidelity-test.ts"],
{ cwd: root, stdio: "inherit" });
if (jest.status !== 0) process.exit(jest.status ?? 1);
const summary = summarizeFidelity(manifest.items.map(item => ({ ...item, drift: null })));
console.log(`Narva source fidelity: ${summary.total} mapped items`);
for (const [classification, count] of Object.entries(summary.counts)) console.log(`${classification}: ${count}`);
for (const item of summary.nonMatch.filter(item => !item.vitalRow)) {
  console.log(`${item.classification} ${item.id}: ${item.rationale}`);
}
const p02Bleeding = manifest.items.find(item => item.id === "p02.continuing-bleeding");
const historical = p02Bleeding.authorityChain.find(record => record.status === "SUPERSEDED");
const current = p02Bleeding.authorityChain.find(record => record.authorityId === p02Bleeding.currentAuthorityId);
console.log("P02 continuing hemorrhage");
console.log(`historical source: ~${historical.semanticValue.mlPerHour} ml/h`);
console.log(`current authority: ${current.semanticValue.mlPerHour} ml/h`);
console.log(`production: ${p02Bleeding.productionValue.mlPerHour} ml/h`);
console.log(`classification: ${p02Bleeding.classification}`);
console.log("status: PASS");
const vitalRows = manifest.items.filter(item => item.vitalRow);
const vitalCounts = { MATCH: 0, EXPECTED_OBSERVATION: 0, SOURCE_CHECKPOINT: 0 };
for (const item of vitalRows) vitalCounts[item.vitalRow.semanticCategory] += 1;
console.log("Narva scripted vitals");
console.log(`total scripted vital rows: ${vitalRows.length}`);
console.log(`MATCH: ${vitalCounts.MATCH}`);
console.log(`EXPECTED_OBSERVATION: ${vitalCounts.EXPECTED_OBSERVATION}`);
console.log(`SOURCE_CHECKPOINT: ${vitalCounts.SOURCE_CHECKPOINT}`);
console.log(`exact-runtime-target later rows: ${vitalRows.filter(item =>
  item.vitalRow.minute > 0 && item.vitalRow.exactRuntimeTarget).length}`);
console.log(`scripted overrides: ${manifest.scriptedVitalsPolicy.scriptedOverrides ? 1 : 0}`);
