import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const {AUDITED_DEMO_ASSETS,assertAuditedDemoAsset}=require('../../offline-demo/isolation-policy.cjs');
const run=(code:string)=>spawnSync(process.execPath,['--input-type=module','-e',`import {verifyAuditedDemoAssets,validatePackagedDemoAssets,validateBundleSources} from './scripts/offline-demo-build-policy.mjs';${code}`],{cwd:process.cwd(),encoding:'utf8'});
describe('offline imaging exact bytes, manifest and packaged-artifact default deny',()=>{
  test('only approved exact image bytes are accepted; no wildcard or remote file',()=>{
    expect(Object.keys(AUDITED_DEMO_ASSETS).sort()).toEqual(['assets/imaging/chest-pneumothorax.png','assets/imaging/pelvis-generated.jpg']);
    for(const file of Object.keys(AUDITED_DEMO_ASSETS)){const b=fs.readFileSync(path.join(process.cwd(),'offline-demo',file));expect(()=>assertAuditedDemoAsset(file,b)).not.toThrow();
      expect(()=>assertAuditedDemoAsset(file,Buffer.concat([b,Buffer.from('changed')]))).toThrow('OFFLINE_DEMO_ASSET_HASH_INVALID');}
    expect(()=>assertAuditedDemoAsset('assets/imaging/unknown.jpg',Buffer.from('x'))).toThrow();
    expect(run('verifyAuditedDemoAssets();').status).toBe(0);expect(run("validateBundleSources(['assets/imaging/unknown.jpg']);").status).not.toBe(0);
  });
  test('actual packaged byte inventory must include both approved files, not merely manifest claims',()=>{
    const source="import fs from 'node:fs';const files=['pelvis-generated.jpg','chest-pneumothorax.png'];const bytes=files.map(f=>fs.readFileSync('offline-demo/assets/imaging/'+f));";
    expect(run(source+'validatePackagedDemoAssets(bytes);').status).toBe(0);
    expect(run(source+'validatePackagedDemoAssets(bytes.slice(1));').stderr).toContain('OFFLINE_DEMO_PACKAGED_ASSET_MISMATCH');
    expect(run(source+"validatePackagedDemoAssets([bytes[0],Buffer.from('wrong')]);").status).not.toBe(0);
  });
  test('demo imports the pure core, never wrapper or production gateway; URLs remain metadata, not image sources',()=>{
    const demo=fs.readFileSync('offline-demo/src/runtime/DemoImaging.ts','utf8'),ui=fs.readFileSync('offline-demo/src/runtime/DemoImagingCard.tsx','utf8');
    expect(demo).toContain('ImagingWorkflowCore');expect(demo).not.toMatch(/ImagingWorkflowCommandService|ImagingRepository|ImagingService|ImagingAssetRegistry|CloudSync|OperatorSession|fetch\(/);
    expect(ui).not.toMatch(/uri:|fetch\(|Linking|XMLHttpRequest/);expect(ui).toContain("require('../../assets/imaging/pelvis-generated.jpg')");
    const core=fs.readFileSync('src/services/runtime/imaging/ImagingWorkflowCore.ts','utf8');expect(core).not.toMatch(/sha256Text|stableJson|ImagingAssetRegistry|RuntimeLease|expo-crypto/);
    expect(run("validateBundleSources(['../src/services/runtime/imaging/ImagingWorkflowRuntime.ts']);").status).not.toBe(0);
  });
});
