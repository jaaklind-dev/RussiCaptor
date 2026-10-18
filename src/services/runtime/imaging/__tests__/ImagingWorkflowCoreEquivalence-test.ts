import { ImagingWorkflowRuntime as Before } from '../__fixtures__/ImagingRuntimeBeforeExtraction.fixture';
import { ImagingWorkflowRuntime as After } from '../ImagingWorkflowRuntime';
import { DEMO_HEAD_CT_ASSET } from '../../../imaging/ImagingAssetRegistry';

const input={commandId:'EQUIVALENT',exerciseId:'EX-TEST',patientId:'PT-001',orderedBy:'CM',orderedAtSimulationTimeSec:10,
  definition:{definitionId:'IMG-1',patientId:'PT-001',title:'XR',modality:'XR' as const,reportSource:'Frozen report',
    delaySeconds:30,packageId:'TEST',packageVersion:'1.0.0',packageHash:'HASH'}};
describe('canonical imaging extraction equals frozen pre-extraction behavior',()=>{
  test.each([false,true])('order/delay/duplicate/restore/repeat/terminal parity, asset=%p',withAsset=>{
    const old=new Before(),next=new After(),command={...input,definition:{...input.definition,...(withAsset?{asset:DEMO_HEAD_CT_ASSET}:{})}};
    expect(next.order(command)).toEqual(old.order(command));expect(next.order(command)).toEqual(old.order(command));
    for(const t of [10,39,40,80]){expect(next.advanceTo(t)).toEqual(old.advanceTo(t));expect(next.snapshot()).toEqual(old.snapshot());}
    const restoredOld=new Before(),restoredNew=new After();restoredOld.restore(old.snapshot());restoredNew.restore(next.snapshot());
    expect(restoredNew.snapshot()).toEqual(restoredOld.snapshot());
    const repeat={...command,commandId:'REPEAT',orderedAtSimulationTimeSec:80};expect(next.order(repeat)).toEqual(old.order(repeat));
    next.fenceTerminal(80);old.fenceTerminal(80);expect(next.advanceTo(200)).toEqual(old.advanceTo(200));expect(next.snapshot()).toEqual(old.snapshot());
    expect(()=>next.order({...command,commandId:'LATE'})).toThrow('IMAGING_TERMINAL_FENCED');
  });
  test('authority denial and integrity failures retain exact canonical errors',()=>{
    for(const Runtime of [Before,After]){
      const reader=new Runtime(()=>false);expect(()=>reader.order(input)).toThrow('IMAGING_WRITER_REQUIRED');expect(reader.advanceTo(40)).toEqual([]);
      const writer=new Runtime();writer.order(input);writer.advanceTo(40);
      const snapshot=writer.snapshot();const corrupt={...snapshot,instances:snapshot.instances.map(i=>({...i,result:{...i.result!,reportText:'tampered'}}))};
      expect(()=>new Runtime().restore(corrupt)).toThrow('IMAGING_INVALID_RESULT');
      expect(()=>writer.order({...input,patientId:'WRONG'})).toThrow('IMAGING_DEFINITION_SCOPE_DENIED');
      expect(()=>writer.order({...input,orderedAtSimulationTimeSec:11})).toThrow('IMAGING_ORDER_IDEMPOTENCY_CONFLICT');
    }
  });
  test('legacy schema-1 reports restore identically without changing checkpoint schema',()=>{
    const legacy={schemaVersion:1,instances:[{imagingInstanceId:'IMAGING:LEGACY',orderCommandId:'LEGACY',exerciseId:'EX',patientId:'P',definitionId:'D',
      packageId:'PKG',packageVersion:'1',packageHash:'H',title:'XR',modality:'XR',orderedBy:'CM',orderedAtSimulationTimeSec:0,
      availableAtSimulationTimeSec:30,repeatOrdinal:1,status:'ORDERED',authoredSource:{report:'Legacy report'}}]};
    const old=new Before(),next=new After();old.restore(legacy as never);next.restore(legacy as never);expect(next.snapshot()).toEqual(old.snapshot());
  });
});
