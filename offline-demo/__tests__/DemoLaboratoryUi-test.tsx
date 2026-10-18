import TestRenderer, {act} from 'react-test-renderer';
import {AppState} from 'react-native';
import DemoRuntimeApplication from '../src/runtime/DemoRuntimeApplication';
import DemoLaboratoryCard from '../src/runtime/DemoLaboratoryCard';
import {DemoSessionStore, type DemoSession} from '../src/runtime/DemoSession';
const button=(s:TestRenderer.ReactTestRenderer,label:string)=>s.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const state=(s:DemoSessionStore):DemoSession=>{const v=s.getSnapshot();if(v.status!=='READY')throw Error('FIXTURE');return v.session;};
const text=(s:TestRenderer.ReactTestRenderer)=>JSON.stringify(s.toJSON());
describe('mounted local CM/EXCON laboratory controls',()=>{
  beforeEach(()=>{jest.useFakeTimers();Object.defineProperty(AppState,'currentState',{value:'active',configurable:true});});
  afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
  async function setup(){const map=new Map<string,string>();let id=0;const store=new DemoSessionStore({getItemSync:k=>map.get(k)??null,setItemSync:(k,v)=>{map.set(k,v);}},()=>`DEMO-LOCAL-lab-ui-${++id}`);let screen!:TestRenderer.ReactTestRenderer;
    await act(async()=>{screen=TestRenderer.create(<DemoRuntimeApplication store={store} onExit={()=>undefined}/>);});return{store,screen};}
  test('panel disabled before RUNNING; rapid presses create one pending request and EXCON observes same released identities',async()=>{
    const {store,screen}=await setup();await act(async()=>button(screen,'CM').props.onPress());
    expect(button(screen,'Telli DEMO trauma põhipaneel').props.disabled).toBe(true);
    await act(async()=>button(screen,'Avaleht').props.onPress());await act(async()=>button(screen,'Alusta demoõppust').props.onPress());
    const press=button(screen,'Telli DEMO trauma põhipaneel').props.onPress;await act(async()=>{press();press();press();});
    const id=state(store).commands[0].id;expect(state(store).commands).toHaveLength(1);expect(text(screen)).toContain('Proov võetud · ootel');
    expect(button(screen,'Telli DEMO trauma põhipaneel').props.disabled).toBe(true);expect(text(screen)).not.toContain('PHYSIOLOGY_V1');
    await act(async()=>jest.advanceTimersByTime(5000));expect(text(screen)).toContain('T+5 s');expect(text(screen)).not.toContain('0.083333');
    await act(async()=>button(screen,'EXCON').props.onPress());await act(async()=>button(screen,'Peata').props.onPress());
    await act(async()=>jest.advanceTimersByTime(60_000));expect(state(store).time).toBe(5);expect(state(store).laboratory.orders[0].status).toBe('PROCESSING');
    await act(async()=>button(screen,'Jätka').props.onPress());await act(async()=>jest.advanceTimersByTime(25_000));
    expect(state(store).time).toBe(30);expect(state(store).laboratory.orders[0]).toMatchObject({orderId:id,status:'RESULTED'});
    expect(text(screen)).toContain(id);expect(text(screen)).toContain('Tulemus olemas');expect(text(screen)).toContain('DEMO laboritulemus valmis');
    const result=state(store).laboratory;await act(async()=>button(screen,'CM').props.onPress());
    const card=screen.root.findAllByType(DemoLaboratoryCard)[0];expect(card.props.session.laboratory).toEqual(result);
    expect(text(screen)).toContain('Kordustellimine pole selles demoetapis saadaval');expect(state(store).commands).toHaveLength(1);
    await act(async()=>screen.unmount());
  });
  test('stale patient handler and paused dispatch cannot submit; labs do not disable binder',async()=>{
    const {store,screen}=await setup();await act(async()=>button(screen,'Alusta demoõppust').props.onPress());
    const stale=button(screen,'Telli DEMO trauma põhipaneel').props.onPress;
    await act(async()=>button(screen,'Vali Sünteetiline patsient B').props.onPress());await act(async()=>stale());expect(state(store).commands).toHaveLength(0);
    await act(async()=>button(screen,'Vali Sünteetiline patsient A').props.onPress());await act(async()=>button(screen,'Telli DEMO trauma põhipaneel').props.onPress());
    expect(button(screen,'Paigalda vaagnalahas (DEMO)').props.disabled).toBe(false);
    await act(async()=>button(screen,'Paigalda vaagnalahas (DEMO)').props.onPress());expect(state(store).commands).toHaveLength(2);
    await act(async()=>button(screen,'EXCON').props.onPress());await act(async()=>button(screen,'Peata').props.onPress());await act(async()=>button(screen,'CM').props.onPress());
    await act(async()=>button(screen,'Vali Sünteetiline patsient B').props.onPress());const paused=button(screen,'Telli DEMO trauma põhipaneel');expect(paused.props.disabled).toBe(true);
    await act(async()=>paused.props.onPress());expect(state(store).commands).toHaveLength(2);await act(async()=>screen.unmount());
  });
});
