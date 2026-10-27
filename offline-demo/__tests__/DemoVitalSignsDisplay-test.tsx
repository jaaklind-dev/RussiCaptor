import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import DemoRuntimeApplication from '../src/runtime/DemoRuntimeApplication';
import { DemoSessionStore, DEMO_RUNTIME_KEY } from '../src/runtime/DemoSession';
import VitalsTab from '../../src/components/patient/VitalsTab';
import DemoVitalsCard from '../src/runtime/DemoVitalsCard';
import { measurement } from '../src/runtime/DemoDomain';

function content(node: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | string | null): string {
  if (node === null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(content).join('');
  return (node.children ?? []).map(content).join('');
}
const button = (screen: TestRenderer.ReactTestRenderer, label: string) => screen.root.findAll(
  node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
test('real demo CM and EXCON retain canonical numerical formatting through a demo time adapter without rounding engine state', async () => {
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  const map = new Map<string, string>();
  const store = new DemoSessionStore({ getItemSync: key => map.get(key) ?? null,
    setItemSync: (key, value) => { map.set(key, value); } }, () => 'DEMO-LOCAL-format');
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => { screen = TestRenderer.create(<DemoRuntimeApplication store={store} onExit={() => undefined} />); });
  await act(async () => button(screen, 'CM').props.onPress());
  await act(async () => button(screen, 'Vali Sünteetiline patsient B').props.onPress());
  const savedBefore = JSON.parse(map.get(DEMO_RUNTIME_KEY)!);
  const engineBefore = JSON.stringify(savedBefore.patients);
  // Real shared domain engines produce fractional baseline values for the thoracic fixture.
  expect(savedBefore.patients[1].vitals.readings.heartRate.current).toBe(95.75);
  expect(savedBefore.patients[1].vitals.readings.systolicBp.current).toBe(104.25);
  for (const mode of ['CM', 'EXCON', 'CM']) {
    await act(async () => button(screen, mode).props.onPress());
    const text = content(screen.toJSON());
    for (const expected of ['96 /min', '104 mmHg', '66 mmHg', '20 /min', '94 %', '36,8 °C']) expect(text).toContain(expected);
    expect(text).not.toContain('95.75'); expect(text).not.toContain('104.25');
    const cards = screen.root.findAllByType(DemoVitalsCard);
    const thoracic = cards.find(card => card.props.patient.id === 'DEMO-PT-B')!;
    const numeric = measurement(thoracic.props.patient, thoracic.props.sessionId);
    expect(numeric.heartRate).toBe(95.75);
    // Mount the canonical component separately with the exact same numeric measurement.
    let canonical!: TestRenderer.ReactTestRenderer;
    await act(async () => { canonical = TestRenderer.create(<VitalsTab readOnly
      measurements={[numeric]} onRecord={() => false} />); });
    for (const expected of ['96 /min', '104 mmHg', '66 mmHg', '20 /min', '94 %', '36,8 °C']) expect(content(canonical.toJSON())).toContain(expected);
    await act(async () => canonical.unmount());
    expect(JSON.stringify(JSON.parse(map.get(DEMO_RUNTIME_KEY)!).patients)).toBe(engineBefore);
  }
  await act(async () => screen.unmount());
});
