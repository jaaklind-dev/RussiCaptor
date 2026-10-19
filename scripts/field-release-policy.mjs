import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import acceptanceProfile from "./canonical-acceptance-profile.cjs";

export const PRODUCTION_PROJECT_REF = "fimcsrivizpliiuoqopv";
export const EMBEDDED_EVIDENCE_PATH = "assets/russicaptor-build-evidence.json";
export const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(`FIELD_RELEASE_POLICY: ${message}`); };

export function buildPlan(descriptor, env, explicitMode) {
  const mode = explicitMode ?? env.RUSSICAPTOR_RELEASE_VARIANT ?? "canonical";
  if (explicitMode && env.RUSSICAPTOR_RELEASE_VARIANT && env.RUSSICAPTOR_RELEASE_VARIANT !== explicitMode) fail("conflicting build modes");
  if (!["canonical", "predeployment-candidate", "upgrade-validation", "rollback-validation"].includes(mode)) fail("unknown build mode");
  const candidate = mode === "predeployment-candidate";
  const validation = mode === "upgrade-validation" || mode === "rollback-validation";
  const override = env.RUSSICAPTOR_RELEASE_VERSION_CODE;
  if (!validation && override) fail("canonical/candidate versionCode cannot be overridden");
  const versionCode = override ? Number(override) : descriptor.versionCode;
  if (!Number.isInteger(versionCode) || versionCode < descriptor.versionCode || (validation && versionCode <= descriptor.versionCode)) fail("versionCode must be monotonic; validation requires a higher versionCode");
  const harness = env.RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS === "1";
  if (!validation && harness) fail("canonical/candidate cannot include a validation harness");
  return {
    mode, versionCode, sharedWorkflowValidationHarness: validation && harness,
    artifactFilename: mode === "canonical" ? descriptor.artifactFilename
      : `RussiCaptor-${descriptor.applicationVersion}-${versionCode}-${mode}.apk`,
    outputDirectory: candidate ? "dist/predeployment-candidate" : "dist/field-release",
    manifestFilename: candidate ? "predeployment-candidate-manifest.json" : "release-manifest.json",
  };
}

// The existing protected operator/CI ledger input is evidence, not a live query.
// Validate its structure and target; never substitute local/scratch migrations.
export function productionCompatibility(required, env) {
  const raw = env.RUSSICAPTOR_DEPLOYED_MIGRATIONS;
  if (env.RUSSICAPTOR_MIGRATION_PROJECT_REF && env.RUSSICAPTOR_MIGRATION_PROJECT_REF !== PRODUCTION_PROJECT_REF) fail("wrong production migration evidence target");
  const versions = raw ? raw.split(",").map(value => value.trim()) : [];
  if (versions.length && (versions.some(version => !/^\d{12,14}$/.test(version)) || new Set(versions).size !== versions.length)) fail("invalid production migration evidence");
  if (versions.length && env.RUSSICAPTOR_MIGRATION_PROJECT_REF !== PRODUCTION_PROJECT_REF) fail("production migration evidence target is missing or wrong");
  const available = versions.length > 0;
  const missing = available ? required.filter(version => !versions.includes(version)) : [];
  return {
    status: available && !missing.length ? "PASS" : "BLOCKED",
    evidenceStatus: available ? "AVAILABLE" : "UNAVAILABLE",
    projectRef: available ? PRODUCTION_PROJECT_REF : null,
    evidenceSource: available ? "operator-or-protected-CI-ledger-input" : null,
    deployedVersions: versions,
    missingRequiredMigrations: missing,
    unverifiedRequiredMigrations: available ? [] : [...required],
  };
}

export function requireProductionCompatibility(evidence) {
  if (evidence?.status !== "PASS" || evidence.evidenceStatus !== "AVAILABLE"
    || evidence.projectRef !== PRODUCTION_PROJECT_REF || !evidence.deployedVersions?.length
    || evidence.missingRequiredMigrations?.length !== 0 || evidence.unverifiedRequiredMigrations?.length !== 0) {
    fail(evidence?.missingRequiredMigrations?.length
      ? `required remote migration ${evidence.missingRequiredMigrations[0]} is not deployed`
      : "verified remote migration list is required");
  }
}

export function localMigrationIntegrity(root, descriptor) {
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const directory = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".sql")).sort();
  const tracked = git(["ls-files", "--", "supabase/migrations"]).split("\n");
  const versions = new Set();
  const migrations = files.map(filename => {
    const version = /^(\d{12,14})_[a-z0-9_]+\.sql$/.exec(filename)?.[1];
    if (!version || versions.has(version)) fail("invalid or duplicate local migration version");
    versions.add(version);
    const relative = `supabase/migrations/${filename}`;
    if (!tracked.includes(relative) || git(["hash-object", relative]) !== git(["rev-parse", `HEAD:${relative}`])) fail(`local migration is not identical to committed source: ${filename}`);
    return { version, filename, sha256: sha256(fs.readFileSync(path.join(directory, filename))) };
  });
  if (tracked.length !== files.length) fail("local migration set differs from tracked history");
  for (const required of descriptor.requiredSupabaseMigrations) {
    if (!migrations.some(item => item.filename === required.localFile && item.version === required.remoteVersion)) fail("required migration identity mismatch");
  }
  return { status: "PASS", count: migrations.length, sha256: sha256(JSON.stringify(migrations)), migrations };
}

