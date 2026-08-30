import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../release/field-release.json", import.meta.url), "utf8"));
const app = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
const nativeConfigurator = fs.readFileSync(new URL("./configure-field-release-native.mjs", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`FIELD_RELEASE_CONFIG_INVALID: ${message}`); };
if (manifest.environment !== "production") fail("environment must be production");
if (manifest.packageId !== app.android.package) fail("package ID mismatch");
if (manifest.applicationVersion !== app.version) fail("application version mismatch");
if (manifest.versionCode !== app.android.versionCode) fail("versionCode mismatch");
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
const deployed = new Set((process.env.RUSSICAPTOR_DEPLOYED_MIGRATIONS ?? "").split(",").map(value => value.trim()).filter(Boolean));
if (process.env.RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS === "1" && !deployed.size) fail("verified remote migration list is required");
for (const version of remoteVersions) {
  if (deployed.size && !deployed.has(version)) fail(`required remote migration ${version} is not deployed`);
}
if (pkg.dependencies?.["expo-dev-client"]) fail("expo-dev-client must not be a production dependency");
if (app.plugins?.some(plugin => plugin === "expo-dev-client" || plugin?.[0] === "expo-dev-client")) fail("expo-dev-client plugin must not be configured");
if (!app.android.blockedPermissions?.includes("android.permission.SYSTEM_ALERT_WINDOW")) fail("dev overlay permission must be blocked");
if (app.android.allowBackup !== false) fail("field app backup must be disabled");
if (!nativeConfigurator.includes("RUSSICAPTOR_RELEASE_KEYSTORE")) fail("external release signing is not configured");
if (!nativeConfigurator.includes("signingConfig signingConfigs.release")) fail("release build must require production signing");
if (nativeConfigurator.includes("releaseSigningConfigured ?")) fail("release signing must not fall back");
console.log("FIELD_RELEASE_CONFIG_VALID");
