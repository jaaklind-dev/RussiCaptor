import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {installOfflineNetworkBoundary} from '../../offline-demo/src/networkBoundary';
const root=process.cwd();
const policy=require('../../offline-demo/isolation-policy.cjs');
const plugin=require('../../offline-demo/plugins/withOfflineDemo.cjs');
const script=path.join(root,'scripts/verify-offline-demo.mjs');
function graph(entry:string){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'offline-demo-negative-'));fs.writeFileSync(path.join(folder,'index.js'),entry);return spawnSync(process.execPath,['--input-type=module','-e',
  `import {verifyDemoGraph} from ${JSON.stringify('file://'+script)}; console.log(JSON.stringify(verifyDemoGraph(process.argv[1])));`,folder],{encoding:'utf8',cwd:root});}
describe('offline demo source and native isolation',()=>{
  test('real entry installs boundary before registration and has no production initializer',()=>{
    const calls:string[]=[];const transport=jest.fn();const target={fetch:transport};const register=jest.fn();
    vm.runInNewContext(fs.readFileSync(path.join(root,'offline-demo/index.js'),'utf8'),{globalThis:target,require:(name:string)=>{
      calls.push(name);
      if(name==='./src/networkBoundary')return {installOfflineNetworkBoundary};
      expect(()=>target.fetch()).toThrow('OFFLINE_DEMO_NETWORK_FORBIDDEN');
      if(name==='expo')return {registerRootComponent:register};
      if(name==='./src/DemoApp')return {default:'ISOLATED_DEMO_APP'};
      throw new Error('PRODUCTION_INITIALIZER_ATTEMPT');
    }});
    expect(calls).toEqual(['./src/networkBoundary','expo','./src/DemoApp']);expect(register).toHaveBeenCalledWith('ISOLATED_DEMO_APP');expect(transport).not.toHaveBeenCalled();
  });
  test('actual demo graph has no production modules',()=>{const r=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8'});expect(r.stderr).toBe('');expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({status:'PASS',productionImports:0,internetPermissionRequested:false,nativeArtifactVerified:false});});
  test.each(["require('@/services/SupabaseService')","import x from '@supabase/supabase-js'","import '@/services/CloudSyncService'","require('@/services/runtime/laboratory/LaboratoryWorkflowRuntime')","require('@/utils/stableJson')","require('@/utils/immutable/../stableJson')","require('expo-router')","require(process.env.MODULE)","import('node:fs')","eval('arbitrary')","const u='https://production.invalid'", "require('../outside-production')"] )('rejects accidental production or dynamic import %s',entry=>{expect(graph(entry).status).not.toBe(0);});
  test('relative transitive production dependency is rejected',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'offline-demo-transitive-'));fs.writeFileSync(path.join(dir,'index.js'),"require('./nested')");fs.writeFileSync(path.join(dir,'nested.js'),"require('@supabase/supabase-js')");const r=spawnSync(process.execPath,['--input-type=module','-e',
    `import {verifyDemoGraph} from ${JSON.stringify('file://'+script)};verifyDemoGraph(process.argv[1]);`,dir],{encoding:'utf8'});expect(r.status).not.toBe(0);});
  test.each(['EXPO_PUBLIC_SUPABASE_URL','EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','RUSSICAPTOR_RELEASE_KEYSTORE','EXPO_PUBLIC_RELEASE_ENVIRONMENT'])('rejects backend/production configuration %s',key=>expect(()=>policy.assertOfflineEnvironment({[key]:'DO_NOT_ECHO_SECRET'})).toThrow('OFFLINE_DEMO_BACKEND_CONFIGURATION_FORBIDDEN'));
  test('isolated environment is allowed',()=>expect(()=>policy.assertOfflineEnvironment({NODE_ENV:'production'})).not.toThrow());
  test('only standard compiler runtime helpers extend the explicit library allowlist',()=>{for(const name of ['react/jsx-runtime','react/compiler-runtime','@babel/runtime/helpers/interopRequireDefault'])expect(()=>policy.assertSpecifier(name)).not.toThrow();for(const name of ['@babel/runtime/../../src/services/SupabaseService','@babel/runtime/other','@supabase/supabase-js'])expect(()=>policy.assertSpecifier(name)).toThrow('OFFLINE_DEMO_IMPORT_FORBIDDEN');});
  test('actual config verifier fails closed without echoing backend values',()=>{const secret='DO_NOT_LOG_BACKEND_VALUE';const result=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8',env:{...process.env,EXPO_PUBLIC_SUPABASE_URL:secret}});expect(result.status).not.toBe(0);expect(result.stderr).toContain('OFFLINE_DEMO_BACKEND_CONFIGURATION_FORBIDDEN');expect(result.stderr).not.toContain(secret);});
  test('manifest merger removes network and deep links while preserving launcher',()=>{const manifest=plugin.hardenManifest({$: {},'uses-permission':[{$:{'android:name':'android.permission.INTERNET'}}],application:[{$:{},activity:[{$:{'android:name':'.MainActivity'},'intent-filter':[{data:[{$:{'android:scheme':'russicaptor'}}]}]},{$:{'android:name':'OtherActivity'}}],provider:[{$:{'android:exported':'true'}}]}]});
    expect(manifest['uses-permission']).toEqual(expect.arrayContaining([{$:{'android:name':'android.permission.INTERNET','tools:node':'remove'}}]));expect(manifest.application[0].activity).toHaveLength(1);expect(JSON.stringify(manifest)).not.toContain('android:scheme');expect(manifest.application[0].provider[0].$['android:exported']).toBe('false');expect(manifest.application[0].$['android:allowBackup']).toBe('false');expect(manifest.application[0].$['android:icon']).toBe('@drawable/offline_demo_icon');});
  test('missing native main activity fails closed',()=>expect(()=>plugin.hardenManifest({application:[{$:{},activity:[]}]})).toThrow('OFFLINE_DEMO_ACTIVITY_INVALID'));
  test.each([{'android:sharedUserId':'shared.production'},{package:'com.jaaklind.RussiCaptor'}])('native shared UID or wrong manifest identity rejected %j',attributes=>expect(()=>plugin.hardenManifest({$:attributes})).toThrow('OFFLINE_DEMO_NATIVE_IDENTITY_INVALID'));
  test('plugin cannot apply to canonical application',()=>expect(()=>plugin({android:{package:'com.jaaklind.RussiCaptor'}})).toThrow('OFFLINE_DEMO_PACKAGE_REQUIRED'));
  test('canonical entry and version remain production only',()=>{const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));expect(pkg.main).toBe('expo-router/entry');expect(config.expo.android).toMatchObject({package:'com.jaaklind.RussiCaptor',versionCode:181});expect(config.expo.name).toBe('RussiCaptor');});
});
