import TestRenderer, { act } from 'react-test-renderer';
import { Alert, AppState, Share } from 'react-native';
import Constants from 'expo-constants';
import DemoApp from '../src/DemoApp';
import { DEMO_STORAGE_KEY } from '../src/DemoStore';
import { DEMO_UPGRADE_NOTICE_KEY } from '../src/DemoUpgrade';
import { DemoSessionStore, DEMO_RUNTIME_KEY } from '../src/runtime/DemoSession';

const mockMap = new Map<string, string>();
const mockGet = jest.fn((key: string) => mockMap.get(key) ?? null);
const mockSet = jest.fn((key: string, value: string) => { mockMap.set(key, value); });
jest.mock('expo-sqlite/kv-store', () => ({ SQLiteStorage: function() { return { getItemSync: mockGet, setItemSync: mockSet }; } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
const config = () => ({ name: 'RussiCaptor DEMO', slug: 'russicaptor-offline-demo', android: { package: 'com.jaaklind.RussiCaptor.demo', permissions: [], blockedPermissions: ['android.permission.INTERNET'] },
  updates: { enabled: false }, extra: { offlineDemo: { mode: 'offline-demo', schemaVersion: 1, productionAccess: false, distributable: false, publicationAuthorization: 'NOT_GRANTED' } } });
const button = (screen: TestRenderer.ReactTestRenderer, label: string) => screen.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const rendered = (screen: TestRenderer.ReactTestRenderer) => JSON.stringify(screen.toJSON());
function savedSession() {
  const store = new DemoSessionStore({ getItemSync: mockGet, setItemSync: mockSet }, () => 'DEMO-LOCAL-mounted-evidence');
  store.control('START'); store.navigate('CM'); const v = store.getSnapshot(); if (v.status !== 'READY') throw Error('TEST');
  store.command({ id: `DEMO-CMD-${v.session.sessionId}:binder`, sessionId: v.session.sessionId, generation: 0, time: 0,
    patientId: 'DEMO-PT-A', type: 'APPLY_PELVIC_BINDER' }); store.control('PAUSE'); return mockMap.get(DEMO_RUNTIME_KEY)!;
}
async function mount() { let screen!: TestRenderer.ReactTestRenderer; await act(async () => { screen = TestRenderer.create(<DemoApp />); }); return screen; }
async function longPress(screen: TestRenderer.ReactTestRenderer) {
  await act(async () => screen.root.findAll(n => typeof n.props.onLongPress === 'function')[0].props.onLongPress());
}
function confirm(label: string) { const cb = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(b => b.text === label)?.onPress; expect(cb).toBeDefined(); return cb!; }
describe('mounted explicit demo upgrade and one-shot acceptance export', () => {
  beforeEach(() => {
    jest.useFakeTimers(); mockMap.clear(); mockGet.mockClear(); mockSet.mockClear();
    Constants.expoConfig = config() as typeof Constants.expoConfig;
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  test('fresh install has no upgrade notice and no permanent clinical diagnostic button', async () => {
    const screen = await mount(); expect(rendered(screen)).toContain('Alusta demoõppust');
    expect(rendered(screen)).not.toContain('Versiooniüleminek'); expect(button(screen, 'Ekspordi')).toBeUndefined();
    expect(Share.share).not.toHaveBeenCalled(); await act(async () => screen.unmount());
  });
  test('upgrade notice gates runtime until acknowledged, then stays acknowledged after restart and reset', async () => {
    const legacy = JSON.stringify({ schemaVersion: 1, generation: 3, screen: 'patient', visits: 8 }); mockMap.set(DEMO_STORAGE_KEY, legacy);
    let screen = await mount(); expect(rendered(screen)).toContain('avamiste');
    expect(rendered(screen)).toContain('ei kanta simulatsiooni üle'); expect(rendered(screen)).toContain('Varasemaid andmeid ei kustutata');
    expect(button(screen, 'Alusta demoõppust')).toBeUndefined();
    await act(async () => button(screen, 'Selge, jätka demoga').props.onPress()); expect(mockMap.has(DEMO_UPGRADE_NOTICE_KEY)).toBe(true);
    await act(async () => screen.unmount()); screen = await mount(); expect(rendered(screen)).not.toContain('Versiooniüleminek');
    await act(async () => button(screen, 'CM').props.onPress());
    await act(async () => button(screen, 'Taasta demo algseis').props.onPress()); await act(async () => confirm('Taasta')());
    await act(async () => screen.unmount()); screen = await mount();
    expect(rendered(screen)).not.toContain('Versiooniüleminek');
    expect(screen.root.findAll(n => n.props.accessibilityLabel === 'Demo kell')[0].props.children.join('')).toBe('Valmis · T+0 s · üks kohalik kell');
    expect(mockMap.get(DEMO_STORAGE_KEY)).toBe(legacy); await act(async () => screen.unmount());
  });
  test('notice preserves an existing valid v2 session and never claims its counter was migrated', async () => {
    const before = savedSession(); mockMap.set(DEMO_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, generation: 1, screen: 'home', visits: 9 }));
    const screen = await mount(); expect(mockMap.get(DEMO_RUNTIME_KEY)).toBe(before);
    expect(rendered(screen)).toContain('Olemasolev kehtiv 0.2.0 seanss säilib');
    await act(async () => button(screen, 'Selge, jätka demoga').props.onPress());
    expect(mockMap.get(DEMO_RUNTIME_KEY)).toBe(before); expect(rendered(screen)).toContain('Vaagnavöö paigaldatud');
    await act(async () => screen.unmount());
  });
  test('a previously running v2 session retains the normal paused recovery contract while notice is visible', async () => {
    savedSession(); const store = new DemoSessionStore({ getItemSync: mockGet, setItemSync: mockSet }); store.control('RESUME');
    const raw = mockMap.get(DEMO_RUNTIME_KEY)!;
    mockMap.set(DEMO_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, generation: 0, screen: 'home', visits: 1 }));
    const screen = await mount(); await act(async () => jest.advanceTimersByTime(10_000));
    expect(mockMap.get(DEMO_RUNTIME_KEY)).toBe(raw); await act(async () => button(screen, 'Selge, jätka demoga').props.onPress());
    expect(screen.root.findAll(n => n.props.accessibilityLabel === 'Demo kell')[0].props.children.join('')).toBe('Peatatud · T+0 s · üks kohalik kell');
    expect(mockMap.get(DEMO_RUNTIME_KEY)).toBe(raw); await act(async () => screen.unmount());
  });
  test('unrecognized legacy and failing storage never expose raw error text', async () => {
    mockMap.set(DEMO_STORAGE_KEY, '{PRIVATE_SECRET'); const screen = await mount();
    expect(rendered(screen)).toContain('vormingut ei saanud kinnitada'); expect(rendered(screen)).not.toContain('PRIVATE_SECRET');
    mockSet.mockImplementationOnce(() => { throw Error('PRIVATE_SIGNING_SECRET'); });
    await act(async () => button(screen, 'Selge, jätka demoga').props.onPress());
    expect(rendered(screen)).toContain('Üleminekuteate salvestust ei saanud kinnitada'); expect(rendered(screen)).not.toContain('PRIVATE_SIGNING_SECRET');
    expect(button(screen, 'Alusta demoõppust')).toBeUndefined(); await act(async () => screen.unmount());
  });
  test('export requires a long press and confirmation; cancel causes no read/export', async () => {
    savedSession(); const screen = await mount(); mockGet.mockClear(); await longPress(screen);
    expect(Alert.alert).toHaveBeenLastCalledWith('Ekspordi DEMO vastuvõtutõend?', expect.any(String), expect.any(Array));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(b => b.text === 'Loobu')?.style).toBe('cancel');
    expect(mockGet).not.toHaveBeenCalled(); expect(Share.share).not.toHaveBeenCalled(); await act(async () => screen.unmount());
  });
  test('preview and optional sharing contain actual stored identity/status, not patient data', async () => {
    const raw = savedSession(); const screen = await mount(); await longPress(screen); await act(async () => confirm('Ekspordi')());
    expect(Alert.alert).toHaveBeenLastCalledWith('DEMO vastuvõtutõend · salvestatud rida', expect.any(String), expect.any(Array));
    const message = jest.mocked(Alert.alert).mock.calls.at(-1)![1]!; const report = JSON.parse(message);
    expect(report).toMatchObject({ source: 'PERSISTED_DEMO_ROW', commandCount: 1, generation: 0, simulationTimeSec: 0,
      commands: [{ id: JSON.parse(raw).commands[0].id, processingStatus: 'APPLIED_EVENT_VERIFIED' }] });
    expect(message).not.toContain('patients'); expect(message).not.toContain('DEMO-PT-A');
    expect(Share.share).not.toHaveBeenCalled(); await act(async () => confirm('Jaga tõendit')());
    expect(Share.share).toHaveBeenCalledWith({ title: 'RussiCaptor DEMO vastuvõtutõend', message });
    expect(mockMap.get(DEMO_RUNTIME_KEY)).toBe(raw); await act(async () => screen.unmount());
  });
  test('stale export confirmation after reset is rejected without a false identity record', async () => {
    savedSession(); const screen = await mount(); await longPress(screen); const oldExport = confirm('Ekspordi');
    await act(async () => button(screen, 'Taasta demo algseis').props.onPress()); await act(async () => confirm('Taasta')());
    const raw = mockMap.get(DEMO_RUNTIME_KEY); await act(async () => oldExport());
    expect(rendered(screen)).toContain('Tõendit ei eksporditud'); expect(Share.share).not.toHaveBeenCalled(); expect(mockMap.get(DEMO_RUNTIME_KEY)).toBe(raw);
    await longPress(screen); await act(async () => confirm('Ekspordi')());
    const proof = JSON.parse(jest.mocked(Alert.alert).mock.calls.at(-1)![1]!);
    expect(proof).toMatchObject({ generation: 1, commandCount: 0, resetTransition: { status: 'PERSISTED_BEFORE_AND_AFTER', fromGeneration: 0, toGeneration: 1 } });
    await act(async () => screen.unmount());
  });
  test('corrupt stored row and rejected native share expose only fixed bounded messages', async () => {
    const raw = savedSession(); const screen = await mount(); await longPress(screen); mockMap.set(DEMO_RUNTIME_KEY, '{PRIVATE_SECRET');
    await act(async () => confirm('Ekspordi')()); expect(rendered(screen)).not.toContain('PRIVATE_SECRET');
    expect(rendered(screen)).toContain('Tõendit ei eksporditud'); expect(Share.share).not.toHaveBeenCalled();
    mockMap.set(DEMO_RUNTIME_KEY, raw); await longPress(screen); await act(async () => confirm('Ekspordi')());
    jest.mocked(Share.share).mockRejectedValueOnce(Error('PRIVATE_NATIVE_SHARE_SECRET'));
    await act(async () => confirm('Jaga tõendit')()); expect(rendered(screen)).toContain('jagamine ei õnnestunud');
    expect(rendered(screen)).not.toContain('PRIVATE_NATIVE_SHARE_SECRET'); await act(async () => screen.unmount());
  });
});
