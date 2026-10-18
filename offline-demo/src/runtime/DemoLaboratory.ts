import type { LaboratoryOrder, LaboratorySample, LaboratoryResultGroup, LabResultGroupType } from '../../../src/models/LaboratoryWorkflow';
import { generateNarvaLabPhysiology } from '../../../src/services/runtime/laboratory/NarvaLabPhysiologyV1Generator';
import { buildLaboratoryResultPresentation } from '../../../src/components/patient/LaboratoryResultPresentation';
import type { DemoPatient } from './DemoDomain';

/** New synthetic DEMO panel, not a Narva package or a production authorization. */
export const DEMO_LAB_PANEL = 'DEMO_TRAUMA_BASIC_V1' as const;
export const DEMO_LAB_SOURCE = 'russicaptor.demo-laboratory@1.0.0';
// Explicit demo-authored delay. Frozen Narva 25/30/40 minute delays are NOT changed.
export const DEMO_LAB_DELAY_SEC = 30;
export const DEMO_LAB_ANALYTES = Object.freeze(['LAB_HB', 'LAB_HCT', 'LAB_LACTATE', 'LAB_PH', 'LAB_K', 'LAB_NA', 'LAB_GLUCOSE']);
const required: Readonly<Partial<Record<LabResultGroupType, readonly string[]>>> = {
  ASTRUP: ['LAB_LACTATE', 'LAB_PH'], HEMATOLOGY: ['LAB_HB', 'LAB_HCT'], CLINICAL_CHEMISTRY: ['LAB_K', 'LAB_NA', 'LAB_GLUCOSE'],
};
const groups: readonly LabResultGroupType[] = ['ASTRUP', 'HEMATOLOGY', 'CLINICAL_CHEMISTRY'];
export type DemoLabState = { orders: LaboratoryOrder[]; samples: LaboratorySample[]; resultGroups: LaboratoryResultGroup[] };
export const emptyDemoLabs = (): DemoLabState => ({ orders: [], samples: [], resultGroups: [] });
export type DemoLabCommand = Readonly<{ id: string; sessionId: string; generation: number; time: number;
  patientId: 'DEMO-PT-A' | 'DEMO-PT-B'; type: 'LAB_ORDER'; panelId: typeof DEMO_LAB_PANEL }>;

/** Narrow local orchestration adapter. No production Runtime, persistence, Auth or gateway imports. */
export function orderDemoLab(state: DemoLabState, command: DemoLabCommand, patient: DemoPatient): DemoLabState {
  if (patient.id !== command.patientId || patient.vitals.timestamp !== command.time) throw new Error('DEMO_LAB_SOURCE_INVALID');
  if (state.orders.some(o => o.patientId === patient.id)) throw new Error('DEMO_LAB_REPEAT_UNAVAILABLE');
  const displayedVitals = Object.fromEntries(Object.entries(patient.vitals.readings).map(([key, reading]) => [key, reading.current]));
  if (!['heartRate', 'systolicBp', 'diastolicBp', 'respiratoryRate', 'spo2', 'temperature'].every(key => Number.isFinite(displayedVitals[key]))) {
    throw new Error('DEMO_LAB_SOURCE_UNAVAILABLE');
  }
  const order: LaboratoryOrder = { orderId: command.id, exerciseId: command.sessionId, patientId: patient.id,
    // Catalog selector for the existing pure generator, not an exercise package binding or permission.
    packageId: 'NARVA_POLYTRAUMA', orderedAtSimulationTimeSec: command.time, orderedBy: 'OFFLINE_DEMO_LOCAL_CM', status: 'PROCESSING' };
  const sample: LaboratorySample = { sampleId: `${command.id}:sample`, orderId: order.orderId, exerciseId: command.sessionId,
    patientId: patient.id, sampledAtSimulationTimeSec: command.time, sourcePatientRevision: command.time, sourceRuntimeStateVersion: 3,
    snapshot: { schemaVersion: 1, displayedVitals, targetVitals: {}, runtimeFields: {},
      // Freeze real shared engine state at collection time; later physiology must not affect this sample.
      clinicalProcessInputs: [{ processId: patient.hemorrhage.processId, processType: 'HEMORRHAGE',
        clinicalState: structuredClone(patient.hemorrhage.clinicalState),
        runtimeContributions: structuredClone(patient.hemorrhage.outputs.runtimeContributions ?? {}) }],
      resultDelaySeconds: Object.fromEntries(groups.map(type => [type, DEMO_LAB_DELAY_SEC])) } };
  return { orders: [...state.orders, order], samples: [...state.samples, sample], resultGroups: [...state.resultGroups,
    ...groups.map(type => ({ resultGroupId: `${sample.sampleId}:${type}`, sampleId: sample.sampleId, type,
      availableAtSimulationTimeSec: command.time + DEMO_LAB_DELAY_SEC, status: 'PROCESSING' as const }))] };
}
export function advanceDemoLabs(state: DemoLabState, time: number): { state: DemoLabState; completed: string[] } {
  if (!Number.isFinite(time) || time < 0) throw new Error('DEMO_LAB_TIME_INVALID');
  const resultGroups = state.resultGroups.map(group => {
    if (group.status !== 'PROCESSING' || time < group.availableAtSimulationTimeSec) return group;
    const sample = state.samples.find(s => s.sampleId === group.sampleId)!;
    const order = state.orders.find(o => o.orderId === sample.orderId)!;
    const generated = generateNarvaLabPhysiology({ order, sample, resultGroupType: group.type });
    if (!generated) throw new Error('DEMO_LAB_RESULT_UNAVAILABLE');
    const analytes = generated.payload.analytes.filter(a => DEMO_LAB_ANALYTES.includes(a.analyteId));
    if (!required[group.type]?.every(id => analytes.some(a => a.analyteId === id && typeof a.value === 'number' && Number.isFinite(a.value)))) {
      throw new Error('DEMO_LAB_RESULT_UNAVAILABLE');
    }
    return { ...group, status: 'RESULTED' as const, generatedAtSimulationTimeSec: time,
      generationVersion: generated.generationVersion, resultPayload: { ...generated.payload, analytes,
        pendingAnalyteIds: [], notApplicableAnalyteIds: [], demoFixture: DEMO_LAB_SOURCE, synthetic: true } };
  });
  const completed: string[] = [];
  const orders = state.orders.map(order => {
    if (order.status === 'RESULTED') return order;
    const sample = state.samples.find(s => s.orderId === order.orderId)!;
    if (!resultGroups.filter(g => g.sampleId === sample.sampleId).every(g => g.status === 'RESULTED')) return order;
    completed.push(order.orderId); return { ...order, status: 'RESULTED' as const };
  });
  return { state: { ...state, orders, resultGroups }, completed };
}
export function presentDemoLabs(state: DemoLabState, patientId: string) {
  const sampleIds = new Set(state.samples.filter(s => s.patientId === patientId).map(s => s.sampleId));
  return buildLaboratoryResultPresentation(state.resultGroups.filter(g => sampleIds.has(g.sampleId)), 'NARVA_POLYTRAUMA')
    .map(group => {
      const rows = group.rows.filter(row => DEMO_LAB_ANALYTES.includes(row.analyteId));
      return { ...group, rows, resultCount: rows.filter(r => r.state === 'RESULT').length,
        unresolvedCount: rows.filter(r => r.state !== 'RESULT' && r.state !== 'NOT_APPLICABLE').length };
    });
}
