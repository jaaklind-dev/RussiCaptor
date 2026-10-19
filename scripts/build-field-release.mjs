import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPlan, buildEvidence, EMBEDDED_EVIDENCE_PATH, verifyArtifactEvidence } from "./field-release-policy.mjs";
import acceptanceProfile from "./canonical-acceptance-profile.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.ANDROID_HOME ||= path.join(process.env.HOME, "Library/Android/sdk");
process.env.ANDROID_SDK_ROOT ||= process.env.ANDROID_HOME;
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: options.cwd ?? root, encoding: "utf8", stdio: options.capture ? "pipe" : "inherit", env: process.env });
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const manifest = readJson("release/field-release.json");

function loadLocalPublicEnvironment() {
  const envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadLocalPublicEnvironment();
const modeArguments = process.argv.slice(2).filter(arg => arg.startsWith("--mode="));
if (modeArguments.length > 1 || modeArguments.length !== process.argv.length - 2) throw new Error("Invalid build arguments.");
const plan = buildPlan(manifest, process.env, modeArguments[0]?.slice("--mode=".length));
const { mode: releaseVariant, versionCode: buildVersionCode, artifactFilename } = plan;
const output = path.join(root, plan.outputDirectory);
if ([artifactFilename, plan.manifestFilename, `${artifactFilename}.sha256`].some(file => fs.existsSync(path.join(output, file)))) throw new Error('Refusing to overwrite an existing release artifact.');
const acceptanceSources = acceptanceProfile.verifySources(root, !releaseVariant.endsWith('-validation'));
const verification = JSON.parse(run(process.execPath, ["scripts/verify-field-release-config.mjs", `--mode=${releaseVariant}`, "--json"], { capture: true }));
if (verification.configuration !== "PASS") throw new Error("Release verification failed closed.");
run(process.execPath, ["scripts/builder-verify-published.mjs"]);
const status = run("git", ["status", "--porcelain", "--untracked-files=normal"], { capture: true }).trim();
const sourceDirty = Boolean(status);
if (sourceDirty && process.env.RUSSICAPTOR_ALLOW_DIRTY_BUILD !== "1") throw new Error("Field release requires a clean working tree.");
if (sourceDirty && releaseVariant === "predeployment-candidate") throw new Error("Predeployment candidate requires committed clean source.");

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(url)) throw new Error("A production Supabase URL is required.");
if (new URL(url).hostname !== "fimcsrivizpliiuoqopv.supabase.co") throw new Error("Wrong production project configuration.");
if (!key.startsWith("sb_publishable_") && !key.startsWith("eyJ")) throw new Error("A Supabase publishable/legacy anon key is required.");
if (key.startsWith("sb_secret_") || /service_role/i.test(key)) throw new Error("A secret/service-role key must never be bundled.");

if (process.platform === "darwin" && !process.env.RUSSICAPTOR_RELEASE_KEYSTORE) {
  const localKeystore = path.join(process.env.HOME, "Library/Application Support/RussiCaptor/signing/russicaptor-field-release.jks");
  if (fs.existsSync(localKeystore)) {
    process.env.RUSSICAPTOR_RELEASE_KEYSTORE = localKeystore;
    process.env.RUSSICAPTOR_RELEASE_STORE_PASSWORD = run("security", ["find-generic-password", "-w", "-a", "store", "-s", "com.jaaklind.RussiCaptor.field-release.store-password"], { capture: true }).trim();
    process.env.RUSSICAPTOR_RELEASE_KEY_ALIAS = "russicaptor-field-release";
    process.env.RUSSICAPTOR_RELEASE_KEY_PASSWORD = run("security", ["find-generic-password", "-w", "-a", "key", "-s", "com.jaaklind.RussiCaptor.field-release.key-password"], { capture: true }).trim();
  }
}
for (const name of ["RUSSICAPTOR_RELEASE_KEYSTORE", "RUSSICAPTOR_RELEASE_STORE_PASSWORD", "RUSSICAPTOR_RELEASE_KEY_ALIAS", "RUSSICAPTOR_RELEASE_KEY_PASSWORD"]) {
  if (!process.env[name]) throw new Error(`${name} is required for a signed field artifact.`);
}
const keystorePath = path.resolve(process.env.RUSSICAPTOR_RELEASE_KEYSTORE);
if (!fs.existsSync(keystorePath)) throw new Error("Production signing keystore does not exist.");
if (keystorePath === path.join(root, "android/app/debug.keystore")) throw new Error("Debug keystore is forbidden for field releases.");

