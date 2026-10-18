import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { assertOfflineEnvironment } = require('../offline-demo/isolation-policy.cjs');
export const EMBEDDED = 'assets/offline-demo-build.json';
const productionCertificate = 'b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b';
export function validatePolicy(policy, environment = {}) {
  assertOfflineEnvironment(environment);
  if (policy.schemaVersion !== 1 || policy.buildMode !== 'offline-demo' || policy.packageId !== 'com.jaaklind.RussiCaptor.demo' ||
      policy.applicationVersion !== '0.1.0' || !Number.isSafeInteger(policy.versionCode) || policy.versionCode < 1 ||
      !/^[a-f0-9]{64}$/.test(policy.signingCertificateSha256) || policy.signingCertificateSha256 === productionCertificate ||
      policy.productionCompatibility !== 'NOT_APPLICABLE' || policy.distributable !== false ||
      policy.automaticPublication !== false || policy.publicationAuthorization !== 'NOT_GRANTED') throw new Error('OFFLINE_DEMO_BUILD_POLICY_INVALID');
  return policy;
}
export function validateArtifact(policy, embedded, actual) {
  validatePolicy(policy);
  for (const key of Object.keys(policy)) if (embedded[key] !== policy[key]) throw new Error('OFFLINE_DEMO_EMBEDDED_IDENTITY_INVALID');
  if (!/^[a-f0-9]{40}$/.test(embedded.sourceCommit) || embedded.sourceDirty !== false || !Number.isFinite(Date.parse(embedded.buildTimestamp))) throw new Error('OFFLINE_DEMO_SOURCE_IDENTITY_INVALID');
  if (actual.packageId !== policy.packageId || actual.versionCode !== policy.versionCode || actual.versionName !== policy.applicationVersion ||
      actual.certificate !== policy.signingCertificateSha256 || actual.signatureVerified !== true || actual.debuggable !== false ||
      actual.manifestIsolation !== true || actual.productionMarkersAbsent !== true || actual.bundledApplicationGraphVerified !== true) throw new Error('OFFLINE_DEMO_ARTIFACT_INVALID');
  return { status: 'PASS', productionCompatibility: 'NOT_APPLICABLE', distributable: false, publicationAuthorization: 'NOT_GRANTED' };
}
export function validateBundleSources(sources) {
  if (!Array.isArray(sources) || !sources.length) throw new Error('OFFLINE_DEMO_BUNDLE_GRAPH_MISSING');
  for (const source of sources) {
    const s = source.replaceAll('\\', '/');
    if (['\0polyfill:external-require', '\0polyfill:assets-registry'].includes(s)) continue;
    if (/supabase|expo-router|CloudSync|OperatorSession|RuntimeNativeLeaseHeartbeat|RuntimeCheckpoint|SupabaseService/i.test(s)) throw new Error('OFFLINE_DEMO_BUNDLE_PRODUCTION_MODULE');
    if (!s.includes('/node_modules/') && !/^(?:\.\/|\/)?(?:index\.js|src\/(?:DemoApp\.tsx|DemoApplication\.tsx|DemoStore\.ts|networkBoundary\.ts))$/.test(s)) throw new Error('OFFLINE_DEMO_BUNDLE_SOURCE_ESCAPE');
  }
}
// Parse aapt's actual binary AndroidManifest.xml dump, not generated source XML.
export function validateManifestDump(dump, badging) {
  if (/application-debuggable|uses-permission[^\n]*android\.permission\.|sharedUserId/.test(badging + dump)) throw new Error('OFFLINE_DEMO_MANIFEST_PERMISSION_INVALID');
  const activityOffset = dump.indexOf('E: activity ');
  if (activityOffset < 0 || /android.intent.action.VIEW|android.intent.category.BROWSABLE|android:scheme/.test(dump.slice(activityOffset))) throw new Error('OFFLINE_DEMO_MANIFEST_DEEP_LINK_INVALID');
  if (!dump.includes('android.intent.action.MAIN') || !dump.includes('android.intent.category.LAUNCHER') ||
      !/android:allowBackup[^\n]*0x0\b/.test(dump) || !badging.includes("application-label:'RussiCaptor DEMO'")) throw new Error('OFFLINE_DEMO_MANIFEST_IDENTITY_INVALID');
  return true;
}
