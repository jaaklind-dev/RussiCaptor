import TestRenderer, { act } from 'react-test-renderer';
import DemoApp from '../src/DemoApp';
import Constants from 'expo-constants';

const mockNativeStorage = jest.fn();
jest.mock('expo-sqlite/kv-store', () => ({ SQLiteStorage: function(name: string) { mockNativeStorage(name); return { getItemSync: () => null, setItemSync: jest.fn() }; } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
const valid = () => ({ name: 'RussiCaptor DEMO', slug: 'russicaptor-offline-demo', android: { package: 'com.jaaklind.RussiCaptor.demo', permissions: [], blockedPermissions: ['android.permission.INTERNET'] },
  updates: { enabled: false }, extra: { offlineDemo: { mode: 'offline-demo', schemaVersion: 1, productionAccess: false, distributable: false, publicationAuthorization: 'NOT_GRANTED' } } });
describe('offline demo bootstrap identity', () => {
  beforeEach(() => { mockNativeStorage.mockClear(); Constants.expoConfig = valid() as typeof Constants.expoConfig; });
  test('valid isolated application opens only named demo SQLite database', async () => {
    let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoApp />); });
    expect(mockNativeStorage).toHaveBeenCalledWith('russicaptor-offline-demo-v1.db');
    expect(JSON.stringify(screen.toJSON())).toContain('RussiCaptor DEMO');
    await act(async () => screen.unmount());
  });
  test.each(['canonical', 'missing', 'scheme', 'network', 'productionAccess', 'ota', 'distributable'])('invalid %s identity fails before storage or production fallback', async kind => {
    const config: any = valid();
    if (kind === 'canonical') config.android.package = 'com.jaaklind.RussiCaptor';
    if (kind === 'scheme') config.scheme = 'russicaptor';
    if (kind === 'network') config.android.blockedPermissions = [];
    if (kind === 'productionAccess') config.extra.offlineDemo.productionAccess = true;
    if (kind === 'ota') config.updates.enabled = true;
    if (kind === 'distributable') config.extra.offlineDemo.distributable = true;
    Constants.expoConfig = kind === 'missing' ? null : config;
    let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<DemoApp />); });
    expect(mockNativeStorage).not.toHaveBeenCalled();
    expect(JSON.stringify(screen.toJSON())).toContain('Käivitamine peatatud');
    await act(async () => screen.unmount());
  });
});
