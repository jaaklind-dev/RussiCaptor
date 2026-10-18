import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const { AUDITED_DEMO_SOURCES, assertAuditedDemoSource } = require('../../offline-demo/isolation-policy.cjs');
const files = ['src/runtime/DemoVitalsCard.tsx', 'src/runtime/DemoTime.ts',
  'src/runtime/DemoLaboratoryCard.tsx', 'src/runtime/DemoLaboratory.ts'];
function evaluate(code: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {validateBundleSources,verifyAuditedDemoSources,validateAuditedBundleSources} from './scripts/offline-demo-build-policy.mjs';${code}`], { cwd: root, encoding: 'utf8' });
}
describe('exact audited offline-demo bundle sources', () => {
  test('only the four audited modules are added, each with its exact source hash', () => {
    expect(Object.keys(AUDITED_DEMO_SOURCES).sort()).toEqual([...files].sort());
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(root, 'offline-demo', file));
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(AUDITED_DEMO_SOURCES[file]);
      expect(() => assertAuditedDemoSource(file, bytes)).not.toThrow();
    }
    const sources = JSON.stringify(files.map(file => '/' + file));
    const r = evaluate(`console.log(JSON.stringify(validateBundleSources(${sources})));`);
    expect(r.status).toBe(0); expect(JSON.parse(r.stdout)).toEqual(AUDITED_DEMO_SOURCES);
  });
  test.each(files)('modified %s fails at source verification, Metro, and bundle verification', file => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-audited-hash-'));
    for (const source of files) {
      const destination = path.join(dir, source); fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, 'offline-demo', source), destination);
    }
    fs.appendFileSync(path.join(dir, file), '\n// changed after audit');
    const graph = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {verifyDemoGraph} from './scripts/verify-offline-demo.mjs';verifyDemoGraph(${JSON.stringify(dir)},${JSON.stringify(file)});`], {cwd:root,encoding:'utf8'});
    expect(graph.status).not.toBe(0); expect(graph.stderr).toContain('OFFLINE_DEMO_AUDITED_SOURCE_HASH_INVALID');
    const r = evaluate(`verifyAuditedDemoSources(${JSON.stringify(dir)});`);
    expect(r.status).not.toBe(0); expect(r.stderr).toContain('OFFLINE_DEMO_AUDITED_SOURCE_HASH_INVALID');
    jest.isolateModules(() => {
      jest.doMock('expo/metro-config', () => ({ getDefaultConfig: () => ({ resolver: {} }) }));
      const resolver = require('../../offline-demo/metro.config.cjs').resolver.resolveRequest;
      const target = path.join(root, 'offline-demo', file);
      const original = fs.readFileSync.bind(fs);
      const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(((input: any, ...args: any[]) =>
        String(input) === target ? Buffer.from('require("production-side-effect")') : (original as any)(input, ...args)) as any);
      try {
        expect(() => resolver({ originModulePath: path.join(root, 'offline-demo/index.js'),
          resolveRequest: () => ({ type: 'sourceFile', filePath: target }) }, './src/runtime/' + path.basename(file), 'android'))
          .toThrow('OFFLINE_DEMO_AUDITED_SOURCE_HASH_INVALID');
      } finally { spy.mockRestore(); jest.dontMock('expo/metro-config'); }
    });
    // Exercise the actual bundle validator with a changed source reader, not a
    // source file edit in the repository under test.
    const changed = evaluate(`import fs from 'node:fs';const read=fs.readFileSync.bind(fs);fs.readFileSync=(p,...args)=>String(p)===${JSON.stringify(path.join(root,'offline-demo',file))}?Buffer.from('changed'):read(p,...args);validateBundleSources(${JSON.stringify(['/'+file])});`);
    expect(changed.status).not.toBe(0); expect(changed.stderr).toContain('OFFLINE_DEMO_AUDITED_SOURCE_HASH_INVALID');
  });
  test('actual bundled source contents, not only local filenames, must match all four embedded identities', () => {
    const map = { sources: files.map(f => '/' + f), sourcesContent: files.map(f => fs.readFileSync(path.join(root,'offline-demo',f),'utf8')) };
    expect(evaluate(`validateAuditedBundleSources(${JSON.stringify(map)});`).status).toBe(0);
    for (const index of [0,1,2,3]) {
      const changed = { ...map, sourcesContent: map.sourcesContent.map((text,i) => i===index ? text+'\n// altered bundle input' : text) };
      const r=evaluate(`validateAuditedBundleSources(${JSON.stringify(changed)});`);
      expect(r.status).not.toBe(0);expect(r.stderr).toContain('OFFLINE_DEMO_AUDITED_SOURCE_HASH_INVALID');
    }
    for(const invalid of [{sources:map.sources}, {sources:map.sources.slice(1),sourcesContent:map.sourcesContent.slice(1)},
      {...map,sourcesContent:map.sourcesContent.map(()=>null)}]) {
      expect(evaluate(`validateAuditedBundleSources(${JSON.stringify(invalid)});`).status).not.toBe(0);
    }
  });
  test.each(['/src/runtime/Unknown.ts', '/src/runtime/DemoTime.ts/../Unknown.ts', '/src/runtime/DemoTime.ts.evil',
    '../src/services/SupabaseService.ts', '/src/services/OperatorSessionService.ts', '/src/services/CloudSyncService.ts',
    '/src/services/RuntimeNativeLeaseHeartbeat.ts', '/src/services/RuntimeCheckpointAuthorityService.ts'])('unknown or production bundle source denied: %s', file => {
    expect(evaluate(`validateBundleSources(${JSON.stringify([file])});`).status).not.toBe(0);
  });
  test.each(['@/services/OperatorSessionService','@/services/CloudSyncService','@/services/runtime/RuntimeNativeLeaseHeartbeat'])('transitive production initialization denied: %s', service => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-transitive-denied-'));
    fs.writeFileSync(path.join(dir,'index.js'), "require('./nested')");
    fs.writeFileSync(path.join(dir,'nested.js'), `require(${JSON.stringify(service)})`);
    const result=spawnSync(process.execPath,['--input-type=module','-e',
      `import {verifyDemoGraph} from './scripts/verify-offline-demo.mjs';verifyDemoGraph(${JSON.stringify(dir)});`],{cwd:root,encoding:'utf8'});
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('OFFLINE_DEMO_IMPORT_FORBIDDEN');
  });
});
