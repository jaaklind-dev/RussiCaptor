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

function loadLocalPublicEnvironment() {
  const envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadLocalPublicEnvironment();
run(process.execPath, ["scripts/verify-field-release-config.mjs"]);
const status = run("git", ["status", "--porcelain", "--untracked-files=no"], { capture: true }).trim();
const sourceDirty = Boolean(status);
if (sourceDirty && process.env.RUSSICAPTOR_ALLOW_DIRTY_BUILD !== "1") throw new Error("Field release requires a clean tracked working tree.");

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(url)) throw new Error("A production Supabase URL is required.");
if (!key.startsWith("sb_publishable_") && !key.startsWith("eyJ")) throw new Error("A Supabase publishable/legacy anon key is required.");
if (key.startsWith("sb_secret_") || /service_role/i.test(key)) throw new Error("A secret/service-role key must never be bundled.");

const validationSigning = process.env.RUSSICAPTOR_VALIDATION_SIGNING === "debug";
if (validationSigning) {
  process.env.RUSSICAPTOR_RELEASE_KEYSTORE = path.join(root, "android/app/debug.keystore");
  process.env.RUSSICAPTOR_RELEASE_STORE_PASSWORD = "android";
  process.env.RUSSICAPTOR_RELEASE_KEY_ALIAS = "androiddebugkey";
  process.env.RUSSICAPTOR_RELEASE_KEY_PASSWORD = "android";
}
for (const name of ["RUSSICAPTOR_RELEASE_KEYSTORE", "RUSSICAPTOR_RELEASE_STORE_PASSWORD", "RUSSICAPTOR_RELEASE_KEY_ALIAS", "RUSSICAPTOR_RELEASE_KEY_PASSWORD"]) {
  if (!process.env[name]) throw new Error(`${name} is required for a signed field artifact.`);
}

const gitSha = run("git", ["rev-parse", "HEAD"], { capture: true }).trim();
const buildTimestamp = new Date().toISOString();
Object.assign(process.env, {
  NODE_ENV: "production",
  EXPO_PUBLIC_RELEASE_ENVIRONMENT: "production",
  EXPO_PUBLIC_BUILD_GIT_SHA: gitSha,
  EXPO_PUBLIC_BUILD_TIMESTAMP: buildTimestamp,
  EXPO_PUBLIC_ANDROID_VERSION_CODE: String(manifest.versionCode),
  RUSSICAPTOR_VERSION_NAME: manifest.applicationVersion,
  RUSSICAPTOR_VERSION_CODE: String(manifest.versionCode),
});

run(path.join(root, "node_modules/.bin/expo"), ["prebuild", "--clean", "--platform", "android", "--no-install"]);
run(process.execPath, ["scripts/configure-field-release-native.mjs"]);
run(path.join(root, "android/gradlew"), [":app:assembleRelease", "--no-daemon"], { cwd: path.join(root, "android") });
const sourceApk = path.join(root, "android/app/build/outputs/apk/release/app-release.apk");
if (!fs.existsSync(sourceApk)) throw new Error(`APK not produced at ${sourceApk}`);
const output = path.join(root, "dist/field-release");
fs.mkdirSync(output, { recursive: true });
const artifact = path.join(output, manifest.artifactFilename);
fs.copyFileSync(sourceApk, artifact);

const buildTools = path.join(process.env.ANDROID_HOME, "build-tools");
const toolVersion = fs.readdirSync(buildTools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
const aapt = path.join(buildTools, toolVersion, "aapt");
const apksigner = path.join(buildTools, toolVersion, "apksigner");
const badging = run(aapt, ["dump", "badging", artifact], { capture: true });
const packageMatch = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(badging);
if (!packageMatch || packageMatch[1] !== manifest.packageId || packageMatch[2] !== String(manifest.versionCode) || packageMatch[3] !== manifest.applicationVersion) throw new Error("APK package/version metadata mismatch.");
if (badging.includes("application-debuggable")) throw new Error("APK is debuggable.");
if (badging.includes("android.permission.SYSTEM_ALERT_WINDOW")) throw new Error("APK contains a dev-only overlay permission.");
const certificate = run(apksigner, ["verify", "--verbose", "--print-certs", artifact], { capture: true });
if (!certificate.includes("Verified using v")) throw new Error("APK signature verification failed.");
const fingerprint = /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(certificate)?.[1];
if (!fingerprint) throw new Error("Signing fingerprint unavailable.");
const artifactBytes = fs.readFileSync(artifact);
const generated = {
  ...manifest,
  gitSha,
  buildTimestamp,
  sourceDirty,
  distributable: !sourceDirty && !validationSigning,
  signingProfile: validationSigning ? "validation-debug-not-for-distribution" : "external-field-release",
  signingCertificateSha256: fingerprint,
  artifactSha256: crypto.createHash("sha256").update(artifactBytes).digest("hex"),
  artifactSizeBytes: artifactBytes.byteLength,
};
fs.writeFileSync(path.join(output, "release-manifest.json"), `${JSON.stringify(generated, null, 2)}\n`);
console.log(`FIELD_RELEASE_ARTIFACT=${artifact}`);
console.log(`FIELD_RELEASE_DISTRIBUTABLE=${generated.distributable}`);
