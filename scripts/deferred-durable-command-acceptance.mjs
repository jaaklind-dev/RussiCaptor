#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import core from "./lib/deferred-durable-command-acceptance-core.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const values = process.argv.slice(2); const args = new Map();
for (let i = 0; i < values.length; i += 1) if (values[i].startsWith("--")) {
  const key = values[i].slice(2); const next = values[i + 1];
  args.set(key, next && !next.startsWith("--") ? (i += 1, next) : true);
}
const mode = String(args.get("mode") ?? "prepare");
const output = path.resolve(root, String(args.get("output") ??
  "artifacts/deferred-durable-command-acceptance.json"));
const run = (command, commandArgs) => {
  try { return execFileSync(command, commandArgs, { cwd: root, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { return ""; }
};
const localFiles = fs.readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
const ledgerPath = path.resolve(root, String(args.get("ledger") ??
  "test/fixtures/deferred-durable-command-remote-ledger-20260926.json"));
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const migrations = core.validateMigrationArtifacts(root);
const ledgerAnalysis = core.analyzeLedger({ remoteMigrations: ledger.migrations, localMigrationFiles: localFiles });
const report = { schemaVersion: 1, mode, generatedAt: new Date().toISOString(), projectRef: core.PROJECT_REF,
  secretMaterialRecorded: false, migrationDeploymentPerformed: false, migrations, ledgerAnalysis,
  gateOrder: core.PHYSICAL_GATES, phases: [] };
const phase = (name, status, evidence) => report.phases.push({ name, status, evidence });

if (mode === "prepare") {
  const head = run("git", ["rev-parse", "HEAD"]); const clean = run("git", ["status", "--porcelain"]) === "";
  phase("SOURCE", head && clean ? "PASS" : "BLOCKED", { head, clean });
  phase("MIGRATION_STATIC", migrations.every(item => item.validation.status === "PASS") ? "PASS" : "FAIL",
    { files: migrations.map(item => ({ file: item.file, sha256: item.actualSha256,
      commandType: item.commandType, status: item.validation.status })) });
  phase("MIGRATION_LEDGER", ledgerAnalysis.status, ledgerAnalysis);
  phase("DEPLOYMENT", "DEFERRED", { deployed: false,
    path: "Supabase apply_migration connector, one exact verified artifact at a time; never db push for this ledger." });
  phase("PHYSICAL_EXECUTION", "DEFERRED", { reason: "DEFERRED_NO_PHYSICAL_DEVICE" });
} else if (mode === "physical-precheck") {
  const serial = String(args.get("device") ?? ""); const apk = String(args.get("apk") ?? "");
  const expectedHead = String(args.get("expected-head") ?? "");
  const expectedApkSha = String(args.get("apk-sha256") ?? "").toLowerCase();
  const expectedVersionCode = String(args.get("version-code") ?? "");
  const head = run("git", ["rev-parse", "HEAD"]); const clean = run("git", ["status", "--porcelain"]) === "";
  const deviceState = run("adb", ["-s", serial, "get-state"]); const apkPath = path.resolve(apk);
  const apkSha256 = apk !== "" && fs.existsSync(apkPath)
    ? createHash("sha256").update(fs.readFileSync(apkPath)).digest("hex") : "";
  const packageDump = deviceState === "device" ? run("adb", ["-s", serial, "shell", "dumpsys", "package",
    "com.jaaklind.RussiCaptor"]) : "";
  const installedVersionCode = packageDump.match(/versionCode=(\d+)/)?.[1] ?? "";
  const apkMatches = expectedApkSha !== "" && apkSha256 === expectedApkSha
    && expectedVersionCode !== "" && installedVersionCode === expectedVersionCode;
  const backendStatePath = String(args.get("backend-state") ?? "");
  const backendState = backendStatePath && fs.existsSync(path.resolve(root, backendStatePath))
    ? JSON.parse(fs.readFileSync(path.resolve(root, backendStatePath), "utf8")) : undefined;
  const keychainItemPresent = run("security", ["find-generic-password", "-a",
    "russicaptor-supabase-service-role", "-s",
    "RussiCaptor-Supabase-ServiceRole-fimcsrivizpliiuoqopv"]) !== "";
  const precheck = core.evaluatePrecheck({ head, expectedHead, clean, projectRef: core.PROJECT_REF,
    keychainItemPresent, ledgerStatus: ledgerAnalysis.status, deviceState, apkMatches,
    backendStateVerified: backendState?.projectRef === core.PROJECT_REF,
    activeAssignmentConflict: backendState?.activeAssignmentConflict !== false,
    activeBootstrapCount: backendState?.activeBootstrapCount,
    globalAssignmentCount: backendState?.globalAssignmentCount,
    writerCount: backendState?.writerCount ?? Number.POSITIVE_INFINITY,
    unexpectedActiveLease: backendState?.unexpectedActiveLease !== false,
    packageAvailable: backendState?.packageAvailable === true });
  phase("PHYSICAL_PRECHECK", precheck.status, { ...precheck, serial, deviceState,
    keychainItemPresent, apkSha256, expectedApkSha, installedVersionCode, expectedVersionCode,
    backendStateVerified: backendState?.projectRef === core.PROJECT_REF,
    warning: "Credential value was not read; backend-state must come from supported read-only APIs." });
} else if (mode === "verify-evidence") {
  const evidencePath = path.resolve(root, String(args.get("evidence") ?? ""));
  if (!args.get("evidence") || !fs.existsSync(evidencePath)) throw new Error("--evidence <path> is required");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const safety = core.validateEvidenceSafety(evidence);
  const sequence = core.evaluateCombinedEvidence(evidence);
  phase("EVIDENCE_SAFETY", safety.status, safety); phase("GATES", sequence.finalStatus, sequence);
} else if (mode === "evidence-template") {
  Object.assign(report, { evidence: core.evidenceTemplate() });
  phase("TEMPLATE", "PASS", { fileMode: "0600", secretMaterialRecorded: false });
} else throw new Error(`Unsupported --mode ${mode}`);

report.finalStatus = report.phases.some(item => item.status === "FAIL") ? "FAIL"
  : report.phases.some(item => item.status === "BLOCKED") ? "BLOCKED"
    : report.phases.every(item => item.status === "PASS" || item.status === "DEFERRED") ? "PASS" : "PENDING";
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); fs.chmodSync(output, 0o600);
console.log(JSON.stringify({ output, finalStatus: report.finalStatus,
  phases: report.phases.map(item => ({ name: item.name, status: item.status })) }, null, 2));
process.exitCode = report.finalStatus === "FAIL" ? 1 : report.finalStatus === "BLOCKED" ? 2 : 0;