export function buildEvidence(descriptor, plan, compatibility, integrity, provenance) {
  if (integrity?.status !== "PASS" || !/^[a-f0-9]{64}$/.test(integrity.sha256 ?? "")) fail("local migration integrity is required");
  if (!/^[a-f0-9]{40}$/.test(provenance.gitSha ?? "")) fail("source commit is required");
  if (typeof provenance.sourceDirty !== "boolean" || !Number.isFinite(Date.parse(provenance.buildTimestamp))) fail("source cleanliness and build timestamp are required");
  // Recompute from the actual ledger, never trust an editable PASS flag.
  const checked = productionCompatibility(descriptor.requiredSupabaseMigrations.map(item => item.remoteVersion), {
    RUSSICAPTOR_DEPLOYED_MIGRATIONS: compatibility?.deployedVersions?.join(","),
    RUSSICAPTOR_MIGRATION_PROJECT_REF: compatibility?.projectRef,
  });
  if (JSON.stringify(checked) !== JSON.stringify(compatibility)) fail("inconsistent migration verification result");
  if (plan.mode !== "predeployment-candidate") requireProductionCompatibility(checked);
  return {
    evidenceSchemaVersion: 1, releaseVariant: plan.mode,
    packageId: descriptor.packageId, applicationVersion: descriptor.applicationVersion,
    versionCode: plan.versionCode, artifactFilename: plan.artifactFilename,
    gitSha: provenance.gitSha, buildTimestamp: provenance.buildTimestamp, sourceDirty: provenance.sourceDirty,
    sharedWorkflowValidationHarness: plan.sharedWorkflowValidationHarness,
    acceptanceBundleProfile: acceptanceProfile.evidence(fileURLToPath(new URL('../', import.meta.url)), plan.mode),
    localMigrationIntegrity: integrity,
    productionCompatibility: checked.status,
    productionMigrationEvidence: checked,
    missingProductionMigrations: checked.missingRequiredMigrations,
    distributable: plan.mode === "canonical" && provenance.sourceDirty === false && checked.status === "PASS",
    publicationAuthorization: "NOT_GRANTED", automaticPublication: false,
    promotionPolicy: "CANONICAL_REBUILD_REQUIRED",
  };
}

export function verifyArtifactEvidence(descriptor, metadata, embedded, actual, requireCanonical = false) {
  // Signed APK contents, not the sidecar, own build mode and compatibility.
  const plan = buildPlan(descriptor, {
    RUSSICAPTOR_RELEASE_VARIANT: embedded.releaseVariant,
    ...(embedded.versionCode !== descriptor.versionCode ? { RUSSICAPTOR_RELEASE_VERSION_CODE: String(embedded.versionCode) } : {}),
    RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS: embedded.sharedWorkflowValidationHarness ? "1" : "0",
  });
  const expected = buildEvidence(descriptor, plan, embedded.productionMigrationEvidence, embedded.localMigrationIntegrity, embedded);
  if (JSON.stringify(expected) !== JSON.stringify(embedded)) fail("invalid signed build evidence");
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(metadata[key]) !== JSON.stringify(value)) fail(`manifest disagrees with signed APK: ${key}`);
  }
  if (!actual.signatureVerified || actual.signingCertificateSha256 !== descriptor.signingCertificateSha256) fail("APK signature/production signer mismatch");
  if (actual.packageId !== expected.packageId || actual.versionCode !== expected.versionCode || actual.applicationVersion !== expected.applicationVersion) fail("APK package/version metadata mismatch");
  if (actual.debuggable || actual.devOverlay) fail("APK contains development configuration");
  if (metadata.signingCertificateSha256 !== actual.signingCertificateSha256 || metadata.artifactSha256 !== actual.artifactSha256
    || metadata.artifactSizeBytes !== actual.artifactSizeBytes || metadata.buildValidity !== "PASS"
    || metadata.signingVerification !== "PASS" || metadata.packageVersionIdentity !== "PASS" || metadata.debuggable !== false) fail("artifact verification metadata mismatch");
  if (JSON.stringify(metadata.verifiedSupabaseMigrations) !== JSON.stringify(expected.productionMigrationEvidence.deployedVersions)) fail("manifest migration list disagrees with signed APK");
  if (requireCanonical && (expected.releaseVariant !== "canonical" || !expected.distributable)) fail("canonical rebuild required; candidate cannot be promoted using metadata");
  return expected;
}
