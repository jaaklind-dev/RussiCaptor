import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const descriptor = JSON.parse(fs.readFileSync(path.join(root, "release/field-release.json"), "utf8"));
const required = descriptor.requiredSupabaseMigrations.map((item: { remoteVersion: string }) => item.remoteVersion);
const project = "fimcsrivizpliiuoqopv";
const missingVersion = "20261016065854";
const complete = { RUSSICAPTOR_MIGRATION_PROJECT_REF: project, RUSSICAPTOR_DEPLOYED_MIGRATIONS: required.join(",") };
const missing = { ...complete, RUSSICAPTOR_DEPLOYED_MIGRATIONS: required.filter((version: string) => version !== missingVersion).join(",") };
const invoke = (expression: string, values: unknown = {}) => spawnSync(process.execPath, ["--input-type=module", "-e", `
  import * as policy from './scripts/field-release-policy.mjs';
  const input = JSON.parse(process.argv[1]);
  console.log(JSON.stringify(${expression}));
`, JSON.stringify(values)], { cwd: root, encoding: "utf8" });
const evaluate = (expression: string, values: unknown = {}) => {
  const result = invoke(expression, values);
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
};
const config = (mode: string, evidence: Record<string, string> = {}) => spawnSync(process.execPath,
  ["scripts/verify-field-release-config.mjs", `--mode=${mode}`, "--json"], {
    cwd: root, encoding: "utf8", env: { ...process.env,
      RUSSICAPTOR_RELEASE_VARIANT: mode, RUSSICAPTOR_RELEASE_VERSION_CODE: "",
      RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS: "0",
      RUSSICAPTOR_DEPLOYED_MIGRATIONS: "", RUSSICAPTOR_MIGRATION_PROJECT_REF: "",
      ...evidence,
    },
  });

function evidenceFixture(mode: string, env: Record<string, string>) {
  return evaluate(`(() => {
    const plan = policy.buildPlan(input.descriptor, { RUSSICAPTOR_RELEASE_VARIANT: input.mode });
    const compatibility = policy.productionCompatibility(input.required, input.env);
    const integrity = policy.localMigrationIntegrity(process.cwd(), input.descriptor);
    return policy.buildEvidence(input.descriptor, plan, compatibility, integrity,
      { gitSha: 'a'.repeat(40), buildTimestamp: '2026-10-16T12:00:00.000Z', sourceDirty: false });
  })()`, { descriptor, required, mode, env });
}

