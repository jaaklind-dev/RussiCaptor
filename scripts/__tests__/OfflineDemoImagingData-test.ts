import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const {verifySource,verifyBundle,validateData,verifyPackagedData}=require('../lib/offline-demo-imaging-data.cjs');
const bytes=fs.readFileSync('offline-demo/assets/imaging/manifest.json');
const data=JSON.parse(bytes.toString());
// The installed Metro JSON transformer uses this real wrapping implementation.
const {wrapJson}=require(path.join(path.dirname(require.resolve('metro/package.json')),'src/ModuleGraph/worker/JsFileWrapping.js'));
const bundle=(value:any)=>wrapJson(JSON.stringify(value),'',false);
describe('strict imaging JSON data and compiler-input verification',()=>{
  test('real Metro JSON factory retains exact approved data without a source-map entry',()=>{
    expect(verifySource()).toEqual(data);
    expect(verifyBundle(bundle(data)).sourceSha256).toBe('130b7ebe540d7da602056f01cfc7af36cb19b9d6e320152a260ce6b229e9d51b');
  });
  test('modified source bytes rejected even with equivalent parsed data',()=>{
    expect(()=>verifySource(Buffer.concat([bytes,Buffer.from('\n')]))).toThrow('OFFLINE_DEMO_AUDITED_SOURCE_HASH_INVALID');
  });
  test('actual APK JSON must be byte-identical and match the actual compiler input',()=>{
    expect(()=>verifyPackagedData(bytes,bytes,bundle(data))).not.toThrow();
    expect(()=>verifyPackagedData(Buffer.from('{}'),bytes,bundle(data))).toThrow('OFFLINE_DEMO_PACKAGED_IMAGING_DATA_MISMATCH');
    expect(()=>verifyPackagedData(bytes,bytes,bundle({...data,assets:[]}))).toThrow();
  });
  test.each(['assetId','file','sha256','patientId','examinationId','reportId','format','width','height'])('wrong %s rejected',key=>{
    const value=JSON.parse(JSON.stringify(data));value.assets[0][key]='invalid';
    expect(()=>validateData(value)).toThrow();expect(()=>verifyBundle(bundle(value))).toThrow();
  });
  test('additional assets, schema fields and unapproved URLs rejected',()=>{
    for(const modify of [(d:any)=>d.assets.push(d.assets[0]),(d:any)=>d.schemaVersion=2,(d:any)=>d.extra=true,
      (d:any)=>d.assets[0].source='https://example.org/image.jpg',(d:any)=>d.assets[0].uri='https://example.org/image.jpg']) {
      const value=JSON.parse(JSON.stringify(data));modify(value);expect(()=>validateData(value)).toThrow();
    }
  });
  test('changed report, missing/duplicate data factory and executable expression rejected',()=>{
    const changed=JSON.parse(JSON.stringify(data));changed.assets[0].report+='changed';
    expect(()=>verifyBundle(bundle(changed))).toThrow('OFFLINE_DEMO_IMAGING_BUNDLE_MISMATCH');
    expect(()=>verifyBundle('var nothing=1')).toThrow('OFFLINE_DEMO_IMAGING_BUNDLE_MISSING');
    expect(()=>verifyBundle(bundle(data)+bundle(data))).toThrow();
    expect(()=>verifyBundle(bundle(data).replace('module.exports =','doSomething(); module.exports ='))).toThrow();
  });
  test('source map requires all audited JS modules but does not invent a JSON entry',()=>{
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import {validateAuditedBundleSources} from './scripts/offline-demo-build-policy.mjs';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {AUDITED_DEMO_SOURCES}=require('./offline-demo/isolation-policy.cjs');const files=Object.keys(AUDITED_DEMO_SOURCES).filter(f=>!f.endsWith('.json'));validateAuditedBundleSources({sources:files.map(f=>'/'+f),sourcesContent:files.map(f=>fs.readFileSync('offline-demo/'+f,'utf8'))});`],{encoding:'utf8'});
    expect(result.status).toBe(0);
  });
  test.each(['assets/imaging/unknown.json','\0polyfill:unknown/node_modules/file.js'])('unapproved JSON/virtual bundle path rejected: %s',file=>{
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import {validateBundleSources} from './scripts/offline-demo-build-policy.mjs';validateBundleSources(${JSON.stringify([file])});`],{encoding:'utf8'});
    expect(result.status).not.toBe(0);
  });
  test('byte-preserving PNG config and compiler validation are enabled in the demo pipeline only',()=>{
    const source=fs.readFileSync('scripts/build-offline-demo.mjs','utf8');
    expect(source).toContain('android.enablePngCrunchInReleaseBuilds=false');
    expect(source).toContain('OFFLINE_DEMO_PNG_TEMPLATE_CHANGED');
    expect(source).toContain('offline-demo-hermes-wrapper.cjs');
    expect(source).toContain('verifyPackagedData(packagedImagingBytes,imagingBytes,compilerCode)');
    expect(source).toContain('outputSha256!==bundleSha256');
  });
});
