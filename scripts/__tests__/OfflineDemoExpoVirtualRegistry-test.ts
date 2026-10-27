import {spawnSync} from 'node:child_process';
const run=(code:string)=>spawnSync(process.execPath,['--input-type=module','-e',`
import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
const policy=require('./offline-demo/isolation-policy.cjs');
const {createExpoRegistryProbe}=require('./scripts/lib/offline-demo-expo-registry-probe.cjs');
import {validateAssetRegistryBundle,validatePackagedBundle} from './scripts/offline-demo-build-policy.mjs';
const origin=path.resolve('offline-demo/assets/imaging/pelvis-generated.jpg');
${code}`],{cwd:process.cwd(),encoding:'utf8',maxBuffer:4*1024*1024});
describe('actual installed Expo resolver and generated virtual source',()=>{
  test('both approved images resolve through actual Expo code; no filesystem call receives NUL',()=>{
    const r=run(`const real=fs.realpathSync;fs.realpathSync=(p,...args)=>{if(String(p).includes('\\0'))throw Error('VIRTUAL_FS_ACCESS');return real(p,...args);};
const probe=createExpoRegistryProbe();for(const f of Object.keys(policy.AUDITED_DEMO_ASSETS)){
const result=probe.resolve(path.resolve('offline-demo',f));if(result.filePath!==policy.VIRTUAL_ASSET_REGISTRY.id)throw Error('WRONG_ID');}
const source=probe.source();policy.assertVirtualRegistrySource(source);
console.log(JSON.stringify({source,identity:validateAssetRegistryBundle({sources:[policy.VIRTUAL_ASSET_REGISTRY.id],sourcesContent:[source]})}));`);
    expect(r.status).toBe(0);expect(r.stderr).not.toContain('VIRTUAL_FS_ACCESS');
    expect(JSON.parse(r.stdout).identity.sha256).toBe('08d971df622a4b72fa1799ad924b850d6b014e0f9c5557822399a7ddccf92228');
  });
  test.each(['\0polyfill:unknown','\0polyfill:assets-registry/extra'])('unknown virtual origin %j rejected before filesystem lookup',origin=>{
    const r=run(`createExpoRegistryProbe().resolve(${JSON.stringify(origin)});`);
    expect(r.status).not.toBe(0);expect(r.stderr).toContain('OFFLINE_DEMO_VIRTUAL_MODULE_FORBIDDEN');expect(r.stderr).not.toContain('ERR_INVALID_ARG_VALUE');
  });
  test('exact registry cannot introduce transitive dependencies',()=>{
    const r=run(`createExpoRegistryProbe().resolve(policy.VIRTUAL_ASSET_REGISTRY.id,'./unsafe');`);
    expect(r.stderr).toContain('OFFLINE_DEMO_ASSET_REGISTRY_DEPENDENCY_FORBIDDEN');
  });
  test.each(['offline-demo/index.js','node_modules/react/index.js'])('wrong physical importer %s rejected through actual Expo chain',file=>{
    const r=run(`createExpoRegistryProbe().resolve(path.resolve(${JSON.stringify(file)}));`);
    expect(r.status).not.toBe(0);expect(r.stderr).toMatch(/OFFLINE_DEMO_(IMPORT_FORBIDDEN|REGISTRY_IMPORTER_FORBIDDEN)/);
  });
  test.each(['react-native/Libraries/Image/resolveAssetSource.js','expo-asset/build/Asset.js'])('exact pinned framework importer %s remains supported',file=>{
    const r=run(`const p=createExpoRegistryProbe();p.resolve(fs.realpathSync(path.resolve('node_modules',${JSON.stringify(file)})));policy.assertVirtualRegistrySource(p.source());`);
    expect(r.status).toBe(0);
  });
  test('modified actual generated source, wrong ID, missing or duplicated source rejected',()=>{
    for(const mode of ['modified','wrong-id','missing','duplicate']){
      const r=run(`const p=createExpoRegistryProbe();p.resolve(origin);const src=p.source();let sources=[policy.VIRTUAL_ASSET_REGISTRY.id],sourcesContent=[src];
if(${JSON.stringify(mode)}==='modified')sourcesContent=[src+';require("unsafe")'];
if(${JSON.stringify(mode)}==='wrong-id')sources=['\\0polyfill:unknown'];
if(${JSON.stringify(mode)}==='missing'){sources=[];sourcesContent=[];}
if(${JSON.stringify(mode)}==='duplicate'){sources.push(sources[0]);sourcesContent.push(src);}
validateAssetRegistryBundle({sources,sourcesContent});`);
      expect(r.status).not.toBe(0);expect(r.stderr).toMatch(/OFFLINE_DEMO_(VIRTUAL_SOURCE_HASH_INVALID|ASSET_REGISTRY_BUNDLE_INVALID)/);
    }
  });
  test('producer drift fails before loading Expo code',()=>{
    const r=run(`const read=fs.readFileSync;fs.readFileSync=(p,...args)=>String(p).endsWith(policy.VIRTUAL_ASSET_REGISTRY.producerRelativePath)?'changed producer':read(p,...args);createExpoRegistryProbe();`);
    expect(r.stderr).toContain('OFFLINE_DEMO_VIRTUAL_PRODUCER_INVALID');
  });
  test('modified approved image and unapproved image fail through actual resolver',()=>{
    const modified=run(`const read=fs.readFileSync;fs.readFileSync=(p,...args)=>String(p)===origin?Buffer.from('tampered'):read(p,...args);createExpoRegistryProbe().resolve(origin);`);
    expect(modified.stderr).toContain('OFFLINE_DEMO_ASSET_HASH_INVALID');
    const unknown=run(`const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-expo-asset-'));const file=path.join(dir,'unknown.jpg');fs.writeFileSync(file,'unknown');createExpoRegistryProbe().resolve(file);`);
    expect(unknown.stderr).toContain('OFFLINE_DEMO_ASSET_HASH_INVALID');
  });
  test.each(['@/services/SupabaseService','@/services/OperatorSessionService','@/services/CloudSyncService','@/services/runtime/RuntimeNativeLeaseHeartbeat','https://example.invalid/x.png'])('unsafe import %s rejected by actual Expo chain',specifier=>{
    const r=run(`createExpoRegistryProbe().resolve(origin,${JSON.stringify(specifier)});`);
    expect(r.status).not.toBe(0);expect(r.stderr).toMatch(/OFFLINE_DEMO_(PRODUCTION_MODULE_FORBIDDEN|IMPORT_FORBIDDEN)/);
  });
  test('APK bundle bytes must match the bundle generated alongside verified source map',()=>{
    expect(run(`validatePackagedBundle(Buffer.from('verified'),Buffer.from('verified'));`).status).toBe(0);
    expect(run(`validatePackagedBundle(Buffer.from('changed'),Buffer.from('verified'));`).stderr).toContain('OFFLINE_DEMO_PACKAGED_BUNDLE_MISMATCH');
  });
});
