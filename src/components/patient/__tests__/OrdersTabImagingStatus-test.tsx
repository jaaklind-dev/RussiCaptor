import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import OrdersTab from '../OrdersTab';
import ImagingTab from '../ImagingTab';
import type { Order } from '@/models/Order';
import type { ImagingStudyInstance, ImagingWorkflowSnapshot } from '@/models/ImagingWorkflow';
import { rememberAcceptedImagingOrder, resetImagingOrderReceipts } from '@/services/runtime/imaging/ImagingOrderPresentation';
import { runtimePatientCommandSubmissionReadiness } from '@/services/runtime/commands/RuntimePatientCommandService';

jest.mock('@/services/runtime/commands/RuntimePatientCommandService', () => ({
  runtimePatientCommandSubmissionReadiness: jest.fn(() => ({ ready: true })),
}));
const order = { id: 'ORDER', exerciseId: 'EX', patientId: 'PT', category: 'imaging', title: 'ChestXR',
  status: 'available', visibility: 'revealed', workflow: { resultTargetId: 'IMG' } } as Order;
const instance = (status: ImagingStudyInstance['status'], ordinal = 1): ImagingStudyInstance => ({
  imagingInstanceId: `IMAGING:C${ordinal}`, orderCommandId: `C${ordinal}`, exerciseId: 'EX', patientId: 'PT',
  definitionId: 'IMG', packageId: 'PKG', packageVersion: '1', packageHash: 'HASH', title: 'ChestXR',
  modality: 'XR', orderedBy: 'CM', orderedAtSimulationTimeSec: 0, availableAtSimulationTimeSec: 0,
  repeatOrdinal: ordinal, status, authoredSource: { reportText: 'PRIVATE-AUTHORED', reportSha256: 'HASH' },
  ...(status === 'RESULTED' ? { result: { resultId: `RESULT:C${ordinal}`, imagingInstanceId: `IMAGING:C${ordinal}`,
    patientId: 'PT', definitionId: 'IMG', packageId: 'PKG', packageVersion: '1', packageHash: 'HASH',
    reportText: 'RELEASED', authoredReportSha256: 'HASH', releasedAtSimulationTimeSec: 0 } } : {}),
});
const workflow = (...instances: ImagingStudyInstance[]): ImagingWorkflowSnapshot => ({ schemaVersion: 2, instances });
let tree: renderer.ReactTestRenderer;
let props: React.ComponentProps<typeof OrdersTab>;
let allowed: boolean;
let alert: jest.SpyInstance;
const texts = () => JSON.stringify(tree.toJSON());
const button = () => tree.root.findAll(node => typeof node.props.onPress === 'function' &&
  typeof node.props.accessibilityLabel === 'string')[0];
const update = async (patch: Partial<typeof props> = {}) => {
  props = { ...props, ...patch };
  await act(async () => { tree.update(<OrdersTab {...props} />); });
};
const press = async () => { await act(async () => { button().props.onPress(); }); };
const confirm = async () => { await act(async () => {
  const buttons = alert.mock.calls.at(-1)![2]; buttons[1].onPress();
}); };
beforeEach(async () => {
  resetImagingOrderReceipts(); allowed = true;
  jest.mocked(runtimePatientCommandSubmissionReadiness).mockReturnValue({ ready: true });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  props = { orders: [order], imagingWorkflow: workflow(), onPlaceOrder: jest.fn(async () => {}),
    canPlaceImagingOrder: () => allowed };
  await act(async () => { tree = renderer.create(<OrdersTab {...props} />); });
});
afterEach(() => { act(() => tree.unmount()); alert.mockRestore(); resetImagingOrderReceipts(); });

test('never ordered ignores stale legacy status and offers first order without dialog', async () => {
  expect(texts()).toContain('Tellimata'); expect(button().props.disabled).toBe(false);
  await press(); expect(props.onPlaceOrder).toHaveBeenCalledTimes(1); expect(alert).not.toHaveBeenCalled();
});
test('accepted receipt is visibly pending, survives remount and cannot send again before hydration', async () => {
  await update({ onPlaceOrder: jest.fn(async () => { rememberAcceptedImagingOrder('EX', 'PT', 'IMG', 'C1'); }) });
  await press(); expect(texts()).toContain('Tellimus vastu võetud'); expect(button().props.disabled).toBe(true);
  await press(); expect(props.onPlaceOrder).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
  await act(async () => { tree = renderer.create(<OrdersTab {...props} />); });
  expect(button().props.disabled).toBe(true);
  await update({ imagingWorkflow: workflow(instance('ORDERED')) });
  expect(texts()).toContain('Tellitud'); expect(button().props.disabled).toBe(false);
});
test.each([['ORDERED', 'Tellitud'], ['PROCESSING', 'Töötlemisel'], ['RESULTED', 'Tulemus olemas']] as const)(
  '%s comes from Runtime even when legacy still says available', async (status, label) => {
    await update({ imagingWorkflow: workflow(instance(status)) });
    expect(texts()).toContain(label); expect(texts()).not.toContain('Tellimata');
    expect(button().props.accessibilityLabel).toBe('Telli kordusuuring ChestXR');
  });
