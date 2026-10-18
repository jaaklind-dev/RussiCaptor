import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const {ASSET_REGISTRY,AUDITED_DEMO_ASSETS,verifyAssetRegistry,assertSpecifier}=require('../../offline-demo/isolation-policy.cjs');
const root=process.cwd(),modules=fs.realpathSync(path.join(root,'node_modules'));
const registry=verifyAssetRegistry(modules),bytes=fs.readFileSync(registry.filePath,'utf8');
const generate=require('metro/private/Bundler/util').generateAssetCodeFileAst;
const print=require('@babel/generator').default;
const run=(code:string)=>spawnSync(process.execPath,['--input-type=module','-e',`import {validateAssetRegistryBundle} from './scripts/offline-demo-build-policy.mjs';${code}`],{cwd:root,encoding:'utf8'});
function resolver(){let result:any;jest.isolateModules(()=>{
  jest.doMock('expo/metro-config',()=>({getDefaultConfig:()=>({resolver:{}})}));
  result=require('../../offline-demo/metro.config.cjs').resolver.resolveRequest;
});return result;}
function context(origin:string,target=registry.filePath){return {originModulePath:origin,resolveRequest:()=>({type:'sourceFile',filePath:target})};}
afterEach(()=>{jest.restoreAllMocks();jest.dontMock('expo/metro-config');});
describe('exact audited Metro-generated asset registry',()=>{
  test('installed version/hash is pinned; actual source executes without require, network or storage globals',()=>{
    expect(registry).toMatchObject({version:'0.86.0',sha256:'4edff3064f1d79e8a0dd866b9163e13fbb48bec4d3a832ad7673b076d799bd7c'});
    const sandbox={module:{exports:{} as any}};vm.runInNewContext(bytes,sandbox);
    const api=sandbox.module.exports,a={name:'a'},b={name:'b'};
    expect(Object.keys(api).sort()).toEqual(['getAssetByID','registerAsset']);
    expect(api.registerAsset(a)).toBe(1);expect(api.registerAsset(b)).toBe(2);
    expect(api.getAssetByID(1)).toBe(a);expect(api.getAssetByID(2)).toBe(b);expect(api.getAssetByID(3)).toBeUndefined();
  });
  test.each(Object.keys(AUDITED_DEMO_ASSETS))('real Metro-generated require is accepted only for approved %s',file=>{
    const resolve=resolver(),origin=path.join(root,'offline-demo',file),sandbox={module:{exports:undefined as unknown},require:(specifier:string)=>{
      expect(resolve(context(origin),specifier,'android').filePath).toBe(registry.filePath);
      const registrySandbox={module:{exports:{}}};vm.runInNewContext(bytes,registrySandbox);return registrySandbox.module.exports;
    }};
    const ast=generate(ASSET_REGISTRY.specifier,{__packager_asset:true,width:1280,height:948,scales:[1],hash:AUDITED_DEMO_ASSETS[file],name:path.basename(file),type:path.extname(file).slice(1)});
    vm.runInNewContext(print(ast).code,sandbox);expect(sandbox.module.exports).toBe(1);
  });
  test.each(['@react-native/assets-registry/unknown','@react-native/unknown','https://example.invalid/image.jpg','./unsafe'])('generated image cannot require %s',specifier=>{
    const resolve=resolver(),origin=path.join(root,'offline-demo/assets/imaging/pelvis-generated.jpg');
    expect(()=>resolve(context(origin),specifier,'android')).toThrow('OFFLINE_DEMO_IMPORT_FORBIDDEN');
  });
  test('registry is not a new application-level external; wrong resolved target is rejected',()=>{
    expect(()=>assertSpecifier(ASSET_REGISTRY.specifier)).toThrow('OFFLINE_DEMO_IMPORT_FORBIDDEN');
    const resolve=resolver(),origin=path.join(root,'offline-demo/assets/imaging/pelvis-generated.jpg');
    expect(()=>resolve(context(origin,path.join(root,'offline-demo/index.js')),ASSET_REGISTRY.specifier,'android')).toThrow('OFFLINE_DEMO_ASSET_REGISTRY_PATH_INVALID');
  });
  test('modified approved image and unapproved local image are rejected by actual resolver',()=>{
    const resolve=resolver(),origin=path.join(root,'offline-demo/assets/imaging/pelvis-generated.jpg'),read=fs.readFileSync.bind(fs);
    const spy=jest.spyOn(fs,'readFileSync').mockImplementation(((file:any,...args:any[])=>String(file)===origin?Buffer.from('tampered'):(read as any)(file,...args)) as any);
    expect(()=>resolve(context(origin),ASSET_REGISTRY.specifier,'android')).toThrow('OFFLINE_DEMO_ASSET_HASH_INVALID');spy.mockRestore();
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'demo-registry-unknown-')),unknown=path.join(tmp,'unknown.jpg');fs.writeFileSync(unknown,'not approved');
    expect(()=>resolve(context(unknown),ASSET_REGISTRY.specifier,'android')).toThrow('OFFLINE_DEMO_ASSET_HASH_INVALID');
  });
  test.each(['@/services/OperatorSessionService','@/services/CloudSyncService','@/services/runtime/RuntimeNativeLeaseHeartbeat','@supabase/supabase-js'])('modified registry importing %s fails hash audit before use',dependency=>{
    const resolve=resolver(),origin=path.join(root,'offline-demo/assets/imaging/pelvis-generated.jpg'),read=fs.readFileSync.bind(fs);
    jest.spyOn(fs,'readFileSync').mockImplementation(((file:any,...args:any[])=>String(file)===registry.filePath?Buffer.from(bytes+`\nrequire(${JSON.stringify(dependency)})`):(read as any)(file,...args)) as any);
    expect(()=>resolve(context(origin),ASSET_REGISTRY.specifier,'android')).toThrow('OFFLINE_DEMO_ASSET_REGISTRY_HASH_INVALID');
  });
  test('registry version/metadata drift and transitive dependency resolution fail closed',()=>{
    const resolve=resolver(),read=fs.readFileSync.bind(fs),metadata=path.join(modules,'@react-native/assets-registry/package.json');
    const spy=jest.spyOn(fs,'readFileSync').mockImplementation(((file:any,...args:any[])=>String(file)===metadata?Buffer.from('{}'):(read as any)(file,...args)) as any);
    expect(()=>verifyAssetRegistry(modules)).toThrow('OFFLINE_DEMO_ASSET_REGISTRY_PACKAGE_INVALID');spy.mockRestore();
    expect(()=>resolve(context(registry.filePath),'./unsafe','android')).toThrow('OFFLINE_DEMO_ASSET_REGISTRY_DEPENDENCY_FORBIDDEN');
  });
  test('bundled source content must match the audited registry; missing, duplicate and forged source fail',()=>{
    const map={sources:[registry.filePath],sourcesContent:[bytes]};
    expect(run(`validateAssetRegistryBundle(${JSON.stringify(map)});`).status).toBe(0);
    for(const bad of [{sources:[],sourcesContent:[]},{sources:map.sources,sourcesContent:[null]},
      {sources:map.sources,sourcesContent:[bytes+'\nrequire("unsafe")']},{sources:[...map.sources,...map.sources],sourcesContent:[bytes,bytes]}]){
      const r=run(`validateAssetRegistryBundle(${JSON.stringify(bad)});`);expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/OFFLINE_DEMO_ASSET_REGISTRY_(BUNDLE|HASH)_INVALID/);
    }
  });
});
