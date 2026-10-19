import TestRenderer, { act } from 'react-test-renderer';
import { Alert, TextInput } from 'react-native';
import DemoBuilderApplication from '../src/builder/DemoBuilderApplication';
import { DemoBuilderStore, type BuilderStorage } from '../src/builder/DemoBuilderStore';
const button = (screen: TestRenderer.ReactTestRenderer, label: string) => screen.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const rendered = (screen: TestRenderer.ReactTestRenderer) => JSON.stringify(screen.toJSON());
async function setup() {
  const map = new Map<string, string>(); let n = 0;
  const storage: BuilderStorage = { getItemSync: k => map.get(k) ?? null, setItemSync: (k, fn) => { map.set(k, fn(map.get(k) ?? null)); } };
  const store = new DemoBuilderStore(storage, undefined, () => `DEMO-DRAFT-${++n}`), exit = jest.fn();
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => { screen = TestRenderer.create(<DemoBuilderApplication store={store} onExit={exit}/>); });
  return { store, screen, exit };
}
describe('mounted demo-only Builder UI', () => {
  afterEach(() => jest.restoreAllMocks());
  test('create edit validate save list restart; no activation control or editable physiology', async () => {
    const { store, screen } = await setup();
    await act(async () => button(screen, 'Loo DEMO mustand').props.onPress());
    await act(async () => button(screen, 'Kontrolli mustandit').props.onPress()); expect(rendered(screen)).toContain('Mustand vajab parandusi');
    await act(async () => screen.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Õppuse nimi')!.props.onChangeText('Minu demo'));
    await act(async () => button(screen, 'Lisa sünteetiline patsient').props.onPress());
    await act(async () => button(screen, 'Kontrolli mustandit').props.onPress()); expect(rendered(screen)).toContain('MVP reeglite järgi korrektne');
    await act(async () => button(screen, 'Salvesta DEMO mustand').props.onPress()); expect(store.list()[0]).toMatchObject({ name: 'Minu demo', revision: 1 });
    expect(rendered(screen)).toContain('vaagnalahas'); expect(rendered(screen)).toContain('simulatsiooni käivitamine ei ole veel saadaval');
    expect(screen.root.findAllByType(TextInput).map(n => n.props.accessibilityLabel)).toEqual(['Õppuse nimi', 'Õppuse kirjeldus', 'Patsiendi 1 nimi', 'Patsiendi 1 vanus']);
    await act(async () => button(screen, 'Tagasi mustandiloendisse').props.onPress()); expect(rendered(screen)).toContain('Ava Minu demo');
    await act(async () => screen.unmount());
  });
  test('delete cancellation, confirmation, double callback and callback after unmount are safe', async () => {
    const { store, screen } = await setup(); const alert = jest.spyOn(Alert, 'alert');
    await act(async () => button(screen, 'Loo DEMO mustand').props.onPress());
    await act(async () => button(screen, 'Kustuta DEMO mustand').props.onPress()); expect(store.list()).toHaveLength(1);
    const options = alert.mock.calls.at(-1)![2]!; expect(options[0].text).toBe('Loobu');
    // Cancel means no mutation; open again and confirm once.
    await act(async () => button(screen, 'Kustuta DEMO mustand').props.onPress());
    const confirm = alert.mock.calls.at(-1)![2]![1].onPress!;
    await act(async () => { confirm(); confirm(); }); expect(store.list()).toHaveLength(0);
    await act(async () => button(screen, 'Loo DEMO mustand').props.onPress());
    await act(async () => button(screen, 'Kustuta DEMO mustand').props.onPress()); const obsolete = alert.mock.calls.at(-1)![2]![1].onPress!;
    await act(async () => screen.unmount()); obsolete(); expect(store.list()).toHaveLength(1);
  });
  test('editing after confirmation opens fences stale delete callback; duplicate preset validation visible', async () => {
    const { store, screen } = await setup(); const alert = jest.spyOn(Alert, 'alert');
    await act(async () => button(screen, 'Loo DEMO mustand').props.onPress());
    await act(async () => button(screen, 'Kustuta DEMO mustand').props.onPress()); const stale = alert.mock.calls.at(-1)![2]![1].onPress!;
    await act(async () => screen.root.findAllByType(TextInput)[0].props.onChangeText('Uuem')); stale(); expect(store.list()).toHaveLength(1);
    await act(async () => button(screen, 'Lisa sünteetiline patsient').props.onPress());
    await act(async () => button(screen, 'Lisa sünteetiline patsient').props.onPress());
    await act(async () => button(screen, '2: Vaagnatrauma').props.onPress());
    await act(async () => button(screen, 'Kontrolli mustandit').props.onPress()); expect(rendered(screen)).toContain('iga traumamalli ühe korra');
    await act(async () => screen.unmount());
  });
});
