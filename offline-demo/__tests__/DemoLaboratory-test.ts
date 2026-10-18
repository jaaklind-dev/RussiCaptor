import { DemoSessionStore, DEMO_RUNTIME_KEY, restoreSession, type DemoSession } from '../src/runtime/DemoSession';
import { DemoController } from '../src/runtime/DemoController';
import { DEMO_LAB_ANALYTES, DEMO_LAB_DELAY_SEC, DEMO_LAB_PANEL, orderDemoLab, emptyDemoLabs, presentDemoLabs, type DemoLabCommand } from '../src/runtime/DemoLaboratory';
import { formatDemoDuration } from '../src/runtime/DemoTime';
import { initialPatients } from '../src/runtime/DemoDomain';
import { generateNarvaLabPhysiology } from '../../src/services/runtime/laboratory/NarvaLabPhysiologyV1Generator';

const state = (store: DemoSessionStore): DemoSession => { const v=store.getSnapshot(); if(v.status!=='READY')throw Error('FIXTURE'); return v.session; };
function fixture() {
  const map=new Map<string,string>(); let id=0;
  const storage={getItemSync:(k:string)=>map.get(k)??null,setItemSync:(k:string,v:string)=>{map.set(k,v);}};
  const store=new DemoSessionStore(storage,()=>`DEMO-LOCAL-lab-${++id}`);
  const tick=(seconds=1)=>{for(let i=0;i<seconds;i++){const s=state(store);store.tick(s.sessionId,s.generation);}};
  store.control('START');store.navigate('CM');
  return {map,storage,store,tick};
}
function command(store: DemoSessionStore, patientId: 'DEMO-PT-A'|'DEMO-PT-B'='DEMO-PT-A'):DemoLabCommand {
  const s=state(store);return {id:`DEMO-CMD-${s.sessionId}:lab:${patientId}`,sessionId:s.sessionId,generation:s.generation,
    time:s.time,patientId,type:'LAB_ORDER',panelId:DEMO_LAB_PANEL};
}
describe('demo elapsed duration presentation only',()=>{
  test.each([[0,'0 s'],[29,'29 s'],[60,'1 min'],[149,'2 min 29 s'],[3600,'1 h'],[3661,'1 h 1 min 1 s'],[5.999,'5 s'],[0.9,'0 s'],[-1,'–'],[undefined,'–'],[null,'–'],[NaN,'–'],[Infinity,'–'],[-Infinity,'–'],['29','–']])('%p => %s',(v,expected)=>expect(formatDemoDuration(v)).toBe(expected));
});
describe('local laboratory integration with real shared physiology generator (not mocked)',()=>{
  test('one stable order/sample, three pending groups, no values before simulation threshold',()=>{
    const {store,tick}=fixture();const patients=structuredClone(state(store).patients);const c=command(store);expect(store.command(c)).toBe('ACCEPTED');
    expect(state(store).patients).toEqual(patients);
    expect(state(store).commands).toEqual([c]);expect(state(store).laboratory.orders).toHaveLength(1);
    expect(state(store).laboratory.samples).toHaveLength(1);expect(state(store).laboratory.resultGroups).toHaveLength(3);
    tick(DEMO_LAB_DELAY_SEC-1);expect(state(store).laboratory.resultGroups.every(g=>g.status==='PROCESSING'&&!g.resultPayload)).toBe(true);
    expect(store.acceptanceReport(state(store)).commands[0]).toMatchObject({id:c.id,processingStatus:'PENDING_SAMPLE_VERIFIED'});
  });
  test('release uses immutable collection snapshot and unmodified real generator, never current patient physiology',()=>{
    const {store,tick}=fixture();tick(100);store.command(command(store));
    const frozen=structuredClone(state(store).laboratory.samples[0]);tick(30);
    const s=state(store);expect(s.patients[0].vitals.timestamp).toBe(130);expect(s.laboratory.samples[0]).toEqual(frozen);
    for(const group of s.laboratory.resultGroups){
      const expected=generateNarvaLabPhysiology({order:s.laboratory.orders[0],sample:frozen,resultGroupType:group.type})!;
      expect(group.resultPayload?.analytes).toEqual(expected.payload.analytes.filter(a=>DEMO_LAB_ANALYTES.includes(a.analyteId)));
      expect(group).toMatchObject({status:'RESULTED',generatedAtSimulationTimeSec:130,availableAtSimulationTimeSec:130});
      expect(group.resultPayload).toMatchObject({sampledAtSimulationTimeSec:100,synthetic:true});
    }
    expect(store.acceptanceReport(s).commands[0].processingStatus).toBe('RESULT_VERIFIED');
    const result=JSON.stringify(s.laboratory);tick(10);expect(JSON.stringify(state(store).laboratory)).toBe(result);
  });
  test('two-patient isolation, catalog units/ranges and shared abnormal semantics',()=>{
    const {store,tick}=fixture();store.command(command(store));store.navigate('CM','DEMO-PT-B');store.command(command(store,'DEMO-PT-B'));tick(30);
    const s=state(store);expect(s.laboratory.orders).toHaveLength(2);
    for(const id of ['DEMO-PT-A','DEMO-PT-B']){
      const groups=presentDemoLabs(s.laboratory,id);const rows=groups.flatMap(g=>g.rows);
      expect(rows.map(r=>r.analyteId).sort()).toEqual([...DEMO_LAB_ANALYTES].sort());
      expect(rows.find(r=>r.analyteId==='LAB_HB')).toMatchObject({unit:'g/L',abnormalFlag:'UNCLASSIFIED'});
      expect(rows.find(r=>r.analyteId==='LAB_NA')).toMatchObject({unit:'mmol/L',referenceRange:'136–145',abnormalFlag:'NORMAL'});
      expect(rows.find(r=>r.analyteId==='LAB_PH')?.referenceRange).toBeTruthy();
      expect(groups.every(g=>g.key.includes(id))).toBe(true);
    }
    // Same shared presentation refuses to invent a normal value or abnormal flag for absent data.
    const broken=structuredClone(s.laboratory);broken.resultGroups=broken.resultGroups.map(g=>({...g,resultPayload:{...g.resultPayload,analytes:[]}}));
    expect(presentDemoLabs(broken,'DEMO-PT-A').flatMap(g=>g.rows).every(r=>r.state==='MISSING'&&r.abnormalFlag==='UNCLASSIFIED')).toBe(true);
    const high=structuredClone(s.laboratory);high.resultGroups=high.resultGroups.map(g=>g.type!=='CLINICAL_CHEMISTRY'?g:({...g,resultPayload:{...g.resultPayload,analytes:[{analyteId:'LAB_K',value:8,unit:'mmol/L',referenceRange:'3.5–5.1'}]}}));
    expect(presentDemoLabs(high,'DEMO-PT-A').flatMap(g=>g.rows).find(r=>r.analyteId==='LAB_K')?.abnormalFlag).toBe('HIGH');
  });
  test('pause and background stop lab time; resume uses remaining simulation seconds',()=>{
    const {store,tick}=fixture();store.command(command(store));tick(10);store.control('PAUSE');tick(100);
    expect(state(store).time).toBe(10);expect(state(store).laboratory.orders[0].status).toBe('PROCESSING');
    store.control('RESUME');tick(10);store.control('BACKGROUND');tick(100);expect(state(store).time).toBe(20);
    store.control('RESUME');tick(9);expect(state(store).laboratory.orders[0].status).toBe('PROCESSING');tick();expect(state(store).laboratory.orders[0].status).toBe('RESULTED');
  });
  test('restart pending and resulted preserves IDs, sample, deadline and no wall-clock catchup/replay',()=>{
    const {store,storage,tick}=fixture();const c=command(store);store.command(c);tick(12);
    const pending=state(store).laboratory;let recovered=new DemoSessionStore(storage);
    expect(state(recovered)).toMatchObject({time:12,lifecycle:'PAUSED',laboratory:pending});
    recovered.control('RESUME');for(let i=0;i<18;i++)recovered.tick(state(recovered).sessionId,state(recovered).generation);
    const result=state(recovered).laboratory;recovered=new DemoSessionStore(storage);
    expect(state(recovered)).toMatchObject({time:30,lifecycle:'PAUSED',laboratory:result});
    expect(recovered.command(c)).toBe('DUPLICATE');expect(state(recovered).laboratory.orders).toHaveLength(1);
    expect(state(recovered).events.filter(e=>e.kind==='LAB_RESULTED')).toHaveLength(1);
    recovered.navigate('EXCON');const observed=state(recovered).laboratory;recovered.navigate('CM');expect(state(recovered).laboratory).toEqual(observed);
  });
  test('idempotency, no repeat, unsupported panel and stale/wrong patient fail closed',()=>{
    const {store,tick}=fixture();const c=command(store);store.command(c);expect(store.command(c)).toBe('DUPLICATE');tick();
    const before=JSON.stringify(state(store));expect(()=>store.command(command(store))).toThrow('DEMO_COMMAND_ID_CONFLICT');
    expect(()=>store.command({...c,panelId:'UNKNOWN'})).toThrow('DEMO_COMMAND_INVALID');
    expect(()=>store.command(command(store,'DEMO-PT-B'))).toThrow('DEMO_COMMAND_NOT_READY');
    expect(JSON.stringify(state(store))).toBe(before);
  });
  test.each([10,30])('reset at T+%i removes pending/results and fences callbacks/old commands',time=>{
    const {store,tick}=fixture();const c=command(store);store.command(c);tick(time);const old=state(store);
    expect(store.reset(old.sessionId,old.generation)).toBe(true);
    expect(state(store)).toMatchObject({generation:1,time:0,commands:[],events:[],laboratory:emptyDemoLabs()});
    expect(store.tick(old.sessionId,old.generation)).toBe(false);expect(()=>store.command(c)).toThrow('DEMO_COMMAND_OBSOLETE');
  });
  test('controller fences a retained scheduled callback across reset and background',()=>{
    const {store}=fixture();const callbacks:(()=>void)[]=[];
    const runtime=new DemoController(store,{schedule:cb=>{callbacks.push(cb);return callbacks.length;},cancel:jest.fn()});
    store.command(command(store));const callback=callbacks[0];const old=state(store);runtime.reset(old.sessionId,old.generation);callback();
    expect(state(store).laboratory).toEqual(emptyDemoLabs());runtime.dispose();
  });
  test('schema v2 upgrade preserves old state/record; v3 roundtrip and corrupt results fail closed',()=>{
    const {store,map,storage,tick}=fixture();tick(4);const old=structuredClone(state(store)) as unknown as Record<string,unknown>;
    delete old.laboratory;old.schemaVersion=2;const raw=JSON.stringify(old);map.set(DEMO_RUNTIME_KEY,raw);
    const recovered=new DemoSessionStore(storage);expect(state(recovered)).toMatchObject({schemaVersion:3,time:4,lifecycle:'PAUSED',laboratory:emptyDemoLabs()});
    expect(map.get(DEMO_RUNTIME_KEY)).toBe(raw);expect(state(recovered).patients).toEqual(old.patients);
    recovered.navigate('CM');recovered.control('RESUME');recovered.command(command(recovered));
    const saved=map.get(DEMO_RUNTIME_KEY)!;expect(restoreSession(saved).laboratory).toEqual(state(recovered).laboratory);
    const corrupt=JSON.parse(saved);corrupt.laboratory.resultGroups[0].availableAtSimulationTimeSec--;
    map.set(DEMO_RUNTIME_KEY,JSON.stringify(corrupt));expect(new DemoSessionStore(storage).getSnapshot().status).toBe('RECOVERY_REQUIRED');
    map.set(DEMO_RUNTIME_KEY,saved);expect(new DemoSessionStore(storage).getSnapshot().status).toBe('READY');
  });
  test('failed save does not publish partial order; acknowledged but lost save restores one command',()=>{
    const {store,storage}=fixture();const before=JSON.stringify(state(store));const set=jest.spyOn(storage,'setItemSync').mockImplementation(()=>{throw Error('INTERRUPTED');});
    expect(()=>store.command(command(store))).toThrow('DEMO_STORAGE_UNAVAILABLE');expect(store.getSnapshot().status).toBe('RECOVERY_REQUIRED');
    set.mockRestore();expect(store.recover()).toBe(true);expect(JSON.stringify(state(store).laboratory)).toBe(JSON.stringify(JSON.parse(before).laboratory));
    store.control('RESUME');const c=command(store);const original=storage.setItemSync;
    jest.spyOn(storage,'setItemSync').mockImplementation((k,v)=>{original(k,v);throw Error('LOST_ACK');});
    expect(store.command(c)).toBe('ACCEPTED');expect(new DemoSessionStore(storage).getSnapshot().status).toBe('READY');
  });
  test('insufficient remaining demo time and missing physiological inputs do not fabricate results',()=>{
    const {store,tick}=fixture();tick(871);expect(()=>store.command(command(store))).toThrow('DEMO_LAB_TIME_LIMIT');
    expect(state(store).laboratory.orders).toHaveLength(0);
    const patient=initialPatients()[0];patient.vitals.readings.temperature.current=NaN;
    expect(()=>orderDemoLab(emptyDemoLabs(),{...command(store),time:0},patient)).toThrow('DEMO_LAB_SOURCE_UNAVAILABLE');
  });
  test('reset preserves unrelated demo Builder data and never reads canonical storage keys',()=>{
    const {store,map,storage}=fixture();map.set('demo.builder.fixture','PRESERVE');store.command(command(store));
    const read=jest.spyOn(storage,'getItemSync'),write=jest.spyOn(storage,'setItemSync');const old=state(store);store.reset(old.sessionId,old.generation);
    expect(map.get('demo.builder.fixture')).toBe('PRESERVE');
    expect([...read.mock.calls.map(c=>c[0]),...write.mock.calls.map(c=>c[0])].every(k=>k.startsWith('russicaptor.offline-demo.'))).toBe(true);
  });
  test('tampered released value/provenance or duplicate result cannot pass recovery validation',()=>{
    const {store,map,tick}=fixture();store.command(command(store));tick(30);const raw=map.get(DEMO_RUNTIME_KEY)!;
    for(const field of ['resultPayload','generationVersion','duplicate']){
      const corrupt=JSON.parse(raw);
      if(field==='duplicate')corrupt.laboratory.resultGroups.push(corrupt.laboratory.resultGroups[0]);
      else if(field==='generationVersion')corrupt.laboratory.resultGroups[0].generationVersion='FAKE';
      else corrupt.laboratory.resultGroups[0].resultPayload.analytes[0].value=999;
      expect(()=>restoreSession(JSON.stringify(corrupt))).toThrow('DEMO_STATE_INVALID');
    }
  });
});