const gitSha = run("git", ["rev-parse", "HEAD"], { capture: true }).trim();
const buildTimestamp = new Date().toISOString();
const evidence = buildEvidence(manifest, plan, verification.compatibility, verification.integrity, { gitSha, buildTimestamp, sourceDirty });
Object.assign(process.env, {
  RUSSICAPTOR_RELEASE_VARIANT: releaseVariant,
  NODE_ENV: "production",
  EXPO_PUBLIC_RELEASE_ENVIRONMENT: "production",
  EXPO_PUBLIC_BUILD_GIT_SHA: gitSha,
  EXPO_PUBLIC_BUILD_TIMESTAMP: buildTimestamp,
  EXPO_PUBLIC_ANDROID_VERSION_CODE: String(buildVersionCode),
  RUSSICAPTOR_VERSION_NAME: manifest.applicationVersion,
  RUSSICAPTOR_VERSION_CODE: String(buildVersionCode),
  EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS: plan.sharedWorkflowValidationHarness ? "1" : "0",
});

run(path.join(root, "node_modules/.bin/expo"), ["prebuild", "--clean", "--platform", "android", "--no-install"]);
run(process.execPath, ["scripts/configure-field-release-native.mjs"]);
// This file is covered by the APK signature. Sidecar edits cannot promote a
// candidate: the artifact verifier independently reads this signed evidence.
const evidencePath = path.join(root, "android/app/src/main", EMBEDDED_EVIDENCE_PATH);
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
// Produce and audit the real Metro/Hermes outputs before packaging. The audit
// itself is then covered by the APK signature, not just a mutable sidecar.
run(path.join(root, "android/gradlew"), [":app:createBundleReleaseJsAndAssets", "--no-daemon"], { cwd: path.join(root, "android") });
const generatedBundlePath = path.join(root, 'android/app/build/generated/assets/react/release/index.android.bundle');
const generatedBundle = fs.readFileSync(generatedBundlePath);
const acceptanceBundle = acceptanceProfile.verifyBundle(generatedBundle, releaseVariant);
if (plan.sharedWorkflowValidationHarness && !acceptanceBundle.markers.filter(m => ['SW-VALIDATION-', 'NEGATIVE_TEST', 'VALIDATION_BINDING_CHANGED'].includes(m.marker)).every(m => m.present)) throw new Error('Validation harness missing from actual bundle.');
const mapPath = path.join(root, 'android/app/build/generated/sourcemaps/react/release/index.android.bundle.map');
if (!fs.existsSync(mapPath)) throw new Error('Actual Metro source map required for acceptance graph verification.');
const sourceMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const mapSources = map => [...(map.sources ?? []), ...(map.sections ?? []).flatMap(s => mapSources(s.map))];
const sources = mapSources(sourceMap).map(source => source.replace(/^.*?(?=node_modules\/|src\/|release\/canonical-profile\/)/, ''));
if (!sources.length) throw new Error('Empty Metro source graph.');
if (!releaseVariant.endsWith('-validation') && sources.some(source => acceptanceProfile.forbidden.some(name => source.includes(`/${name}.`)))) throw new Error('Acceptance-only module remains in canonical source graph.');
const signedAudit = { ...acceptanceBundle, acceptanceSources, sources, sourceMapSha256: acceptanceProfile.sha(fs.readFileSync(mapPath)) };
fs.writeFileSync(path.join(path.dirname(evidencePath), 'russicaptor-acceptance-audit.json'), JSON.stringify(signedAudit));
run(path.join(root, "android/gradlew"), [":app:assembleRelease", "--no-daemon"], { cwd: path.join(root, "android") });
const sourceApk = path.join(root, "android/app/build/outputs/apk/release/app-release.apk");
if (!fs.existsSync(sourceApk)) throw new Error(`APK not produced at ${sourceApk}`);
fs.mkdirSync(output, { recursive: true });
const artifact = path.join(output, artifactFilename);
fs.copyFileSync(sourceApk, artifact);