test('published result and OrdersTab agree; presentation does not expose authored report', async () => {
  const snapshot = workflow(instance('RESULTED'));
  await update({ imagingWorkflow: snapshot }); expect(texts()).toContain('Tulemus olemas');
  expect(texts()).not.toContain('PRIVATE-AUTHORED');
  let imaging!: renderer.ReactTestRenderer;
  await act(async () => { imaging = renderer.create(<ImagingTab studies={[]} workflow={snapshot}
    onOpenImage={jest.fn()} onOpenReport={jest.fn()} />); });
  expect(JSON.stringify(imaging.toJSON())).toContain('Tulemus olemas');
  act(() => imaging.unmount());
});
test('latest repeat wins even when checkpoint instance order differs', async () => {
  await update({ imagingWorkflow: workflow(instance('PROCESSING', 2), instance('RESULTED', 1)) });
  expect(texts()).toContain('Töötlemisel'); expect(texts()).not.toContain('Tulemus olemas');
});
test('repeat needs explicit confirmation; cancel and dismiss submit nothing', async () => {
  await update({ imagingWorkflow: workflow(instance('RESULTED')) }); await press();
  expect(props.onPlaceOrder).not.toHaveBeenCalled(); expect(alert.mock.calls[0][1]).toContain('uue pildiuuringu taotluse');
  act(() => alert.mock.calls[0][2][0].onPress()); expect(props.onPlaceOrder).not.toHaveBeenCalled();
  await press(); act(() => alert.mock.calls[1][3].onDismiss()); expect(props.onPlaceOrder).not.toHaveBeenCalled();
});
test('confirmed repeat submits once even with rapid presses and duplicate confirmation callback', async () => {
  await update({ imagingWorkflow: workflow(instance('RESULTED')) });
  await act(async () => { button().props.onPress(); button().props.onPress(); });
  expect(alert).toHaveBeenCalledTimes(1); await confirm(); await confirm();
  expect(props.onPlaceOrder).toHaveBeenCalledTimes(1);
});
test.each(['readiness', 'ownership', 'terminal', 'patient', 'exercise', 'new-instance', 'readOnly'])(
  '%s changes while dialog is open abort confirmed repeat', async change => {
    await update({ imagingWorkflow: workflow(instance('RESULTED')) }); await press();
    if (change === 'readiness' || change === 'terminal') {
      jest.mocked(runtimePatientCommandSubmissionReadiness).mockReturnValue({ ready: false });
    } else if (change === 'ownership') allowed = false;
    else if (change === 'patient' || change === 'exercise') await update({ orders: [{ ...order,
      ...(change === 'patient' ? { patientId: 'OTHER' } : { exerciseId: 'OTHER' }) }] });
    else if (change === 'new-instance') await update({ imagingWorkflow: workflow(instance('RESULTED'), instance('ORDERED', 2)) });
    else await update({ readOnly: true });
    await confirm(); expect(props.onPlaceOrder).not.toHaveBeenCalled();
  });
test('unmounted dialog callback cannot send', async () => {
  await update({ imagingWorkflow: workflow(instance('RESULTED')) }); await press();
  act(() => tree.unmount()); await confirm(); expect(props.onPlaceOrder).not.toHaveBeenCalled();
});
test('reconnect and canonical updates re-render status without navigation', async () => {
  await update({ imagingWorkflow: workflow(instance('PROCESSING')) });
  jest.mocked(runtimePatientCommandSubmissionReadiness).mockReturnValue({ ready: false }); await update();
  expect(button().props.disabled).toBe(true);
  jest.mocked(runtimePatientCommandSubmissionReadiness).mockReturnValue({ ready: true });
  await update({ imagingWorkflow: workflow(instance('RESULTED')) });
  expect(texts()).toContain('Tulemus olemas'); expect(button().props.disabled).toBe(false);
});
test('missing workflow fails closed instead of trusting legacy status', async () => {
  await update({ imagingWorkflow: undefined }); expect(button().props.disabled).toBe(true);
  await press(); expect(props.onPlaceOrder).not.toHaveBeenCalled();
});
test('cross-exercise, cross-patient and other study instances cannot contaminate status', async () => {
  await update({ imagingWorkflow: workflow({ ...instance('RESULTED'), exerciseId: 'OTHER' },
    { ...instance('RESULTED'), patientId: 'OTHER' }, { ...instance('RESULTED'), definitionId: 'OTHER' }) });
  expect(texts()).toContain('Tellimata');
});
test('non-imaging order retains legacy status and ordinary action', async () => {
  await update({ orders: [{ ...order, category: 'lab', status: 'available' }] });
  await press(); expect(props.onPlaceOrder).toHaveBeenCalledTimes(1); expect(alert).not.toHaveBeenCalled();
  await update({ orders: [{ ...order, category: 'lab', status: 'completed' }] });
  expect(texts()).toContain('Valmis'); expect(button()).toBeUndefined();
});
test('presentation and confirmation add no diagnostic logging or sensitive content', async () => {
  const info = jest.spyOn(console, 'info'); const warn = jest.spyOn(console, 'warn');
  await update({ imagingWorkflow: workflow(instance('RESULTED')) }); await press();
  expect(alert.mock.calls[0].slice(0, 2).join(' ')).not.toMatch(/PRIVATE|HASH|PT|EX|token/i);
  expect(info).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); info.mockRestore(); warn.mockRestore();
});
