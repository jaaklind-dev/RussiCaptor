import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EMBEDDED_EVIDENCE_PATH, localMigrationIntegrity, sha256, verifyArtifactEvidence } from "./field-release-policy.mjs";
import acceptanceProfile from './canonical-acceptance-profile.cjs';

const root = fileURLToPath(new URL("../", import.meta.url));
const [manifestArgument, ...flags] = process.argv.slice(2);
if (!manifestArgument || flags.some(flag => flag !== "--require-canonical")) throw new Error("Expected manifest path and optional --require-canonical.");
const metadata = JSON.parse(fs.readFileSync(path.resolve(manifestArgument), "utf8"));
if (typeof metadata.artifactFilename !== "string" || path.basename(metadata.artifactFilename) !== metadata.artifactFilename) throw new Error("Invalid artifact filename.");
const artifact = path.join(path.dirname(path.resolve(manifestArgument)), metadata.artifactFilename);
const descriptor = JSON.parse(fs.readFileSync(path.join(root, "release/field-release.json"), "utf8"));
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const tools = path.join(process.env.ANDROID_HOME ?? path.join(process.env.HOME, "Library/Android/sdk"), "build-tools");
const version = fs.readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
const badging = run(path.join(tools, version, "aapt"), ["dump", "badging", artifact]);
const certificate = run(path.join(tools, version, "apksigner"), ["verify", "--verbose", "--print-certs", artifact]);
const identity = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(badging);
const bytes = fs.readFileSync(artifact);
const embedded = JSON.parse(run("unzip", ["-p", artifact, EMBEDDED_EVIDENCE_PATH]));
const actual = {
  signatureVerified: certificate.includes("Verified using v"),
  signingCertificateSha256: /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(certificate)?.[1]?.toLowerCase(),
  packageId: identity?.[1], versionCode: Number(identity?.[2]), applicationVersion: identity?.[3],
  debuggable: badging.includes("application-debuggable"), devOverlay: badging.includes("android.permission.SYSTEM_ALERT_WINDOW"),
  artifactSha256: sha256(bytes), artifactSizeBytes: bytes.byteLength,
};
verifyArtifactEvidence(descriptor, metadata, embedded, actual, flags.includes("--require-canonical"));
const bundle = execFileSync('unzip', ['-p', artifact, 'assets/index.android.bundle'], { maxBuffer: 100 * 1024 * 1024 });
acceptanceProfile.verifyBundle(bundle, embedded.releaseVariant);
const auditBytes = execFileSync('unzip', ['-p', artifact, 'assets/russicaptor-acceptance-audit.json']);
const audit = JSON.parse(auditBytes);
if (sha256(auditBytes) !== metadata.acceptanceBundleAuditSha256 || audit.bundleSha256 !== sha256(bundle)) throw new Error('Acceptance audit/artifact mismatch.');
if (JSON.stringify(audit.acceptanceSources) !== JSON.stringify(acceptanceProfile.verifySources(root, embedded.acceptanceBundleProfile.profile === 'canonical'))) throw new Error('Signed source profile differs from committed source.');
if (!Array.isArray(audit.sources) || !audit.sources.length || (embedded.acceptanceBundleProfile.profile === 'canonical' && audit.sources.some(source => acceptanceProfile.forbidden.some(name => source.includes(`/${name}.`))))) throw new Error('Signed source graph violates canonical exclusion.');
if (JSON.stringify(localMigrationIntegrity(root, descriptor)) !== JSON.stringify(embedded.localMigrationIntegrity)) throw new Error("Artifact local migrations differ from committed source.");
if (flags.includes("--require-canonical")) {
  // Fresh compatibility verification is mandatory, regardless of sidecar/env flags.
  run(process.execPath, ["scripts/verify-field-release-config.mjs", "--mode=canonical"]);
}
console.log(`FIELD_RELEASE_ARTIFACT_VERIFIED=${actual.artifactSha256}`);
console.log(`PUBLICATION_AUTHORIZATION=${embedded.publicationAuthorization}`);
