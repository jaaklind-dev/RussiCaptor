import React from 'react';
import renderer, { act } from 'react-test-renderer';
import OrdersTab from '../OrdersTab';
import type { Order } from '@/models/Order';
import type { RuntimeCheckpointEnvelope } from '@/models/RuntimeCheckpointAuthority';
import type { SharedExerciseState } from '@/models/SharedExerciseState';
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from '@/repositories/ExerciseSessionRepository';
import { acceptRuntimeReaderCheckpoint, advertiseRuntimeReaderCheckpoint, beginRuntimeReaderConvergence,
  resetRuntimeReaderConvergence, setRuntimeReaderConvergenceUnavailable, setRuntimeCommandAuthorityWriter } from '@/services/runtime/persistence/RuntimeReaderConvergenceService';
import { runtimePatientCommandSubmissionReadiness, setRuntimePatientCommandGateway } from '@/services/runtime/commands/RuntimePatientCommandService';
import { submitImagingOrder } from '@/services/runtime/imaging/ImagingWorkflowCommandService';
import { InMemoryRuntimePatientCommandGateway } from '@/services/runtime/commands/InMemoryRuntimePatientCommandGateway';
import { getRuntimeCommandReadinessDiagnostics } from '@/services/runtime/commands/RuntimeCommandReadinessDiagnostics';
import { observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics } from '@/services/sharedWorkflow/SharedWorkflowMutationService';

const ex = 'SYNTHETIC-EX', patient = 'SYNTHETIC-PT';
const original = getCanonicalExerciseSnapshot();
const checkpoint = (revision = 17, time = 912) => ({ exerciseId: ex, checkpointRevision: revision,
  payloadHash: `H-${revision}`, provenanceHash: 'P', persistedRuntimeVersion: 1,
  payload: { exerciseSession: { exerciseId: ex, lifecycleState: 'RUNNING', simulationTimeSec: time,
    speed: 1, version: 2, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 } } }) as RuntimeCheckpointEnvelope<SharedExerciseState>;
const order = { id: 'ORDER', exerciseId: ex, patientId: patient, category: 'imaging', title: 'ChestXR',
  status: 'available', visibility: 'available' } as Order;
let tree: renderer.ReactTestRenderer | undefined;
let submit: jest.Mock;
let log: jest.SpyInstance;
const send = () => submitImagingOrder(ex, patient, 'IMG-001', 'ONE-INTENT');
const button = () => tree!.root.findAllByProps({ accessibilityLabel: 'Telli ChestXR' })
  .find(node => typeof node.props.onPress === 'function')!;
