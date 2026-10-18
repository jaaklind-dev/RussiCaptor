import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { assertOfflineEnvironment, SHARED_SOURCES, AUDITED_DEMO_SOURCES, assertAuditedDemoSource, AUDITED_DEMO_ASSETS, assertAuditedDemoAsset,
  ASSET_REGISTRY, verifyAssetRegistry, assertAssetRegistryBytes } = require('../offline-demo/isolation-policy.cjs');
const demoRoot = fileURLToPath(new URL('../offline-demo/', import.meta.url));
export function verifyAuditedAssetRegistry() {
  verifyAssetRegistry(path.join(demoRoot,'../node_modules'));
  return {...ASSET_REGISTRY};
}
function validRegistryIdentity(value) {
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===Object.keys(ASSET_REGISTRY).length&&
    Object.entries(ASSET_REGISTRY).every(([key,expected])=>value[key]===expected);
}
export function validateAssetRegistryBundle(map) {
  if(!map||!Array.isArray(map.sources)||!Array.isArray(map.sourcesContent)||map.sources.length!==map.sourcesContent.length)
    throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_BUNDLE_INVALID');
  const indices=map.sources.flatMap((source,index)=>{
    const normalized=String(source).replaceAll('\\','/');
    return normalized.endsWith('/node_modules/'+ASSET_REGISTRY.relativePath)||normalized==='node_modules/'+ASSET_REGISTRY.relativePath?[index]:[];
  });
  if(indices.length!==1||typeof map.sourcesContent[indices[0]]!=='string')throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_BUNDLE_INVALID');
  assertAssetRegistryBytes(map.sourcesContent[indices[0]]);
  return verifyAuditedAssetRegistry();
}
export function verifyAuditedDemoSources(root = demoRoot) {
  for (const relative of Object.keys(AUDITED_DEMO_SOURCES)) {
    assertAuditedDemoSource(relative, fs.readFileSync(path.join(root, relative)));
  }
  return { ...AUDITED_DEMO_SOURCES };
}
export function verifyAuditedDemoAssets(root=demoRoot) {
  for(const file of Object.keys(AUDITED_DEMO_ASSETS))assertAuditedDemoAsset(file,fs.readFileSync(path.join(root,file)));
  return {...AUDITED_DEMO_ASSETS};
}
function validAssetIdentities(value) {
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===Object.keys(AUDITED_DEMO_ASSETS).length&&
    Object.entries(AUDITED_DEMO_ASSETS).every(([file,hash])=>value[file]===hash);
}
export function validatePackagedDemoAssets(entries) {
  const hashes=new Set(entries.map(bytes=>crypto.createHash('sha256').update(bytes).digest('hex')));
  if(!Object.values(AUDITED_DEMO_ASSETS).every(hash=>hashes.has(hash)))throw new Error('OFFLINE_DEMO_PACKAGED_ASSET_MISMATCH');
  return {...AUDITED_DEMO_ASSETS};
}
function validAuditedIdentities(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === Object.keys(AUDITED_DEMO_SOURCES).length &&
    Object.entries(AUDITED_DEMO_SOURCES).every(([file, hash]) => Object.hasOwn(value, file) && value[file] === hash);
}
export const EMBEDDED = 'assets/offline-demo-build.json';
const productionCertificate = 'b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b';
export function validatePolicy(policy, environment = {}) {
  assertOfflineEnvironment(environment);
  if (policy.schemaVersion !== 1 || policy.buildMode !== 'offline-demo' || policy.packageId !== 'com.jaaklind.RussiCaptor.demo' ||
      policy.applicationVersion !== '0.4.0' || !Number.isSafeInteger(policy.versionCode) || policy.versionCode < 1 ||
      !/^[a-f0-9]{64}$/.test(policy.signingCertificateSha256) || policy.signingCertificateSha256 === productionCertificate ||
      policy.productionCompatibility !== 'NOT_APPLICABLE' || policy.distributable !== false ||
      policy.automaticPublication !== false || policy.publicationAuthorization !== 'NOT_GRANTED') throw new Error('OFFLINE_DEMO_BUILD_POLICY_INVALID');
  return policy;
}
export function validateArtifact(policy, embedded, actual) {
  validatePolicy(policy);
  verifyAuditedDemoSources();
  verifyAuditedDemoAssets();
  verifyAuditedAssetRegistry();
  if(!validRegistryIdentity(embedded.assetRegistry)||!validRegistryIdentity(actual.assetRegistry)||actual.assetRegistryBundleVerified!==true)
    throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_IDENTITY_INVALID');
  if(!validAssetIdentities(embedded.auditedDemoAssets)||!validAssetIdentities(actual.auditedDemoAssets))throw new Error('OFFLINE_DEMO_ASSET_IDENTITY_INVALID');
  if (!validAuditedIdentities(embedded.auditedDemoSources) || !validAuditedIdentities(actual.auditedDemoSources) || actual.auditedBundleContentsVerified !== true) {
    throw new Error('OFFLINE_DEMO_EMBEDDED_MODULE_IDENTITY_INVALID');
  }
  for (const key of Object.keys(policy)) if (embedded[key] !== policy[key]) throw new Error('OFFLINE_DEMO_EMBEDDED_IDENTITY_INVALID');
  if (!/^[a-f0-9]{40}$/.test(embedded.sourceCommit) || embedded.sourceDirty !== false || !Number.isFinite(Date.parse(embedded.buildTimestamp))) throw new Error('OFFLINE_DEMO_SOURCE_IDENTITY_INVALID');
  if (actual.packageId !== policy.packageId || actual.versionCode !== policy.versionCode || actual.versionName !== policy.applicationVersion ||
      actual.certificate !== policy.signingCertificateSha256 || actual.signatureVerified !== true || actual.debuggable !== false ||
      actual.manifestIsolation !== true || actual.productionMarkersAbsent !== true || actual.bundledApplicationGraphVerified !== true) throw new Error('OFFLINE_DEMO_ARTIFACT_INVALID');
  return { status: 'PASS', productionCompatibility: 'NOT_APPLICABLE', distributable: false, publicationAuthorization: 'NOT_GRANTED' };
}
export function validateBundleSources(sources) {
  if (!Array.isArray(sources) || !sources.length) throw new Error('OFFLINE_DEMO_BUNDLE_GRAPH_MISSING');
  const audited = {};
  for (const source of sources) {
    const s = source.replaceAll('\\', '/');
    if (['\0polyfill:external-require', '\0polyfill:assets-registry'].includes(s)) continue;
    if (/supabase|expo-router|CloudSync|OperatorSession|RuntimeNativeLeaseHeartbeat|RuntimeCheckpoint|SupabaseService/i.test(s)) throw new Error('OFFLINE_DEMO_BUNDLE_PRODUCTION_MODULE');
    const own = s.replace(/^(?:\.\/|\/)/, '');
    if(Object.hasOwn(AUDITED_DEMO_ASSETS,own)){assertAuditedDemoAsset(own,fs.readFileSync(path.join(demoRoot,own)));continue;}
    if (Object.hasOwn(AUDITED_DEMO_SOURCES, own)) {
      assertAuditedDemoSource(own, fs.readFileSync(path.join(demoRoot, own)));
      audited[own] = AUDITED_DEMO_SOURCES[own];
      continue;
    }
    const shared = Object.keys(SHARED_SOURCES).some(file => [file, `/${file}`, `../${file}`, `/../${file}`].includes(s));
    if (!s.includes('/node_modules/') && !shared && !/^(?:\.\/|\/)?(?:index\.js|src\/(?:DemoApp\.tsx|DemoApplication\.tsx|DemoStore\.ts|DemoUpgrade\.ts|networkBoundary\.ts|runtime\/(?:DemoDomain\.ts|DemoSession\.ts|DemoController\.ts|DemoRuntimeApplication\.tsx)))$/.test(s)) throw new Error('OFFLINE_DEMO_BUNDLE_SOURCE_ESCAPE');
  }
  return audited;
}
export function validateAuditedBundleSources(map) {
  if (!map || !Array.isArray(map.sourcesContent) || !Array.isArray(map.sources) || map.sourcesContent.length !== map.sources.length) {
    throw new Error('OFFLINE_DEMO_BUNDLE_CONTENT_MISSING');
  }
  const audited = validateBundleSources(map.sources);
  if (!validAuditedIdentities(audited)) throw new Error('OFFLINE_DEMO_BUNDLE_AUDITED_MODULE_MISSING');
  for (const [index, source] of map.sources.entries()) {
    const own = source.replaceAll('\\', '/').replace(/^(?:\.\/|\/)/, '');
    if (Object.hasOwn(AUDITED_DEMO_SOURCES, own)) {
      if (typeof map.sourcesContent[index] !== 'string') throw new Error('OFFLINE_DEMO_BUNDLE_CONTENT_MISSING');
      assertAuditedDemoSource(own, map.sourcesContent[index]);
    }
  }
  return audited;
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
