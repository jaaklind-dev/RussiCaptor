import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DemoSessionStore,DEMO_RUNTIME_KEY,restoreSession,type DemoSession } from '../src/runtime/DemoSession';
import { DemoController } from '../src/runtime/DemoController';
import { DEMO_IMAGING_ASSETS,DEMO_REPORT_HASHES,demoImagingCommandId,demoImagingDefinition,demoImagingAsset,validateDemoImagingAsset,
  type DemoImagingCommand } from '../src/runtime/DemoImaging';
import { DEMO_LAB_PANEL } from '../src/runtime/DemoLaboratory';
const state=(store:DemoSessionStore):DemoSession=>{const v=store.getSnapshot();if(v.status!=='READY')throw Error('FIXTURE');return v.session;};
function fixture(){const map=new Map<string,string>();let id=0;const storage={getItemSync:(k:string)=>map.get(k)??null,setItemSync:(k:string,v:string)=>{map.set(k,v);}};
  const store=new DemoSessionStore(storage,()=>`DEMO-LOCAL-imaging-${++id}`);store.control('START');store.navigate('CM');
  const tick=(n=1,target=store)=>{for(let i=0;i<n;i++){const s=state(target);target.tick(s.sessionId,s.generation);}};
  return {map,storage,store,tick};}
