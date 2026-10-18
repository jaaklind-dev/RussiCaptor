import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const policy = JSON.parse(fs.readFileSync(path.join(root, 'offline-demo/build-policy.json'), 'utf8'));
function evaluate(expression: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `import {validatePolicy,validateArtifact,validateBundleSources,validateManifestDump} from './scripts/offline-demo-build-policy.mjs';const policy=${JSON.stringify(policy)};${expression}`], { cwd: root, encoding: 'utf8' });
}
const embedded = { ...policy, sourceCommit: 'a'.repeat(40), sourceDirty: false, buildTimestamp: '2026-10-18T12:00:00.000Z' };
const actual = { packageId: policy.packageId, versionCode: policy.versionCode, versionName: policy.applicationVersion, certificate: policy.signingCertificateSha256,
  signatureVerified: true, debuggable: false, manifestIsolation: true, productionMarkersAbsent: true, bundledApplicationGraphVerified: true };
describe('dedicated signed offline-demo build contract', () => {
  test('independent demo policy permits no migration dependency', () => {
    expect(evaluate('validatePolicy(policy);').status).toBe(0);
    expect(policy).toMatchObject({ productionCompatibility: 'NOT_APPLICABLE', distributable: false, publicationAuthorization: 'NOT_GRANTED', versionCode: 3 });
  });
  test.each([{ buildMode: 'canonical' }, { buildMode: 'upgrade-validation' }, { packageId: 'com.jaaklind.RussiCaptor' },
    { signingCertificateSha256: 'b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b' }, { distributable: true },
    { publicationAuthorization: 'GRANTED' }, { automaticPublication: true }, { productionCompatibility: 'PASS' }, { versionCode: 0 }])('rejects invalid policy %j', patch => {
    expect(evaluate(`validatePolicy({...policy,...${JSON.stringify(patch)}});`).status).not.toBe(0);
  });
  test('backend environment cannot enter native build', () => {
    const result = evaluate("validatePolicy(policy,{EXPO_PUBLIC_SUPABASE_URL:'DO_NOT_ECHO_SECRET'});");
    expect(result.status).not.toBe(0); expect(result.stderr).not.toContain('DO_NOT_ECHO_SECRET');
  });
  test('actual artifact evidence agrees with signed embedded policy', () => {
    expect(evaluate(`validateArtifact(policy,${JSON.stringify(embedded)},${JSON.stringify(actual)});`).status).toBe(0);
  });
  test.each([{ certificate: '0'.repeat(64) }, { signatureVerified: false }, { debuggable: true }, { packageId: 'com.jaaklind.RussiCaptor' },
    { versionCode: 181 }, { manifestIsolation: false }, { productionMarkersAbsent: false }, { bundledApplicationGraphVerified: false }])('artifact mismatch fails closed %j', patch => {
    expect(evaluate(`validateArtifact(policy,${JSON.stringify(embedded)},{...${JSON.stringify(actual)},...${JSON.stringify(patch)}});`).status).not.toBe(0);
  });
  test('sidecar edits cannot promote signed demo evidence', () => {
    expect(evaluate(`validateArtifact({...policy,distributable:true},${JSON.stringify(embedded)},${JSON.stringify(actual)});`).status).not.toBe(0);
    expect(evaluate(`validateArtifact(policy,{...${JSON.stringify(embedded)},buildMode:'canonical'},${JSON.stringify(actual)});`).status).not.toBe(0);
  });
  test.each(['../src/services/SupabaseService.ts', '/node_modules/@supabase/supabase-js/index.js', '../src/services/CloudSyncService.ts', '/node_modules/expo-router/entry.js', '../app/index.tsx'])('bundled graph rejects production source %s', source => {
    expect(evaluate(`validateBundleSources(${JSON.stringify([source])});`).status).not.toBe(0);
  });
  test('bundle allows only own application graph and checked libraries', () => {
    expect(evaluate("validateBundleSources(['index.js','/src/DemoApp.tsx','/node_modules/react/index.js','\\0polyfill:assets-registry','\\0polyfill:external-require']);").status).toBe(0);
  });
  test('unknown virtual bundle module is not whitelisted', () => expect(evaluate("validateBundleSources(['\\0polyfill:production']);").status).not.toBe(0));
  test('Metro accepts the exact SDK-generated virtual registry, not arbitrary virtual or production modules', () => {
    jest.isolateModules(() => {
      jest.doMock('expo/metro-config', () => ({ getDefaultConfig: () => ({ resolver: {} }) }));
      const resolver = require('../../offline-demo/metro.config.cjs').resolver.resolveRequest;
      const context = { originModulePath: path.join(root, 'offline-demo/index.js'), resolveRequest: () => ({ type: 'sourceFile', filePath: '\0polyfill:assets-registry' }) };
      expect(resolver(context, 'react', 'android').filePath).toBe('\0polyfill:assets-registry');
      expect(() => resolver(context, '@supabase/supabase-js', 'android')).toThrow('OFFLINE_DEMO_PRODUCTION_MODULE_FORBIDDEN');
      expect(() => resolver({ ...context, resolveRequest: () => ({ type: 'sourceFile', filePath: '\0polyfill:unknown' }) }, 'react', 'android')).toThrow();
      expect(() => resolver({ ...context, resolveRequest: () => ({ type: 'sourceFile', filePath: path.join(root, 'src/services/SupabaseService.ts') }) }, 'react', 'android')).toThrow();
      jest.dontMock('expo/metro-config');
    });
  });
  const manifest = 'A: android:allowBackup(0x01010280)=(type 0x12)0x0\nE: activity (line=1)\nandroid.intent.action.MAIN\nandroid.intent.category.LAUNCHER';
  const badging = "application-label:'RussiCaptor DEMO'";
  test('actual merged manifest contract permits launcher only', () => expect(evaluate(`validateManifestDump(${JSON.stringify(manifest)},${JSON.stringify(badging)});`).status).toBe(0));
  test.each(['uses-permission: name=\'android.permission.INTERNET\'', 'application-debuggable'])('rejects unsafe actual APK badging %s', extra => {
    expect(evaluate(`validateManifestDump(${JSON.stringify(manifest)},${JSON.stringify(badging + '\n' + extra)});`).status).not.toBe(0);
  });
  test.each(['android:scheme', 'android.intent.action.VIEW', 'android.intent.category.BROWSABLE', 'android:sharedUserId'])('rejects actual manifest escape %s', extra => {
    expect(evaluate(`validateManifestDump(${JSON.stringify(manifest + '\n' + extra)},${JSON.stringify(badging)});`).status).not.toBe(0);
  });
  test('signing passwords use Keychain and child environment, never argv or repository secrets', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/demo-signing.mjs'), 'utf8');
    expect(source).toContain('crypto.randomBytes(32)'); expect(source).toContain('-storepass:env');
    expect(source).toContain("['-i'], { input:"); expect(source).not.toContain('field-release.store-password');
    expect(source).not.toContain('field-release.key-password');
    const build = fs.readFileSync(path.join(root, 'scripts/build-offline-demo.mjs'), 'utf8');
    expect(build).toContain('EXPO_NO_DOTENV'); expect(build).not.toContain('verify-field-release-config');
    expect(build).not.toContain('build-field-release.mjs'); expect(build).not.toContain('supabase db');
  });
  test('demo runtime reuses only the six hash-pinned pure sources and cannot widen on source tampering', () => {
    const { SHARED_SOURCES } = require('../../offline-demo/isolation-policy.cjs');
    expect(Object.keys(SHARED_SOURCES)).toHaveLength(6);
    jest.isolateModules(() => {
      jest.doMock('expo/metro-config', () => ({ getDefaultConfig: () => ({ resolver: {} }) }));
      const resolver = require('../../offline-demo/metro.config.cjs').resolver.resolveRequest;
      const target = path.join(root, 'src/services/runtime/HemorrhagePatientProcess.ts');
      const context = { originModulePath: path.join(root, 'offline-demo/src/runtime/DemoDomain.ts'), resolveRequest: () => ({ type: 'sourceFile', filePath: target }) };
      expect(resolver(context, '../../../src/services/runtime/HemorrhagePatientProcess', 'android').filePath).toBe(target);
      const original = fs.readFileSync.bind(fs); const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...args: any[]) =>
        String(file) === target ? Buffer.from('require("production-side-effect")') : (original as any)(file, ...args)) as any);
      expect(() => resolver(context, '../../../src/services/runtime/HemorrhagePatientProcess', 'android')).toThrow('OFFLINE_DEMO_SOURCE_ESCAPE_FORBIDDEN');
      spy.mockRestore(); jest.dontMock('expo/metro-config');
    });
  });
  test('new demo version metadata agrees without changing the canonical version', () => {
    const config = require('../../offline-demo/app.config.cjs')(); const pkg = require('../../offline-demo/package.json');
    expect(config.version).toBe(policy.applicationVersion); expect(config.android.versionCode).toBe(policy.versionCode); expect(pkg.version).toBe('0.2.1');
    expect(require('../../app.json').expo.android.versionCode).toBe(181);
  });
});
