import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { Patient } from '@/models/Patient';
import type { VitalSigns } from '@/models/VitalSigns';
import type { InstructorPatientCardModel } from '@/models/InstructorDashboard';
import type { InspectorClinicalStateModel } from '@/models/InstructorPatientInspector';
import type { CanonicalPatientRuntimeSnapshot } from '@/services/RuntimeSnapshotService';
import { VitalSignEngine, defaultVitalSignConfiguration } from '@/services/runtime/vitals/VitalSignEngine';
import { projectVitalSignState } from '@/services/runtime/vitals/VitalSignProjection';
import { InstructorPatientCard } from '@/components/instructor/InstructorPatientCard';
import { InspectorClinicalState } from '@/components/instructor/InspectorClinicalState';
import OverviewTab from '../OverviewTab';
import VitalsTab from '../VitalsTab';

const measurement: VitalSigns = Object.freeze({ id: 'V', patientId: 'PT', exerciseId: 'EX', exerciseMinute: 0,
  heartRate: 95.75, systolicBloodPressure: 104.25, diastolicBloodPressure: 66.75,
  respiratoryRate: 20.75, oxygenSaturation: 94.75, temperature: 36.86, source: 'scenario' });
const clinical: InspectorClinicalStateModel = Object.freeze({ hasCanonicalRuntime: true,
  heartRate: 95.75, systolicBp: 104.25, diastolicBp: 66.75, respiratoryRate: 20.75,
  spo2: 94.75, temperature: 36.86 });
const patient: Patient = { id: 'PT', isikukood: '', name: 'Synthetic', triage: 'P1', status: 'Active',
  location: 'ED', lastSeen: '', mist: { mechanism: '', injuries: '', signs: '', treatment: '' } };
const card: InstructorPatientCardModel = { ...clinical, patientId: 'PT', name: 'Synthetic', location: 'ED',
  triage: 'P1', status: 'Stable' };
function content(node: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | string | null): string {
  if (node === null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(content).join('');
  return (node.children ?? []).map(content).join('');
}
async function rendered(element: React.ReactElement): Promise<string> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(element); });
  const text = content(renderer.toJSON());
  await act(async () => renderer.unmount());
  return text;
}
function runtime(): CanonicalPatientRuntimeSnapshot {
  const vitals = new VitalSignEngine().resolve({ timestamp: 0, configuration: defaultVitalSignConfiguration, contributors: [] }).state;
  vitals.readings.heartRate.current = 95.75; vitals.readings.systolicBp.current = 104.25;
  vitals.readings.diastolicBp.current = 66.75; vitals.readings.respiratoryRate.current = 20.75;
  vitals.readings.spo2.current = 94.75; vitals.readings.temperature.current = 36.86;
  return { state: { encounterId: 'PT', stateVersion: 0, exerciseTimeSec: 0, globalStatus: 'Stable',
    ...projectVitalSignState(vitals), vitalSignState: vitals, vitalSignConfiguration: defaultVitalSignConfiguration,
    mentalStatusCode: 'Alert', symptomTags: [], visibleFindings: [], activeAlerts: [], runtimeFields: {},
    vitalAttribution: {}, statusAttribution: { supportingProcessIds: [] }, manualOverrideActive: false,
    overrideMap: {}, aggregationConfigVersion: 'test', randomSeed: 1 }, processes: [] };
}
describe('CM and EXCON vital display consistency', () => {
  test('measurement card and history format both blood-pressure components and retain input values', async () => {
    const before = JSON.stringify(measurement);
    const text = await rendered(<VitalsTab measurements={[measurement]} onRecord={() => false} readOnly />);
    for (const value of ['104 mmHg', '67 mmHg', '96 /min', '21 /min', '95 %', '36,9 °C', 'RR 104/67 · HR 96 · RR 21 · SpO₂ 95%']) expect(text).toContain(value);
    expect(text).not.toContain('104.25'); expect(text).not.toContain('95.75');
    expect(JSON.stringify(measurement)).toBe(before);
  });
  test('overview uses the same precision for all six signs', async () => {
    const text = await rendered(<OverviewTab patient={patient} latestVitals={measurement} recentEvents={[]} />);
    for (const value of ['104/67 mmHg', '96 /min', '21 /min', '95 %', '36,9 °C']) expect(text).toContain(value);
  });
  test('canonical current card is formatted without altering its snapshot', async () => {
    const snapshot = runtime(); const before = JSON.stringify(snapshot);
    const text = await rendered(<VitalsTab measurements={[]} canonicalRuntime={snapshot} onRecord={() => false} readOnly />);
    for (const value of ['104/67 mmHg', '96 /min', '21 /min', '95 %', '36,9 °C']) expect(text).toContain(value);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  test('EXCON dashboard and inspector match the CM rounding policy', async () => {
    const before = JSON.stringify({ card, clinical });
    const dashboard = await rendered(<InstructorPatientCard patient={card} onPress={() => undefined} />);
    for (const value of ['SBP 104', 'HR 96', 'RR 21', 'SpO₂ 95%']) expect(dashboard).toContain(value);
    const inspector = await rendered(<InspectorClinicalState state={clinical} />);
    for (const value of ['BP 104/67', 'HR 96', 'RR 21', 'SpO₂ 95%', 'Temp 36,9°C']) expect(inspector).toContain(value);
    expect(JSON.stringify({ card, clinical })).toBe(before);
  });
  test.each(['NO_SIGNAL', 'POOR'] as const)('preserves %s pulse-ox signal messages in all runtime views', async quality => {
    const snapshot = runtime();
    const base = snapshot.state.vitalSignState!;
    const withSignal = { ...snapshot, state: { ...snapshot.state, vitalSignState: { ...base,
      pulseOx: { ...base.pulseOx, signalQuality: quality, measuredSpO2: 94.75 } } } } as CanonicalPatientRuntimeSnapshot;
    const expected = quality === 'NO_SIGNAL' ? 'signaal puudub' : 'signaal ebausaldusväärne';
    const views = [<VitalsTab key="v" measurements={[]} canonicalRuntime={withSignal} onRecord={() => false} />,
      <InstructorPatientCard key="d" patient={{ ...card, pulseOxSignalQuality: quality }} onPress={() => undefined} />,
      <InspectorClinicalState key="i" state={{ ...clinical, pulseOxSignalQuality: quality }} />];
    for (const view of views) expect((await rendered(view)).toLowerCase()).toContain(expected);
  });
  test('missing and non-finite measurements are dashes, not zeros or NaN', async () => {
    const text = await rendered(<VitalsTab measurements={[{ ...measurement, heartRate: NaN,
      systolicBloodPressure: Infinity, diastolicBloodPressure: undefined, respiratoryRate: 0,
      oxygenSaturation: 0, temperature: 36 }]} onRecord={() => false} />);
    expect(text).toContain('0 /min'); expect(text).toContain('0 %'); expect(text).toContain('36,0 °C');
    expect(text).not.toContain('NaN'); expect(text).not.toContain('Infinity');
    expect(text).toContain('RR –/–');
  });
});
