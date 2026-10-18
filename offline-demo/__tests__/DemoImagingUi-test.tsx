import TestRenderer,{act} from 'react-test-renderer';
import {AppState,Image} from 'react-native';
import DemoRuntimeApplication from '../src/runtime/DemoRuntimeApplication';
import DemoImagingCard,{resolveDemoImage} from '../src/runtime/DemoImagingCard';
import {demoImagingAsset} from '../src/runtime/DemoImaging';
import {DemoSessionStore,type DemoSession} from '../src/runtime/DemoSession';
const mockProduction=jest.fn(()=>{throw Error('PRODUCTION_INITIALIZATION_FORBIDDEN');});
jest.mock('@/services/SupabaseService',()=>mockProduction());
jest.mock('@/services/CloudSyncService',()=>mockProduction());
jest.mock('@/services/RuntimeCheckpointSyncService',()=>mockProduction());
const button=(s:TestRenderer.ReactTestRenderer,label:string)=>s.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const state=(s:DemoSessionStore):DemoSession=>{const v=s.getSnapshot();if(v.status!=='READY')throw Error('FIXTURE');return v.session;};
const rendered=(s:TestRenderer.ReactTestRenderer)=>JSON.stringify(s.toJSON());
describe('mounted local CM EXCON imaging without production initialization',()=>{
  beforeEach(()=>{jest.useFakeTimers();mockProduction.mockClear();Object.defineProperty(AppState,'currentState',{value:'active',configurable:true});});
  afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
  async function setup(){const map=new Map<string,string>();let id=0;const store=new DemoSessionStore({getItemSync:k=>map.get(k)??null,setItemSync:(k,v)=>{map.set(k,v);}},()=>`DEMO-LOCAL-imaging-ui-${++id}`);
    let screen!:TestRenderer.ReactTestRenderer;await act(async()=>{screen=TestRenderer.create(<DemoRuntimeApplication store={store} onExit={jest.fn()}/>);});return{store,screen};}
  test('initial, pending, processing, resulted share state; rapid clicks and repeat cannot submit a second command',async()=>{
    const {store,screen}=await setup();await act(async()=>button(screen,'CM').props.onPress());expect(button(screen,'Telli DEMO Vaagna röntgen').props.disabled).toBe(true);
    await act(async()=>button(screen,'Avaleht').props.onPress());await act(async()=>button(screen,'Alusta demoõppust').props.onPress());
    expect(rendered(screen)).toContain('Tellimata');const press=button(screen,'Telli DEMO Vaagna röntgen').props.onPress;
    await act(async()=>{press();press();press();});expect(state(store).commands).toHaveLength(1);expect(rendered(screen)).toContain('Tellitud');
    expect(screen.root.findAllByProps({testID:'demo-imaging-preview'})).toHaveLength(0);
    await act(async()=>jest.advanceTimersByTime(29_000));expect(rendered(screen)).toContain('Töötlemisel');expect(state(store).imaging.instances[0].result).toBeUndefined();
    await act(async()=>jest.advanceTimersByTime(1000));const result=state(store).imaging;expect(rendered(screen)).toContain('Tulemus olemas');
    expect(rendered(screen)).toContain('DEMO – genereeritud radioloogiline illustratsioon');expect(rendered(screen)).toContain('sünteetiline õppetekst');
    await act(async()=>press());expect(state(store).commands).toHaveLength(1);expect(button(screen,'Telli DEMO Vaagna röntgen').props.disabled).toBe(true);
    await act(async()=>button(screen,'EXCON').props.onPress());await act(async()=>button(screen,'Peata').props.onPress());
    expect(screen.root.findAllByType(DemoImagingCard).every(c=>c.props.session.imaging===state(store).imaging)).toBe(true);
    expect(rendered(screen)).toContain(result.instances[0].result!.resultId);expect(rendered(screen)).toContain('James Heilman, MD');
    await act(async()=>button(screen,'CM').props.onPress());expect(state(store).imaging).toEqual(result);expect(mockProduction).not.toHaveBeenCalled();
    await act(async()=>button(screen,'Ava DEMO pilt').props.onPress());expect(screen.root.findAllByProps({visible:true}).length).toBeGreaterThan(0);
    await act(async()=>button(screen,'Sulge DEMO pilt').props.onPress());await act(async()=>screen.unmount());
  });
  test('selection change, pause and reset fence stale handlers; native image error is visible without changing clinical result',async()=>{
    const {store,screen}=await setup();await act(async()=>button(screen,'Alusta demoõppust').props.onPress());const stale=button(screen,'Telli DEMO Vaagna röntgen').props.onPress;
    await act(async()=>button(screen,'Vali Sünteetiline patsient B').props.onPress());await act(async()=>stale());expect(state(store).commands).toHaveLength(0);
    await act(async()=>button(screen,'Telli DEMO Rindkere röntgen').props.onPress());await act(async()=>jest.advanceTimersByTime(30_000));
    const before=JSON.stringify(state(store));const image=screen.root.findAllByType(Image).find(n=>n.props.testID==='demo-imaging-preview')!;
    await act(async()=>image.props.onError({nativeEvent:{error:'SECRET_NATIVE_ERROR'}}));expect(rendered(screen)).toContain('DEMO pilti ei saanud kuvada');
    expect(rendered(screen)).not.toContain('SECRET_NATIVE_ERROR');expect(JSON.stringify(state(store))).toBe(before);
    const current=state(store);await act(async()=>{store.reset(current.sessionId,current.generation);});await act(async()=>stale());expect(state(store).commands).toHaveLength(0);
    await act(async()=>screen.unmount());
  });
  test('missing/tampered reference is visibly rejected with no remote source',async()=>{
    expect(resolveDemoImage({...demoImagingAsset('DEMO-PT-A'),sha256:'0'.repeat(64)})).toBeUndefined();
    const {store,screen}=await setup();await act(async()=>button(screen,'Alusta demoõppust').props.onPress());await act(async()=>button(screen,'Telli DEMO Vaagna röntgen').props.onPress());
    await act(async()=>jest.advanceTimersByTime(30_000));const original=state(store);
    const s={...original,imaging:{...original.imaging,instances:original.imaging.instances.map(i=>({...i,result:{...i.result!,asset:undefined}}))}};
    let missing!:TestRenderer.ReactTestRenderer;await act(async()=>{missing=TestRenderer.create(<DemoImagingCard session={s} patientId="DEMO-PT-A" onOrder={jest.fn()} disabled={false}/>);});
    expect(rendered(missing)).toContain('DEMO tulemuse pilt puudub');expect(s.imaging.instances[0].status).toBe('RESULTED');
    await act(async()=>{missing.unmount();screen.unmount();});
  });
});