const mount = async (onPlaceOrder: () => unknown = send, readOnly = false) => {
  await act(async () => { tree = renderer.create(<OrdersTab orders={[order]} readOnly={readOnly}
    onPlaceOrder={async () => { await onPlaceOrder(); }} />); });
};
beforeEach(() => {
  resetRuntimeReaderConvergence(); resetSharedWorkflowConflictMetrics();
  replaceCanonicalExerciseSnapshot(checkpoint().payload.exerciseSession as ReturnType<typeof getCanonicalExerciseSnapshot>);
  observeSharedWorkflowHead(ex, patient, 4, 'CM');
  submit = jest.fn(async () => ({ status: 'APPLIED' as const, patientRevision: 5, ownerUserId: 'CM', commandSequence: 1 }));
  setRuntimePatientCommandGateway({ submit, loadAfter: async () => [], record: async () => {} });
  beginRuntimeReaderConvergence(ex);
  log = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  act(() => tree?.unmount()); tree = undefined;
  resetRuntimeReaderConvergence(); resetSharedWorkflowConflictMetrics();
  setRuntimePatientCommandGateway(undefined); replaceCanonicalExerciseSnapshot(original); log.mockRestore();
});
test('connecting reader disables action and does not imply submission', async () => {
  await mount(); expect(button().props.disabled).toBe(true);
  expect(tree!.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
  await act(async () => { button().props.onPress(); }); expect(submit).not.toHaveBeenCalled();
});
test.each(['hydration', 'reconnect', 'writer generation'])('%s converges reactively without navigation', async stage => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); await mount(); expect(button().props.disabled).toBe(false);
  act(() => {
    if (stage === 'reconnect') setRuntimeReaderConvergenceUnavailable(ex, 'AUTHORITY_UNAVAILABLE');
    else advertiseRuntimeReaderCheckpoint({ exerciseId: ex, checkpointRevision: 18, payloadHash: 'H-18',
      provenanceHash: 'P', writerInstanceId: stage === 'writer generation' ? 'NEW-WRITER' : 'WRITER' });
  });
  expect(button().props.disabled).toBe(true);
  act(() => { acceptRuntimeReaderCheckpoint(checkpoint(stage === 'reconnect' ? 17 : 18), 'REMOTE'); });
  expect(button().props.disabled).toBe(false);
});
test('initial hydration becomes ready automatically', async () => {
  await mount(); act(() => { acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); });
  expect(button().props.disabled).toBe(false);
});
test('wrong exercise and selection changes fail closed', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); await mount();
  act(() => { beginRuntimeReaderConvergence('OTHER'); }); expect(button().props.disabled).toBe(true);
  act(() => { beginRuntimeReaderConvergence(ex); acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); }); expect(button().props.disabled).toBe(false);
  act(() => { replaceCanonicalExerciseSnapshot({ ...getCanonicalExerciseSnapshot(), exerciseId: 'OTHER' }); });
  expect(button().props.disabled).toBe(true);
});
test('canonical clock update disables until exact checkpoint accepted', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); await mount();
  act(() => { replaceCanonicalExerciseSnapshot({ ...getCanonicalExerciseSnapshot(), simulationTimeSec: 913 }); });
  expect(button().props.disabled).toBe(true); expect((await send()).status).toBe('RECONNECT_REQUIRED');
  expect(submit).not.toHaveBeenCalled();
  act(() => { acceptRuntimeReaderCheckpoint(checkpoint(18, 913), 'REMOTE'); }); expect(button().props.disabled).toBe(false);
});
test('untracked imaging blocks in both UI and submission; writer path remains valid', async () => {
  resetRuntimeReaderConvergence(); await mount(); expect(button().props.disabled).toBe(true);
  expect((await send()).status).toBe('RECONNECT_REQUIRED'); expect(submit).not.toHaveBeenCalled();
  act(() => { setRuntimeCommandAuthorityWriter(ex); }); expect(button().props.disabled).toBe(false);
  expect((await send()).status).toBe('APPLIED');
});
test.each(['READY', 'PAUSED', 'COMPLETED'] as const)('%s lifecycle never permits imaging', async lifecycleState => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE');
  replaceCanonicalExerciseSnapshot({ ...getCanonicalExerciseSnapshot(), lifecycleState }); await mount();
  expect(button().props.disabled).toBe(true); expect((await send()).status).toBe('EXERCISE_NOT_ACTIVE');
  expect(submit).not.toHaveBeenCalled();
});
test('ownership/read-only guard hides action even when synchronized', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); await mount(send, true);
  expect(tree!.root.findAllByProps({ accessibilityLabel: 'Telli ChestXR' })).toHaveLength(0);
});
test('same-frame repeated presses and pending submission produce one invocation', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); let finish!: () => void;
  const handler = jest.fn(() => new Promise<void>(resolve => { finish = resolve; })); await mount(handler);
  const press = button().props.onPress;
  await act(async () => { press(); press(); }); expect(handler).toHaveBeenCalledTimes(1);
  expect(button().props.disabled).toBe(true);
  await act(async () => { finish(); }); expect(button().props.disabled).toBe(false);
});
test('old rendered callback rechecks readiness before invoking submission', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); const handler = jest.fn(); await mount(handler);
  const press = button().props.onPress;
  await act(async () => { setRuntimeReaderConvergenceUnavailable(ex, 'AUTHORITY_UNAVAILABLE'); press(); });
  expect(handler).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
});
test('submission guard remains mandatory if readiness changes after UI preflight', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); let result: string | undefined;
  await mount(async () => { setRuntimeReaderConvergenceUnavailable(ex, 'AUTHORITY_UNAVAILABLE'); result = (await send()).status; });
  await act(async () => { button().props.onPress(); }); expect(result).toBe('RECONNECT_REQUIRED'); expect(submit).not.toHaveBeenCalled();
});
test('idempotent retry cannot create duplicate durable command; ownership remains authoritative', async () => {
  const gateway = new InMemoryRuntimePatientCommandGateway(() => ({ userId: 'CM', role: 'CM', exerciseIds: [ex] }));
  gateway.seed(ex, patient, 'CM', 4); setRuntimePatientCommandGateway(gateway);
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE');
  expect((await send()).status).toBe('APPLIED'); expect((await send()).status).toBe('IDEMPOTENT');
  expect(await gateway.loadAfter(ex, 0)).toHaveLength(1);
  gateway.seed(ex, patient, 'OTHER', 5);
  expect((await submitImagingOrder(ex, patient, 'IMG-001', 'SECOND-INTENT')).status).toBe('NOT_OWNER');
});
test('other command types retain existing untracked compatibility', () => {
  resetRuntimeReaderConvergence(); expect(runtimePatientCommandSubmissionReadiness(ex, 912).ready).toBe(true);
});
test('restored reader stays blocked until checkpoint acceptance without losing ownership', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE'); await mount();
  act(() => { resetRuntimeReaderConvergence(); beginRuntimeReaderConvergence(ex); });
  expect(button().props.disabled).toBe(true);
  act(() => { acceptRuntimeReaderCheckpoint(checkpoint(), 'CACHE'); });
  expect(button().props.disabled).toBe(false);
  expect((await send()).status).toBe('APPLIED');
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ patientBaseRevision: 4 }));
});
test('actual reconnect refusal emits only bounded classification, never raw reader errors', async () => {
  acceptRuntimeReaderCheckpoint(checkpoint(), 'REMOTE');
  setRuntimeReaderConvergenceUnavailable(ex, 'secret-token-patient-content');
  expect((await send()).status).toBe('RECONNECT_REQUIRED'); expect(submit).not.toHaveBeenCalled();
  const record = getRuntimeCommandReadinessDiagnostics().at(-1)!;
  expect(record).toEqual({ readerPhase: 'SYNCHRONIZING', exerciseIdentityMatch: true,
    revisionConvergence: 'CONVERGED', simulationClockMatch: true, failureCategory: 'CHECKPOINT_PENDING', gatewaySubmitCalled: false });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|SYNTHETIC/);
});
