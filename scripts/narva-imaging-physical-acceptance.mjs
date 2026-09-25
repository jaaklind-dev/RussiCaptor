#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_NARVA_IMAGING, TARGET_MIGRATION, assertNarvaPackageContent, assertPreThreshold,
  assertRepeatedAdvancement, assertRestartEvidence, assertThresholdRelease, finalClassification,
  inspectMigrationState,
} from "./lib/narva-imaging-physical-acceptance-core.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((item, index, all) => item.startsWith("--")
  ? [item.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1] ?? true] : ["", ""]));
const mode = args.get("mode") ?? "prepare";
const output = path.resolve(root, String(args.get("output") ?? "artifacts/narva-imaging-physical-acceptance.json"));
const run = (command, commandArgs) => {
  try { return execFileSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { return ""; }
};
const record = { schemaVersion: 1, mode, generatedAt: new Date().toISOString(), secretMaterialRecorded: false,
  target: EXPECTED_NARVA_IMAGING, migration: TARGET_MIGRATION,
  evidenceFields: ["exerciseId", "packageId", "packageVersion", "patientId", "definitionId", "commandId",
    "imagingInstanceId", "writerRuntimeId", "leaseId", "canonicalRevisions", "orderedAtSimulationTimeSec",
    "availableAtSimulationTimeSec", "preThreshold", "releasedAtSimulationTimeSec", "resultCount",
    "reportComparison", "restartState", "duplicateCount", "writerCount", "assignmentIds", "migrationStatus",
    "cleanupStatus"], phases: [] };
const phase = (name, status, evidence) => record.phases.push({ name, status, evidence });

const head = run("git", ["rev-parse", "HEAD"]);
const status = run("git", ["status", "--porcelain"]);
const migrationPath = path.join(root, "supabase/migrations", TARGET_MIGRATION.file);
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
const migrationSha256 = migration ? createHash("sha256").update(migration).digest("hex") : undefined;
const migrationValid = migration.includes("'IMAGING_ORDER'")
  && migration.includes("submit_runtime_patient_command")
  && migration.includes("grant execute on function public.submit_runtime_patient_command")
  && !migration.includes("authorization_role_assignments");
const packageSource = [
  fs.readFileSync(path.join(root, "src/services/exercise/NarvaTraumaImagingDefinitions.ts"), "utf8"),
  fs.readFileSync(path.join(root, "src/services/exercise/NarvaExercisePackages.ts"), "utf8"),
].join("\n");
const packageValid = [EXPECTED_NARVA_IMAGING.packageId, EXPECTED_NARVA_IMAGING.patientId,
  EXPECTED_NARVA_IMAGING.definitionId, EXPECTED_NARVA_IMAGING.report, "delayMinutes: 7"]
  .every(value => packageSource.includes(String(value)));
phase("PRECHECK", head && status === "" && migrationValid && packageValid ? "PASS" : "BLOCKED",
  { head, clean: status === "", migrationArtifact: TARGET_MIGRATION.file, migrationSha256, migrationValid, packageValid });

if (mode === "prepare") {
  phase("MIGRATION_PLAN", "PASS", { deployed: false, deploymentPerformed: false,
    rule: "Deploy only when the linked ledger proves this is the sole pending migration.",
    supportedCommand: "npx supabase db push --linked" });
  phase("PHYSICAL_EXECUTION", "DEFERRED", { reason: "DEFERRED_NO_PHYSICAL_DEVICE", mutationPerformed: false });
} else if (mode === "verify-evidence") {
  const evidencePath = args.get("evidence");
  if (!evidencePath) throw new Error("--evidence <path> is required");
  const evidence = JSON.parse(fs.readFileSync(path.resolve(root, String(evidencePath)), "utf8"));
  const assertions = [
    assertNarvaPackageContent(evidence.packageDefinitions ?? []),
    assertPreThreshold(evidence.preThreshold ?? {}),
    assertThresholdRelease(evidence.resulted ?? {}),
    assertRepeatedAdvancement(evidence.resulted ?? {}, evidence.afterRepeatedAdvance ?? {}),
    assertRestartEvidence(evidence.resulted ?? {}, evidence.afterColdRestart ?? {}),
  ];
  phase("ASSERTIONS", finalClassification(assertions), { assertions });
} else if (mode === "physical-precheck") {
  const serial = String(args.get("device") ?? "");
  const deviceLine = run("adb", ["devices", "-l"]).split("\n").find(line => line.startsWith(`${serial} `));
  const keychainAvailable = run("security", ["find-generic-password", "-a", "russicaptor-supabase-service-role",
    "-s", "RussiCaptor-Supabase-ServiceRole-fimcsrivizpliiuoqopv"]) !== "";
  phase("PHYSICAL_PRECHECK", deviceLine?.includes(" device ") && keychainAvailable ? "PASS" : "BLOCKED",
    { serial, deviceState: deviceLine?.includes(" device ") ? "device" : "unavailable",
      keychainCredentialAvailable: keychainAvailable, supabaseProjectRef: "fimcsrivizpliiuoqopv",
      warning: "No secret value was read or recorded by this precheck." });
  phase("NEXT", "BLOCKED", { instruction: "Complete normal UI exercise creation and collect the evidence template; do not mutate operational rows." });
} else {
  throw new Error(`Unsupported --mode ${mode}`);
}

record.finalStatus = finalClassification(record.phases);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, finalStatus: record.finalStatus, phases: record.phases.map(item => ({ name: item.name, status: item.status })) }, null, 2));
process.exitCode = record.finalStatus === "FAIL" ? 1 : record.finalStatus === "BLOCKED" && mode !== "prepare" ? 2 : 0;

// Migration state is deliberately exported through the core module and tested;
// this preparation entry point never calls the deployment command.
void inspectMigrationState;
