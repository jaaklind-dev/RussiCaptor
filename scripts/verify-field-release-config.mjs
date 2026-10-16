import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPlan, localMigrationIntegrity, productionCompatibility, requireProductionCompatibility } from "./field-release-policy.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../release/field-release.json", import.meta.url), "utf8"));
const app = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
const nativeConfigurator = fs.readFileSync(new URL("./configure-field-release-native.mjs", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`FIELD_RELEASE_CONFIG_INVALID: ${message}`); };
if (manifest.environment !== "production") fail("environment must be production");
if (manifest.packageId !== app.android.package) fail("package ID mismatch");
if (manifest.applicationVersion !== app.version) fail("application version mismatch");
if (manifest.applicationVersion !== pkg.version) fail("package version mismatch");
if (manifest.versionCode !== app.android.versionCode) fail("versionCode mismatch");
if (!Number.isInteger(manifest.minimumVersionCodeExclusive)) fail("minimum prior versionCode must be declared");
if (manifest.versionCode <= manifest.minimumVersionCodeExclusive) fail("versionCode must exceed the prior distributed maximum");
if (!/^[0-9a-f]{64}$/.test(manifest.signingCertificateSha256)) fail("stable signing fingerprint missing");
if (!Array.isArray(manifest.requiredSupabaseMigrations) || !manifest.requiredSupabaseMigrations.length) fail("required migrations missing");
const remoteVersions = new Set();
for (const migration of manifest.requiredSupabaseMigrations) {
  if (!/^\d{12,14}$/.test(migration.remoteVersion)) fail("remote migration version is invalid");
  if (remoteVersions.has(migration.remoteVersion)) fail(`duplicate remote migration ${migration.remoteVersion}`);
  remoteVersions.add(migration.remoteVersion);
  const matches = fs.readdirSync(new URL("../supabase/migrations", import.meta.url)).includes(migration.localFile);
  if (!matches) fail(`migration file ${migration.localFile} is not tracked`);
}
const modeArguments = process.argv.slice(2).filter(arg => arg.startsWith("--mode="));
if (modeArguments.length > 1 || process.argv.slice(2).some(arg => arg !== "--json" && !arg.startsWith("--mode="))) fail("invalid verification arguments");
const mode = modeArguments[0]?.slice("--mode=".length);
const plan = mode ? buildPlan(manifest, process.env, mode) : undefined;
const compatibility = productionCompatibility([...remoteVersions], process.env);
// Static config verification remains usable offline. Every actual build passes
// an explicit mode; canonical/validation builds cannot opt out through env vars.
if ((plan && plan.mode !== "predeployment-candidate") || (!plan && (process.env.RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS === "1" || compatibility.evidenceStatus === "AVAILABLE"))) requireProductionCompatibility(compatibility);
const integrity = plan ? localMigrationIntegrity(fileURLToPath(new URL("../", import.meta.url)), manifest) : undefined;
if (pkg.dependencies?.["expo-dev-client"]) fail("expo-dev-client must not be a production dependency");
if (app.plugins?.some(plugin => plugin === "expo-dev-client" || plugin?.[0] === "expo-dev-client")) fail("expo-dev-client plugin must not be configured");
if (!app.android.blockedPermissions?.includes("android.permission.SYSTEM_ALERT_WINDOW")) fail("dev overlay permission must be blocked");
if (app.android.allowBackup !== false) fail("field app backup must be disabled");
if (!nativeConfigurator.includes("RUSSICAPTOR_RELEASE_KEYSTORE")) fail("external release signing is not configured");
if (!nativeConfigurator.includes("signingConfig signingConfigs.release")) fail("release build must require production signing");
if (nativeConfigurator.includes("releaseSigningConfigured ?")) fail("release signing must not fall back");
console.log(process.argv.includes("--json")
  ? JSON.stringify({ configuration: "PASS", compatibility, integrity })
  : "FIELD_RELEASE_CONFIG_VALID");
if (!process.argv.includes("--json")) {
  console.log(`PRODUCTION_COMPATIBILITY=${compatibility.status}`);
  console.log(`MIGRATION_EVIDENCE=${compatibility.evidenceStatus}`);
}