const buildTools = path.join(process.env.ANDROID_HOME, "build-tools");
const toolVersion = fs.readdirSync(buildTools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
const aapt = path.join(buildTools, toolVersion, "aapt");
const apksigner = path.join(buildTools, toolVersion, "apksigner");
const badging = run(aapt, ["dump", "badging", artifact], { capture: true });
const packageMatch = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(badging);
if (!packageMatch || packageMatch[1] !== manifest.packageId || packageMatch[2] !== String(buildVersionCode) || packageMatch[3] !== manifest.applicationVersion) throw new Error("APK package/version metadata mismatch.");
if (badging.includes("application-debuggable")) throw new Error("APK is debuggable.");
if (badging.includes("android.permission.SYSTEM_ALERT_WINDOW")) throw new Error("APK contains a dev-only overlay permission.");
const certificate = run(apksigner, ["verify", "--verbose", "--print-certs", artifact], { capture: true });
if (!certificate.includes("Verified using v")) throw new Error("APK signature verification failed.");
const fingerprint = /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(certificate)?.[1];
if (!fingerprint) throw new Error("Signing fingerprint unavailable.");
if (fingerprint.toLowerCase() !== manifest.signingCertificateSha256) throw new Error("APK signer does not match the canonical production signer.");
const artifactBytes = fs.readFileSync(artifact);
const bundle = execFileSync('unzip', ['-p', artifact, 'assets/index.android.bundle'], { maxBuffer: 100 * 1024 * 1024 });
const signedAuditBytes = execFileSync('unzip', ['-p', artifact, 'assets/russicaptor-acceptance-audit.json']);
if (acceptanceProfile.sha(bundle) !== signedAudit.bundleSha256 || JSON.stringify(JSON.parse(signedAuditBytes)) !== JSON.stringify(signedAudit)) throw new Error('Packaged bundle/signed acceptance audit mismatch.');
fs.writeFileSync(path.join(output, 'acceptance-bundle-audit.json'), signedAuditBytes);
const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map(match => match[1]);
const minSdk = /sdkVersion:'([^']+)'/.exec(badging)?.[1];
const targetSdk = /targetSdkVersion:'([^']+)'/.exec(badging)?.[1];
const generated = {
  ...manifest,
  ...evidence,
  buildValidity: "PASS",
  signingVerification: "PASS",
  packageVersionIdentity: "PASS",
  signingProfile: "stable-production-field-release",
  signingCertificateSha256: fingerprint,
  artifactSha256: crypto.createHash("sha256").update(artifactBytes).digest("hex"),
  artifactSizeBytes: artifactBytes.byteLength,
  debuggable: false,
  acceptanceBundleAuditSha256: acceptanceProfile.sha(fs.readFileSync(path.join(output, 'acceptance-bundle-audit.json'))),
  permissions,
  minSdk,
  targetSdk,
  verifiedSupabaseMigrations: verification.compatibility.deployedVersions,
};
verifyArtifactEvidence(manifest, generated, JSON.parse(run("unzip", ["-p", artifact, EMBEDDED_EVIDENCE_PATH], { capture: true })), {
  signatureVerified: true, signingCertificateSha256: fingerprint.toLowerCase(),
  packageId: packageMatch[1], versionCode: Number(packageMatch[2]), applicationVersion: packageMatch[3],
  debuggable: false, devOverlay: false, artifactSha256: generated.artifactSha256, artifactSizeBytes: artifactBytes.byteLength,
}, releaseVariant === "canonical");
fs.writeFileSync(path.join(output, plan.manifestFilename), `${JSON.stringify(generated, null, 2)}\n`);
fs.writeFileSync(path.join(output, `${artifactFilename}.sha256`), `${generated.artifactSha256}  ${artifactFilename}\n`);
run(process.execPath, ["scripts/verify-field-release-artifact.mjs", path.join(output, plan.manifestFilename), ...(releaseVariant === "canonical" ? ["--require-canonical"] : [])]);
for (const file of [
  "docs/FIELD_RELEASE_ANDROID.md",
  "docs/WP_NEXT_04_CONTROLLED_FIELD_RELEASE_DEPLOYMENT.md",
  "docs/WP_NEXT_07_PRODUCTION_SIGNING_DISTRIBUTABLE_RELEASE.md",
]) {
  fs.copyFileSync(path.join(root, file), path.join(output, path.basename(file)));
}
console.log(`FIELD_RELEASE_ARTIFACT=${artifact}`);
console.log(`FIELD_RELEASE_DISTRIBUTABLE=${generated.distributable}`);
