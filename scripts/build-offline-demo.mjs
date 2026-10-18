import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { demoKey, alias, loadDemoPassword, signingFingerprint } from './demo-signing.mjs';
import { validatePolicy, validateArtifact, validateAuditedBundleSources, validateManifestDump, verifyAuditedDemoSources, verifyAuditedDemoAssets, validatePackagedDemoAssets,
  verifyAuditedAssetRegistry, validateAssetRegistryBundle, EMBEDDED } from './offline-demo-build-policy.mjs';
import { verifyOfflineDemo } from './verify-offline-demo.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'offline-demo');
const policy = JSON.parse(fs.readFileSync(path.join(app, 'build-policy.json'), 'utf8'));
validatePolicy(policy, process.env);
verifyOfflineDemo();
if (process.argv.length !== 2) throw new Error('OFFLINE_DEMO_BUILD_ARGUMENTS_FORBIDDEN');
const env = { ...process.env, NODE_ENV: 'production', EXPO_OFFLINE: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1',
  JAVA_HOME: '/Applications/Android Studio.app/Contents/jbr/Contents/Home', ANDROID_HOME: path.join(os.homedir(), 'Library/Android/sdk') };
env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
const run = (cmd, args, cwd = app, binary = false) => execFileSync(cmd, args, { cwd, env, encoding: binary ? undefined : 'utf8', maxBuffer: 128 * 1024 * 1024 });
if (run('git', ['status', '--porcelain'], root).trim()) throw new Error('OFFLINE_DEMO_CLEAN_COMMITTED_SOURCE_REQUIRED');
const evidence = { ...policy, auditedDemoSources: verifyAuditedDemoSources(), auditedDemoAssets:verifyAuditedDemoAssets(), assetRegistry:verifyAuditedAssetRegistry(), sourceCommit: run('git', ['rev-parse', 'HEAD'], root).trim(), sourceDirty: false, buildTimestamp: new Date().toISOString() };
const password = loadDemoPassword();
if (signingFingerprint(password) !== policy.signingCertificateSha256) throw new Error('OFFLINE_DEMO_SIGNER_MISMATCH');
env.DEMO_KEY_PASSWORD = password;
env.DEMO_KEYSTORE = demoKey;
env.DEMO_KEY_ALIAS = alias;
run(path.join(root, 'node_modules/.bin/expo'), ['prebuild', '--clean', '--platform', 'android', '--no-install']);
const native = path.join(app, 'android');
const gradleFile = path.join(native, 'app/build.gradle');
let gradle = fs.readFileSync(gradleFile, 'utf8');
const marker = '    signingConfigs {\n        debug {';
if (!gradle.includes(marker) || !gradle.includes('        release {')) throw new Error('OFFLINE_DEMO_NATIVE_TEMPLATE_CHANGED');
gradle = gradle.replace(marker, `    signingConfigs {\n        offlineDemo {\n            storeFile file(System.getenv("DEMO_KEYSTORE"))\n            storePassword System.getenv("DEMO_KEY_PASSWORD")\n            keyAlias System.getenv("DEMO_KEY_ALIAS")\n            keyPassword System.getenv("DEMO_KEY_PASSWORD")\n        }\n        debug {`);
const offset = gradle.indexOf('        release {');
if (!gradle.slice(offset).includes('signingConfig signingConfigs.debug')) throw new Error('OFFLINE_DEMO_RELEASE_TEMPLATE_CHANGED');
gradle = gradle.slice(0, offset) + gradle.slice(offset).replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.offlineDemo');
fs.writeFileSync(gradleFile, gradle);
fs.appendFileSync(path.join(native, 'gradle.properties'), '\nEX_DEV_CLIENT_NETWORK_INSPECTOR=false\n');
const evidenceFile = path.join(native, 'app/src/main', EMBEDDED);
fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
console.log('OFFLINE_DEMO_NATIVE_BUILD_STARTED');
try {
  console.log(run(path.join(native, 'gradlew'), [':app:assembleRelease', '--no-daemon', '--max-workers=2', '-PreactNativeArchitectures=arm64-v8a', '-Porg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m'], native));
} catch (error) {
  // Gradle output is captured, but never print exception objects/env/credentials.
  const output = String(error.stdout ?? '') + String(error.stderr ?? '');
  console.error(output.replaceAll(password, '[REDACTED]'));
  throw new Error('OFFLINE_DEMO_NATIVE_BUILD_FAILED');
}
const apk = path.join(native, 'app/build/outputs/apk/release/app-release.apk');
const tools = path.join(env.ANDROID_HOME, 'build-tools/36.0.0');
const badging = run(path.join(tools, 'aapt'), ['dump', 'badging', apk]);
const manifestDump = run(path.join(tools, 'aapt'), ['dump', 'xmltree', apk, 'AndroidManifest.xml']);
const cert = run(path.join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
const match = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(badging);
const embedded = JSON.parse(run('unzip', ['-p', apk, EMBEDDED]));
const map = JSON.parse(fs.readFileSync(path.join(native, 'app/build/generated/sourcemaps/react/release/index.android.bundle.map'), 'utf8'));
const auditedDemoSources = validateAuditedBundleSources(map);
const assetRegistry=validateAssetRegistryBundle(map);
const entries = run('unzip', ['-Z1', apk]).trim().split('\n');
const imageEntries=[];
for (const entry of entries.filter(e => !e.endsWith('/'))) {
  const bytes = run('unzip', ['-p', apk, entry], app, true);
  if(/\.(png|jpe?g)$/i.test(entry))imageEntries.push(bytes);
  const text = bytes.toString('latin1');
  if (/fimcsrivizpliiuoqopv|supabase\.co|sb_publishable_|sb_secret_|SupabaseService|OperatorSessionService|CloudSyncService|RuntimeNativeLeaseHeartbeat|C11_PHYSICAL|ADMIN_API_RAW_RESPONSE_ACCEPTANCE/.test(text)) throw new Error('OFFLINE_DEMO_PRODUCTION_MARKER_PRESENT');
}
const actual = { packageId: match?.[1], versionCode: Number(match?.[2]), versionName: match?.[3],
  certificate: /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(cert)?.[1]?.toLowerCase(), signatureVerified: cert.includes('Verified using v'),
  debuggable: badging.includes('application-debuggable'), manifestIsolation: validateManifestDump(manifestDump, badging),
  productionMarkersAbsent: true, bundledApplicationGraphVerified: true, auditedDemoSources, auditedBundleContentsVerified: true,
  auditedDemoAssets:validatePackagedDemoAssets(imageEntries),assetRegistry,assetRegistryBundleVerified:true };
validateArtifact(policy, embedded, actual);
const output = path.join(app, 'dist');
fs.mkdirSync(output, { recursive: true });
const filename = `RussiCaptor-DEMO-Android-${policy.applicationVersion}-v${policy.versionCode}.apk`;
const target = path.join(output, filename);
if (fs.existsSync(target)) throw new Error('OFFLINE_DEMO_ARTIFACT_ALREADY_EXISTS');
fs.copyFileSync(apk, target);
const result = { ...evidence, artifactFilename: filename, artifactSha256: crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),
  ...actual, buildValidity: 'PASS', signingVerification: 'PASS', physicalAcceptance: 'NOT_TESTED', architectures: ['arm64-v8a'], moduleCount: map.sources.length };
for (const [file, content] of [['offline-demo-manifest.json', JSON.stringify(result, null, 2)], ['AndroidManifest.aapt.txt', manifestDump],
  ['apk-badging.txt', badging], ['signature.txt', cert], ['bundle-sources.json', JSON.stringify(map.sources, null, 2)]]) fs.writeFileSync(path.join(output, file), content + '\n');
console.log(JSON.stringify({ status: 'PASS', artifact: target, sha256: result.artifactSha256, certificate: actual.certificate }));
