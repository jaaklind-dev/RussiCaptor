import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "test/runtime-regression-guardrails.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requestedGroup = process.argv[2] ?? "all";
const groups = manifest.groups;

if (requestedGroup !== "all" && !Object.hasOwn(groups, requestedGroup)) {
  console.error(`Unknown Runtime guardrail group: ${requestedGroup}`);
  console.error(`Choose one of: all, ${Object.keys(groups).join(", ")}`);
  process.exit(2);
}

const selectedGroups = requestedGroup === "all" ? Object.values(groups) : [groups[requestedGroup]];
const testFiles = [...new Set(selectedGroups.flat())];
const missingFiles = testFiles.filter(file => !existsSync(resolve(root, file)));
if (missingFiles.length > 0) {
  console.error(`Runtime guardrail manifest references missing tests:\n${missingFiles.join("\n")}`);
  process.exit(2);
}

const jestBin = resolve(root, "node_modules/jest/bin/jest.js");
if (!existsSync(jestBin)) {
  console.error("Jest is not installed. Run the repository dependency installation first.");
  process.exit(2);
}

const result = spawnSync(process.execPath,
  [jestBin, "--runInBand", "--runTestsByPath", ...testFiles],
  { cwd: root, stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