describe("safe predeployment candidate and fail-closed canonical release", () => {
  test("canonical complete migration evidence passes and validates 53 committed migrations", () => {
    const result = config("canonical", complete);
    expect(result.status).toBe(0);
    const verified = JSON.parse(result.stdout);
    expect(verified.compatibility.status).toBe("PASS");
    expect(verified.integrity).toMatchObject({ status: "PASS", count: 53 });
  });

  test("canonical missing migrations fails before compilation", () => {
    const result = config("canonical", missing);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`required remote migration ${missingVersion} is not deployed`);
  });

  test.each(["0", "false", "", "1"])("legacy remote-required env=%s cannot bypass canonical gate", flag => {
    expect(config("canonical", { RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS: flag }).status).not.toBe(0);
    expect(config("canonical", { ...missing, RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS: flag }).status).not.toBe(0);
  });

  test("real build entry point cannot bypass canonical preflight with an environment flag", () => {
    const result = spawnSync(process.execPath, ["scripts/build-field-release.mjs", "--mode=canonical"], {
      cwd: root, encoding: "utf8", env: { ...process.env,
        RUSSICAPTOR_RELEASE_VARIANT: "canonical", RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS: "0",
        RUSSICAPTOR_DEPLOYED_MIGRATIONS: "", RUSSICAPTOR_MIGRATION_PROJECT_REF: "",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("verified remote migration list is required");
    expect(result.stdout).not.toContain("FIELD_RELEASE_ARTIFACT=");
  });

  test("candidate missing migrations records BLOCKED and exact missing version", () => {
    const result = config("predeployment-candidate", missing);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).compatibility).toMatchObject({
      status: "BLOCKED", evidenceStatus: "AVAILABLE", missingRequiredMigrations: [missingVersion],
    });
    const evidence = evidenceFixture("predeployment-candidate", missing);
    expect(evidence).toMatchObject({ distributable: false, productionCompatibility: "BLOCKED", missingProductionMigrations: [missingVersion] });
  });

  test("candidate complete migrations still cannot distribute or publish", () => {
    const evidence = evidenceFixture("predeployment-candidate", complete);
    expect(evidence).toMatchObject({ productionCompatibility: "PASS", distributable: false,
      publicationAuthorization: "NOT_GRANTED", automaticPublication: false, promotionPolicy: "CANONICAL_REBUILD_REQUIRED" });
  });

  test("unavailable verification fails canonical closed and remains explicitly unknown for candidate", () => {
    expect(config("canonical").status).not.toBe(0);
    const result = config("predeployment-candidate");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).compatibility).toMatchObject({ status: "BLOCKED", evidenceStatus: "UNAVAILABLE",
      missingRequiredMigrations: [], unverifiedRequiredMigrations: required });
  });

  test.each(["invalid", `${required[0]},`, `${required[0]},${required[0]}`, " "])("invalid evidence %s fails both modes", raw => {
    for (const mode of ["canonical", "predeployment-candidate"]) {
      expect(config(mode, { ...complete, RUSSICAPTOR_DEPLOYED_MIGRATIONS: raw }).status).not.toBe(0);
    }
  });

  test.each(["", "thixnregyriwevgptclw"])("missing/wrong evidence project %s is rejected", projectRef => {
    expect(config("predeployment-candidate", { ...missing, RUSSICAPTOR_MIGRATION_PROJECT_REF: projectRef }).status).not.toBe(0);
  });

  test("artifact, output directory and manifest are separated; candidate retains exact version 180", () => {
    const candidate = evaluate("policy.buildPlan(input, { RUSSICAPTOR_RELEASE_VARIANT: 'predeployment-candidate' })", descriptor);
    const canonical = evaluate("policy.buildPlan(input, {})", descriptor);
    expect(candidate.versionCode).toBe(180);
    expect(candidate.artifactFilename).not.toBe(canonical.artifactFilename);
    expect(candidate.outputDirectory).not.toBe(canonical.outputDirectory);
    expect(candidate.manifestFilename).not.toBe(canonical.manifestFilename);
  });

  test.each(["canonical", "predeployment-candidate"])("%s forbids harness and version override", mode => {
    for (const extra of [{ RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS: "1" }, { RUSSICAPTOR_RELEASE_VERSION_CODE: "180" }]) {
      expect(invoke("policy.buildPlan(input.descriptor, input.env)", { descriptor, env: { RUSSICAPTOR_RELEASE_VARIANT: mode, ...extra } }).status).not.toBe(0);
    }
  });

  test("legacy validation variants remain non-distributable and require a higher version", () => {
    expect(invoke("policy.buildPlan(input, { RUSSICAPTOR_RELEASE_VARIANT: 'upgrade-validation' })", descriptor).status).not.toBe(0);
    expect(evaluate("policy.buildPlan(input, { RUSSICAPTOR_RELEASE_VARIANT: 'rollback-validation', RUSSICAPTOR_RELEASE_VERSION_CODE: '181' })", descriptor).versionCode).toBe(181);
  });

  test("contradictory or missing verification results cannot assign distributable true", () => {
    const candidate = evidenceFixture("predeployment-candidate", missing);
    for (const compatibility of [undefined, { ...candidate.productionMigrationEvidence, status: "PASS" }]) {
      expect(invoke("policy.buildEvidence(input.descriptor, policy.buildPlan(input.descriptor, {}), input.compatibility, input.integrity, input.provenance)", {
        descriptor, compatibility, integrity: candidate.localMigrationIntegrity, provenance: candidate,
      }).status).not.toBe(0);
    }
    expect(evidenceFixture("canonical", complete).distributable).toBe(true);
  });

  test("production CI cannot select/upload a candidate or publish automatically", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/android-field-release.yml"), "utf8");
    expect(workflow).toContain("field-release:android -- --mode=canonical");
    expect(workflow).toContain("release-manifest.json --require-canonical");
    expect(workflow).toContain("path: dist/field-release/");
    expect(workflow).not.toMatch(/predeployment-candidate|gh release|contents: write|softprops\/action-gh-release/);
    expect(invoke("policy.buildPlan(input, { RUSSICAPTOR_RELEASE_VARIANT: 'predeployment-candidate' }, 'canonical')", descriptor).status).not.toBe(0);
    const rehearsal = fs.readFileSync(path.join(root, "scripts/multi-device-rehearsal-check.mjs"), "utf8");
    expect(rehearsal).toContain("verify-field-release-artifact.mjs");
    expect(rehearsal).toContain("--require-canonical");
  });
});

