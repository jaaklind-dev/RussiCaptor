import TestRenderer, { act } from 'react-test-renderer';
import { Alert, AppState } from 'react-native';
import DemoRuntimeApplication from '../src/runtime/DemoRuntimeApplication';
import { DemoSessionStore, DEMO_RUNTIME_KEY } from '../src/runtime/DemoSession';
const mockProductionInit = jest.fn(() => { throw Error('PRODUCTION_INITIALIZATION_FORBIDDEN'); });
jest.mock('@/services/SupabaseService', () => mockProductionInit());
jest.mock('@/services/authorization/OperatorSessionService', () => mockProductionInit());
jest.mock('@/services/CloudSyncService', () => mockProductionInit());
jest.mock('@/services/RuntimeCheckpointSyncService', () => mockProductionInit());
const button = (screen: TestRenderer.ReactTestRenderer, label: string) => screen.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
function fixture(raw?: string) {
  const map = new Map<string,string>(); if (raw) map.set(DEMO_RUNTIME_KEY, raw); let id = 0;
  const storage = { getItemSync: (key: string) => map.get(key) ?? null, setItemSync: (key: string, value: string) => { map.set(key, value); } };
  return { store: new DemoSessionStore(storage, () => `DEMO-LOCAL-ui-${++id}`), map, storage };
}
const state = (store: DemoSessionStore) => { const v = store.getSnapshot(); if (v.status !== 'READY') throw Error('TEST_RECOVERY_STATE'); return v.session; };
describe('mounted interactive demo CM/EXCON with real domain state', () => {
  beforeEach(() => { jest.useFakeTimers(); mockProductionInit.mockClear(); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true }); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  test('home starts one exercise, CM acts once, EXCON sees the same result and clock', async () => {
    const clear = jest.spyOn(global, 'clearInterval'); const { store } = fixture(); let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={jest.fn()} />); });
    await act(async () => button(screen, 'Alusta demoõppust').props.onPress());
    expect(state(store).mode).toBe('CM'); expect(JSON.stringify(screen.toJSON())).toContain('Sünteetiline patsient A');
    expect(JSON.stringify(screen.toJSON())).toContain('Sünteetiline patsient B');
    const action = button(screen, 'Paigalda vaagnavöö (DEMO)').props.onPress;
    await act(async () => { action(); action(); action(); });
    expect(state(store).commands).toHaveLength(1); expect(button(screen, 'Paigalda vaagnavöö (DEMO)').props.disabled).toBe(true);
    await act(async () => jest.advanceTimersByTime(3000)); const time = state(store).time;
    await act(async () => button(screen, 'EXCON').props.onPress());
    expect(state(store).time).toBe(time); expect(JSON.stringify(screen.toJSON())).toContain('Vaagnavöö paigaldatud patsiendile A');
    expect(JSON.stringify(screen.toJSON())).toContain('DEMO · AINULT SÜNTEETILISED ANDMED');
    await act(async () => button(screen, 'Peata').props.onPress()); await act(async () => jest.advanceTimersByTime(20_000)); expect(state(store).time).toBe(time);
    await act(async () => button(screen, 'Jätka').props.onPress()); await act(async () => jest.advanceTimersByTime(1000)); expect(state(store).time).toBe(time + 1);
    await act(async () => button(screen, 'CM').props.onPress()); expect(state(store).commands).toHaveLength(1);
    expect(mockProductionInit).not.toHaveBeenCalled(); const stoppedTime = state(store).time;
    await act(async () => screen.unmount()); expect(clear).toHaveBeenCalled();
    jest.runOnlyPendingTimers(); expect(state(store).time).toBe(stoppedTime);
  });
  test('patient selection, pause and mode changes do not bypass the local action guard', async () => {
    const { store } = fixture(); let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={jest.fn()} />); });
    await act(async () => button(screen, 'CM').props.onPress()); expect(button(screen, 'Paigalda vaagnavöö (DEMO)').props.disabled).toBe(true);
    await act(async () => button(screen, 'Avaleht').props.onPress()); await act(async () => button(screen, 'Alusta demoõppust').props.onPress());
    const stale = button(screen, 'Paigalda vaagnavöö (DEMO)').props.onPress;
    await act(async () => button(screen, 'Vali Sünteetiline patsient B').props.onPress());
    expect(button(screen, 'Paigalda vaagnavöö (DEMO)')).toBeUndefined(); await act(async () => stale()); expect(state(store).commands).toHaveLength(0);
    await act(async () => screen.unmount());
  });
  test('AppState background pauses, callbacks are removed and foreground requires manual resume', async () => {
    const remove = jest.fn(); const listener = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
    const { store } = fixture(); let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={jest.fn()} />); });
    await act(async () => button(screen, 'Alusta demoõppust').props.onPress()); await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => listener.mock.calls.filter(([event]) => event === 'change').forEach(([, callback]) => callback('background')));
    await act(async () => jest.advanceTimersByTime(60_000)); expect(state(store).time).toBe(2);
    await act(async () => listener.mock.calls.filter(([event]) => event === 'change').forEach(([, callback]) => callback('active')));
    expect(state(store).lifecycle).toBe('PAUSED');
    await act(async () => screen.unmount()); expect(remove).toHaveBeenCalled(); jest.runOnlyPendingTimers(); expect(state(store).time).toBe(2);
  });
  test('reset requires confirmation, cancellation does nothing, old confirmations cannot reset a new session', async () => {
    const alert = jest.spyOn(Alert, 'alert'); const { store } = fixture(); let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={jest.fn()} />); });
    await act(async () => button(screen, 'Alusta demoõppust').props.onPress()); await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => button(screen, 'Taasta demo algseis').props.onPress());
    expect(state(store).time).toBe(2); expect(alert.mock.calls.at(-1)?.[2]?.find(b => b.text === 'Loobu')?.style).toBe('cancel');
    const confirm = alert.mock.calls.at(-1)?.[2]?.find(b => b.text === 'Taasta')?.onPress;
    expect(confirm).toBeDefined(); await act(async () => confirm?.()); expect(state(store)).toMatchObject({ generation: 1, time: 0, mode: 'home', commands: [], events: [] });
    const id = state(store).sessionId; await act(async () => confirm?.()); await act(async () => jest.advanceTimersByTime(10_000));
    expect(state(store).sessionId).toBe(id); expect(state(store).time).toBe(0); await act(async () => screen.unmount());
  });
  test('corrupt storage shows bounded recovery and explicit reset instead of a fabricated session', async () => {
    const alert = jest.spyOn(Alert, 'alert'); const { store } = fixture('{PRIVATE_SECRET_BROKEN'); let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={jest.fn()} />); });
    expect(JSON.stringify(screen.toJSON())).toContain('ei ole usaldusväärne'); expect(JSON.stringify(screen.toJSON())).not.toContain('PRIVATE_SECRET');
    expect(button(screen, 'Alusta demoõppust')).toBeUndefined(); await act(async () => button(screen, 'Proovi demo taastamist').props.onPress());
    expect(store.getSnapshot().status).toBe('RECOVERY_REQUIRED'); await act(async () => button(screen, 'Taasta demo algseis').props.onPress());
    await act(async () => alert.mock.calls.at(-1)?.[2]?.find(b => b.text === 'Taasta')?.onPress?.());
    expect(state(store).time).toBe(0); expect(JSON.stringify(screen.toJSON())).toContain('RussiCaptor DEMO'); await act(async () => screen.unmount());
  });
  test('supported exit pauses before leaving and never invokes production authentication', async () => {
    const { store } = fixture(); const exit = jest.fn(); let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={exit} />); });
    await act(async () => button(screen, 'Alusta demoõppust').props.onPress()); await act(async () => button(screen, 'Välju demost').props.onPress());
    expect(exit).toHaveBeenCalledTimes(1); expect(state(store).lifecycle).toBe('PAUSED'); expect(mockProductionInit).not.toHaveBeenCalled(); await act(async () => screen.unmount());
  });
  test('a valid rendered gesture uses dispatch-time local clock, not stale render time', async () => {
    const { store } = fixture(); let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={jest.fn()} />); });
    await act(async () => button(screen, 'Alusta demoõppust').props.onPress());
    const gesture = button(screen, 'Paigalda vaagnavöö (DEMO)').props.onPress;
    await act(async () => jest.advanceTimersByTime(2000)); await act(async () => gesture());
    expect(state(store).commands).toHaveLength(1); expect(state(store).commands[0].time).toBe(2);
    await act(async () => screen.unmount());
  });
});
