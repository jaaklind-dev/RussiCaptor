import TestRenderer,{act} from 'react-test-renderer';
import DemoApplication from '../src/DemoApplication';
import {DemoStore} from '../src/DemoStore';
import {BackHandler} from 'react-native';
const mockProductionInit=jest.fn(()=>{throw new Error('PRODUCTION_INITIALIZED');});
jest.mock('@/services/SupabaseService',()=>mockProductionInit());
jest.mock('@/services/authorization/OperatorSessionService',()=>mockProductionInit());
jest.mock('@/services/CloudSyncService',()=>mockProductionInit());
jest.mock('@/services/RuntimeCheckpointSyncService',()=>mockProductionInit());
function setup(){const map=new Map<string,string>();const storage={getItemSync:(key:string)=>map.get(key)??null,setItemSync:(key:string,v:string)=>{map.set(key,v);}};return {store:new DemoStore(storage),storage};}
function button(screen:TestRenderer.ReactTestRenderer,label:string){return screen.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];}
describe('mounted offline demo foundation',()=>{
  beforeEach(()=>mockProductionInit.mockClear());
  test('home patient back and reset keep banner and never initialize production',async()=>{const {store}=setup();const exit=jest.fn();let screen!:TestRenderer.ReactTestRenderer;
    await act(async()=>{screen=TestRenderer.create(<DemoApplication store={store} onExit={exit}/>);});
    expect(JSON.stringify(screen.toJSON())).toContain('RussiCaptor DEMO');
    await act(async()=>button(screen,'Ava näidispatsient').props.onPress());
    const stale=button(screen,'Tagasi demo avalehele').props.onPress;
    expect(JSON.stringify(screen.toJSON())).toContain('Demo patsient A');
    expect(JSON.stringify(screen.toJSON())).toContain('DEMO · AINULT SÜNTEETILISED ANDMED');
    await act(async()=>button(screen,'Taasta demo algseis').props.onPress());
    await act(async()=>stale());expect(store.getSnapshot()).toMatchObject({generation:1,screen:'home',visits:0});
    await act(async()=>button(screen,'Välju demost').props.onPress());expect(exit).toHaveBeenCalledTimes(1);expect(mockProductionInit).not.toHaveBeenCalled();
    await act(async()=>screen.unmount());});
  test('storage errors render bounded message and disable all work',async()=>{const {store,storage}=setup();let screen!:TestRenderer.ReactTestRenderer;
    await act(async()=>{screen=TestRenderer.create(<DemoApplication store={store} onExit={jest.fn()}/>);});
    storage.setItemSync=()=>{throw new Error('PRIVATE_SECRET_DO_NOT_RENDER');};
    await act(async()=>button(screen,'Ava näidispatsient').props.onPress());const output=JSON.stringify(screen.toJSON());expect(output).toContain('salvestus pole saadaval');expect(output).not.toContain('PRIVATE_SECRET');expect(button(screen,'Ava näidispatsient')).toBeUndefined();await act(async()=>screen.unmount());});
  test('Android back listener is removed on unmount',async()=>{const remove=jest.fn();const spy=jest.spyOn(BackHandler,'addEventListener').mockReturnValue({remove});const {store}=setup();let screen!:TestRenderer.ReactTestRenderer;
    await act(async()=>{screen=TestRenderer.create(<DemoApplication store={store} onExit={jest.fn()}/>);});await act(async()=>screen.unmount());expect(remove).toHaveBeenCalled();spy.mockRestore();});
});