describe("signed artifact evidence cannot be promoted by sidecar edits", () => {
  const artifactInput = (mode = "predeployment-candidate") => {
    const embedded = evidenceFixture(mode, complete);
    const actual = { signatureVerified: true, signingCertificateSha256: descriptor.signingCertificateSha256,
      packageId: descriptor.packageId, versionCode: 180, applicationVersion: "1.2.0", debuggable: false,
      devOverlay: false, artifactSha256: "b".repeat(64), artifactSizeBytes: 1234 };
    const metadata = { ...embedded, signingCertificateSha256: actual.signingCertificateSha256,
      artifactSha256: actual.artifactSha256, artifactSizeBytes: actual.artifactSizeBytes,
      verifiedSupabaseMigrations: embedded.productionMigrationEvidence.deployedVersions,
      buildValidity: "PASS", signingVerification: "PASS", packageVersionIdentity: "PASS", debuggable: false };
    return { descriptor, embedded, metadata, actual, requireCanonical: false };
  };
  const verify = (input: ReturnType<typeof artifactInput>) => invoke(
    "policy.verifyArtifactEvidence(input.descriptor, input.metadata, input.embedded, input.actual, input.requireCanonical)", input);

  test("valid signed canonical and candidate evidence are independently verified", () => {
    expect(verify(artifactInput()).status).toBe(0);
    expect(verify({ ...artifactInput("canonical"), requireCanonical: true }).status).toBe(0);
  });

  test("sidecar distributable/mode/authorization changes cannot promote candidate", () => {
    for (const change of [{ distributable: true }, { releaseVariant: "canonical" }, { publicationAuthorization: "GRANTED" }]) {
      const input = artifactInput();
      Object.assign(input.metadata, change);
      expect(verify(input).status).not.toBe(0);
    }
    expect(verify({ ...artifactInput(), requireCanonical: true }).status).not.toBe(0);
  });

  test("signature, pinned signer, APK hash, version and package mismatches all fail closed", () => {
    for (const change of [{ signatureVerified: false }, { signingCertificateSha256: "c".repeat(64) },
      { artifactSha256: "d".repeat(64) }, { versionCode: 181 }, { packageId: "wrong.package" }, { debuggable: true }, { devOverlay: true }]) {
      const input = artifactInput();
      Object.assign(input.actual, change);
      expect(verify(input).status).not.toBe(0);
    }
    const script = fs.readFileSync(path.join(root, "scripts/verify-field-release-artifact.mjs"), "utf8");
    expect(script).toContain('["verify", "--verbose", "--print-certs", artifact]');
    expect(script).toContain('["-p", artifact, EMBEDDED_EVIDENCE_PATH]');
  });
});

describe("local migration source integrity", () => {
  let fixture: string;
  const filename = "20261016065854_ready_exercise_cancellation.sql";
  const fixtureDescriptor = { requiredSupabaseMigrations: [{ remoteVersion: "20261016065854", localFile: filename }] };
  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "russicaptor-release-integrity-"));
    fs.mkdirSync(path.join(fixture, "supabase/migrations"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "supabase/migrations", filename), "select 1;\n");
    const git = (args: string[]) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
    git(["init", "--quiet"]);
    git(["add", "supabase/migrations"]);
    git(["-c", "user.name=Release test", "-c", "user.email=release-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"]);
  });
  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const verify = () => invoke("policy.localMigrationIntegrity(input.root, input.descriptor)", { root: fixture, descriptor: fixtureDescriptor });

  test("committed source records exact SHA-256", () => {
    const result = verify();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "PASS", count: 1 });
  });
  test("modified historical SQL fails closed", () => {
    fs.appendFileSync(path.join(fixture, "supabase/migrations", filename), "select 2;\n");
    expect(verify().status).not.toBe(0);
  });
  test("untracked duplicate version fails closed", () => {
    fs.writeFileSync(path.join(fixture, "supabase/migrations/20261016065854_other.sql"), "select 1;\n");
    expect(verify().status).not.toBe(0);
  });
  test("missing required migration fails closed", () => {
    fs.unlinkSync(path.join(fixture, "supabase/migrations", filename));
    expect(verify().status).not.toBe(0);
  });
});
