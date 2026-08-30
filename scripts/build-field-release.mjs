import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.ANDROID_HOME ||= path.join(process.env.HOME, "Library/Android/sdk");
process.env.ANDROID_SDK_ROOT ||= process.env.ANDROID_HOME;
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: options.cwd ?? root, encoding: "utf8", stdio: options.capture ? "pipe" : "inherit", env: process.env });
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const manifest = readJson("release/field-release.json");
const releaseVariant = process.env.RUSSICAPTOR_RELEASE_VARIANT ?? "canonical";
const versionCodeOverride = process.env.RUSSICAPTOR_RELEASE_VERSION_CODE;
if (releaseVariant === "canonical" && versionCodeOverride) throw new Error("Canonical release versionCode cannot be overridden.");
if (!new Set(["canonical", "upgrade-validation", "rollback-validation"]).has(releaseVariant)) throw new Error("Unknown field release variant.");
const buildVersionCode = versionCodeOverride ? Number(versionCodeOverride) : manifest.versionCode;
if (!Number.isInteger(buildVersionCode) || buildVersionCode < manifest.versionCode) throw new Error("Release versionCode override must be monotonic.");
if (releaseVariant !== "canonical" && buildVersionCode <= manifest.versionCode) throw new Error("Validation release must have a higher versionCode.");
const artifactFilename = releaseVariant === "canonical"
  ? manifest.artifactFilename
  : `RussiCaptor-${manifest.applicationVersion}-${buildVersionCode}-${releaseVariant}.apk`;

function loadLocalPublicEnvironment() {
  const envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadLocalPublicEnvironment();
process.env.RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS ||= "1";
run(process.execPath, ["scripts/verify-field-release-config.mjs"]);
const status = run("git", ["status", "--porcelain", "--untracked-files=no"], { capture: true }).trim();
const sourceDirty = Boolean(status);
if (sourceDirty && process.env.RUSSICAPTOR_ALLOW_DIRTY_BUILD !== "1") throw new Error("Field release requires a clean tracked working tree.");

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(url)) throw new Error("A production Supabase URL is required.");
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
Object.assign(process.env, {
  NODE_ENV: "production",
  EXPO_PUBLIC_RELEASE_ENVIRONMENT: "production",
  EXPO_PUBLIC_BUILD_GIT_SHA: gitSha,
  EXPO_PUBLIC_BUILD_TIMESTAMP: buildTimestamp,
  EXPO_PUBLIC_ANDROID_VERSION_CODE: String(buildVersionCode),
  RUSSICAPTOR_VERSION_NAME: manifest.applicationVersion,
  RUSSICAPTOR_VERSION_CODE: String(buildVersionCode),
});

run(path.join(root, "node_modules/.bin/expo"), ["prebuild", "--clean", "--platform", "android", "--no-install"]);
run(process.execPath, ["scripts/configure-field-release-native.mjs"]);
run(path.join(root, "android/gradlew"), [":app:assembleRelease", "--no-daemon"], { cwd: path.join(root, "android") });
const sourceApk = path.join(root, "android/app/build/outputs/apk/release/app-release.apk");
if (!fs.existsSync(sourceApk)) throw new Error(`APK not produced at ${sourceApk}`);
const output = path.join(root, "dist/field-release");
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
const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map(match => match[1]);
const minSdk = /sdkVersion:'([^']+)'/.exec(badging)?.[1];
const targetSdk = /targetSdkVersion:'([^']+)'/.exec(badging)?.[1];
const generated = {
  ...manifest,
  versionCode: buildVersionCode,
  artifactFilename,
  releaseVariant,
  gitSha,
  buildTimestamp,
  sourceDirty,
  distributable: !sourceDirty && releaseVariant === "canonical",
  signingProfile: "stable-production-field-release",
  signingCertificateSha256: fingerprint,
  artifactSha256: crypto.createHash("sha256").update(artifactBytes).digest("hex"),
  artifactSizeBytes: artifactBytes.byteLength,
  debuggable: false,
  permissions,
  minSdk,
  targetSdk,
  verifiedSupabaseMigrations: (process.env.RUSSICAPTOR_DEPLOYED_MIGRATIONS ?? "").split(",").map(value => value.trim()).filter(Boolean),
};
fs.writeFileSync(path.join(output, "release-manifest.json"), `${JSON.stringify(generated, null, 2)}\n`);
fs.writeFileSync(path.join(output, `${artifactFilename}.sha256`), `${generated.artifactSha256}  ${artifactFilename}\n`);
for (const file of [
  "docs/FIELD_RELEASE_ANDROID.md",
  "docs/WP_NEXT_04_CONTROLLED_FIELD_RELEASE_DEPLOYMENT.md",
  "docs/WP_NEXT_07_PRODUCTION_SIGNING_DISTRIBUTABLE_RELEASE.md",
]) {
  fs.copyFileSync(path.join(root, file), path.join(output, path.basename(file)));
}
console.log(`FIELD_RELEASE_ARTIFACT=${artifact}`);
console.log(`FIELD_RELEASE_DISTRIBUTABLE=${generated.distributable}`);