function command(store:DemoSessionStore,patientId:'DEMO-PT-A'|'DEMO-PT-B'='DEMO-PT-A'):DemoImagingCommand {
  const s=state(store),d=demoImagingDefinition(patientId);return{id:demoImagingCommandId(s.sessionId,patientId,d.examinationId),sessionId:s.sessionId,
    generation:s.generation,time:s.time,patientId,type:'IMAGING_ORDER',examinationId:d.examinationId};
}
describe('closed approved demo imaging assets',()=>{
  test.each(DEMO_IMAGING_ASSETS)('$patientId asset bytes, dimensions, approval and report digest',d=>{
    const bytes=fs.readFileSync(path.join(process.cwd(),'offline-demo/assets/imaging',d.file));
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(d.sha256);
    expect(crypto.createHash('sha256').update(d.report).digest('hex')).toBe(DEMO_REPORT_HASHES[d.reportId]);
    expect(d.width).toBeGreaterThan(1000);expect(d.height).toBeGreaterThan(900);
    if(d.format==='image/png'){expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([d.width,d.height]);}
    else{expect(bytes.subarray(0,2).toString('hex')).toBe('ffd8');let dimensions:number[]=[];
      for(let p=2;p+4<bytes.length;){while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===0xda)break;const n=bytes.readUInt16BE(p);
        if(marker===0xc0||marker===0xc2){dimensions=[bytes.readUInt16BE(p+5),bytes.readUInt16BE(p+3)];break;}p+=n;}
      expect(dimensions).toEqual([d.width,d.height]);}
    expect(d.report).toContain('DEMO – sünteetiline õppetekst');expect(()=>validateDemoImagingAsset(demoImagingAsset(d.patientId))).not.toThrow();
  });
  test('exact user-approved JPEG, source credit/license and no false hemothorax confirmation',()=>{
    expect(DEMO_IMAGING_ASSETS[0]).toMatchObject({sha256:'67e0866d46ae3ebee501fe7b10cdd1fff6c19a4f0886bfce646d9e5d314a5f39',format:'image/jpeg',width:1280,height:948,
      attribution:'DEMO – genereeritud radioloogiline illustratsioon'});
    expect(DEMO_IMAGING_ASSETS[1]).toMatchObject({creator:'James Heilman, MD',license:'CC-BY-SA-3.0',source:'https://commons.wikimedia.org/wiki/File:Tpneumopneumomed.png'});
    expect(DEMO_IMAGING_ASSETS[1].report).toContain('Hemotooraksit selle röntgenikujutise põhjal ei kinnitata');
    expect(()=>validateDemoImagingAsset({...demoImagingAsset('DEMO-PT-A'),sha256:'0'.repeat(64)})).toThrow('DEMO_IMAGING_ASSET_INVALID');
    expect(()=>validateDemoImagingAsset({...demoImagingAsset('DEMO-PT-A'),sourceKind:'MANAGED_REMOTE',resolverKey:'https://example.invalid/x'})).toThrow();
  });
});
describe('real shared imaging state machine in offline demo session',()=>{
  test('acceptance ORDERED -> PROCESSING -> RESULTED at T+30, one ledger/event/result identity',()=>{
    const {store,tick}=fixture(),c=command(store);expect(store.command(c)).toBe('ACCEPTED');expect(state(store).imaging.instances[0].status).toBe('ORDERED');
    expect(store.acceptanceReport(state(store)).commands[0].processingStatus).toBe('IMAGING_PENDING_VERIFIED');
    tick();expect(state(store).imaging.instances[0].status).toBe('PROCESSING');tick(28);expect(state(store).imaging.instances[0].result).toBeUndefined();
    tick();expect(state(store).imaging.instances[0]).toMatchObject({status:'RESULTED',result:{resultId:`IMAGING_RESULT:IMAGING:${c.id}`,releasedAtSimulationTimeSec:30}});
    expect(store.acceptanceReport(state(store)).commands[0].processingStatus).toBe('RESULT_VERIFIED');
    const result=state(store).imaging;tick(10);expect(state(store).imaging).toEqual(result);expect(state(store).events.filter(e=>e.kind==='IMAGING_RESULTED')).toHaveLength(1);
  });
  test('two patients bind only their own examination and result',()=>{
    const {store,tick}=fixture();store.command(command(store));store.navigate('CM','DEMO-PT-B');store.command(command(store,'DEMO-PT-B'));tick(30);
    expect(state(store).imaging.instances).toHaveLength(2);for(const i of state(store).imaging.instances){const d=demoImagingDefinition(i.patientId);
      expect(i.definitionId).toBe(d.examinationId);expect(i.result?.asset?.assetId).toBe(d.assetId);expect(i.result?.reportText).toBe(d.report);}
  });
  test('paused/backgrounded time never advances, remaining delay resumes',()=>{
    const {store,tick}=fixture();store.command(command(store));tick(9);store.control('PAUSE');tick(60);expect(state(store).time).toBe(9);
    store.control('RESUME');tick(10);store.control('BACKGROUND');tick(60);expect(state(store).time).toBe(19);store.control('RESUME');tick(10);
    expect(state(store).imaging.instances[0].result).toBeUndefined();tick();expect(state(store).imaging.instances[0].result?.releasedAtSimulationTimeSec).toBe(30);
  });
  test.each([12,30])('restart at T%i preserves pending/result, no catchup and exactly once',time=>{
    const {store,storage,tick}=fixture(),c=command(store);store.command(c);tick(time);const before=state(store);let recovered=new DemoSessionStore(storage);
    expect(state(recovered)).toMatchObject({time,lifecycle:'PAUSED',imaging:before.imaging,commands:before.commands});
    expect(recovered.command(c)).toBe('DUPLICATE');recovered.control('RESUME');tick(40-time,recovered);
    expect(state(recovered).imaging.instances).toHaveLength(1);expect(state(recovered).events.filter(e=>e.kind==='IMAGING_RESULTED')).toHaveLength(1);
    recovered=new DemoSessionStore(storage);expect(state(recovered).imaging.instances[0].result?.releasedAtSimulationTimeSec).toBe(30);
  });
  test('same ID idempotent, conflicting/repeat/wrong-patient/wrong-study commands leave state intact',()=>{
    const {store,tick}=fixture(),c=command(store);store.command(c);expect(store.command(c)).toBe('DUPLICATE');tick();const before=JSON.stringify(state(store));
    expect(()=>store.command(command(store))).toThrow('DEMO_COMMAND_ID_CONFLICT');expect(()=>store.command({...c,id:c.id+'-repeat'})).toThrow('DEMO_COMMAND_INVALID');
    expect(()=>store.command(command(store,'DEMO-PT-B'))).toThrow('DEMO_COMMAND_NOT_READY');expect(()=>store.command({...c,examinationId:'DEMO-CHEST-XR'})).toThrow('DEMO_COMMAND_INVALID');
    expect(JSON.stringify(state(store))).toBe(before);
  });
  test.each([8,30])('reset at T%i clears imaging/labs and fences retained callback/command',time=>{
    const {store,map,tick}=fixture(),c=command(store);store.command(c);tick(time);map.set('demo.builder.draft','PRESERVE');const old=state(store);
    const callbacks:(()=>void)[]=[];const controller=new DemoController(store,{schedule:cb=>{callbacks.push(cb);return callbacks.length;},cancel:jest.fn()});
    controller.reset(old.sessionId,old.generation);callbacks[0]();expect(store.tick(old.sessionId,old.generation)).toBe(false);
    expect(()=>store.command(c)).toThrow('DEMO_COMMAND_OBSOLETE');expect(state(store)).toMatchObject({time:0,generation:1,commands:[],events:[],imaging:{instances:[]},laboratory:{orders:[],resultGroups:[]}});
    expect(map.get('demo.builder.draft')).toBe('PRESERVE');expect(state(new DemoSessionStore({getItemSync:k=>map.get(k)??null,setItemSync:(k,v)=>{map.set(k,v);}})).time).toBe(0);controller.dispose();
  });
  test('schema3 upgrade preserves existing real lab results, patient engines and original persisted row',()=>{
    const {store,map,storage,tick}=fixture();const s=state(store);store.command({id:`DEMO-CMD-${s.sessionId}:lab:DEMO-PT-A`,sessionId:s.sessionId,generation:s.generation,time:s.time,
      patientId:'DEMO-PT-A',type:'LAB_ORDER',panelId:DEMO_LAB_PANEL});tick(30);store.control('PAUSE');
    const old=JSON.parse(JSON.stringify(state(store)));delete old.imaging;old.schemaVersion=3;const raw=JSON.stringify(old);map.set(DEMO_RUNTIME_KEY,raw);
    const restored=new DemoSessionStore(storage);expect(state(restored)).toMatchObject({schemaVersion:4,time:30,laboratory:old.laboratory,patients:old.patients,commands:old.commands,events:old.events});
    expect(map.get(DEMO_RUNTIME_KEY)).toBe(raw);restored.navigate('CM','DEMO-PT-B');restored.control('RESUME');restored.command(command(restored,'DEMO-PT-B'));tick(30,restored);
    expect(state(restored).laboratory).toEqual(old.laboratory);expect(state(restored).imaging.instances[0].status).toBe('RESULTED');
  });
  test.each(['hash','report','patient','deadline','duplicate','event','order-id','result-id'])('corrupt persisted %s fails closed, supported recovery restores original',field=>{
    const {store,map,storage,tick}=fixture();store.command(command(store));tick(30);const raw=map.get(DEMO_RUNTIME_KEY)!,s=JSON.parse(raw),i=s.imaging.instances[0];
    if(field==='hash')i.result.asset.sha256='0'.repeat(64);if(field==='report')i.result.reportText='Forged';if(field==='patient')i.patientId='DEMO-PT-B';
    if(field==='deadline')i.availableAtSimulationTimeSec++;if(field==='duplicate')s.imaging.instances.push(i);if(field==='event')s.events=s.events.filter((e:{kind:string})=>e.kind!=='IMAGING_RESULTED');
    if(field==='order-id')i.orderCommandId+='-other';if(field==='result-id')i.result.resultId+='-other';
    map.set(DEMO_RUNTIME_KEY,JSON.stringify(s));const bad=new DemoSessionStore(storage);expect(bad.getSnapshot().status).toBe('RECOVERY_REQUIRED');map.set(DEMO_RUNTIME_KEY,raw);
    expect(bad.recover()).toBe(true);expect(restoreSession(raw).imaging).toEqual(state(store).imaging);
  });
  test('CM EXCON mode switching consumes same state; insufficient time and PAUSED dispatch denied',()=>{
    const {store,tick}=fixture();store.command(command(store));tick(30);const before=state(store).imaging;store.navigate('EXCON');store.navigate('CM');expect(state(store).imaging).toEqual(before);
    store.navigate('CM','DEMO-PT-B');store.control('PAUSE');expect(()=>store.command(command(store,'DEMO-PT-B'))).toThrow('DEMO_COMMAND_NOT_READY');
    store.control('RESUME');tick(841);expect(()=>store.command(command(store,'DEMO-PT-B'))).toThrow('DEMO_IMAGING_TIME_LIMIT');
  });
  test('save interruption never exposes partial result, lost acknowledgement remains idempotent',()=>{
    const {store,storage}=fixture();const c=command(store),original=storage.setItemSync;
    const fail=jest.spyOn(storage,'setItemSync').mockImplementation(()=>{throw Error('INTERRUPTED');});expect(()=>store.command(c)).toThrow('DEMO_STORAGE_UNAVAILABLE');
    fail.mockRestore();expect(store.recover()).toBe(true);store.control('RESUME');expect(state(store).imaging.instances).toHaveLength(0);
    jest.spyOn(storage,'setItemSync').mockImplementation((k,v)=>{original(k,v);throw Error('LOST_ACK');});expect(store.command(c)).toBe('ACCEPTED');expect(new DemoSessionStore(storage).getSnapshot().status).toBe('READY');
    jest.restoreAllMocks();
  });
});
