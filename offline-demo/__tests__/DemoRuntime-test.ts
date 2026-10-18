import { DemoSessionStore, DEMO_RUNTIME_KEY, DEMO_RESET_RECEIPT_KEY, type DemoCommand, restoreSession } from '../src/runtime/DemoSession';
import { DemoController, type DemoScheduler } from '../src/runtime/DemoController';
import { DEMO_FIXTURE, DEMO_MAX_SECONDS, DEMO_PATIENTS, initialPatients } from '../src/runtime/DemoDomain';
import { tickHemorrhagePatientProcess } from '../../src/services/runtime/HemorrhagePatientProcess';
import { tickPleuralInjuryPatientProcess } from '../../src/services/runtime/PleuralInjuryPatientProcess';
import { tickRespiratoryFailurePatientProcess } from '../../src/services/runtime/RespiratoryFailurePatientProcess';
import { DEMO_STORAGE_KEY } from '../src/DemoStore';
import { PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION } from '../../src/modules/pelvicInjury/PelvicInjuryReference';
import { defaultPleuralInjuryConfiguration } from '../../src/services/runtime/PleuralInjuryPatientProcess';
import { defaultRespiratoryFailureConfiguration } from '../../src/services/runtime/RespiratoryFailurePatientProcess';
function fixture() {
  let serial = 0; const ids = () => `DEMO-LOCAL-test-${++serial}`;
  const map = new Map<string,string>([['canonical-private', 'DO_NOT_TOUCH'], ['russicaptor.demo.builder.draft', 'KEEP'], [DEMO_STORAGE_KEY, 'LEGACY_DEMO_KEEP']]);
  const storage = { getItemSync: jest.fn((key: string) => map.get(key) ?? null), setItemSync: jest.fn((key: string, value: string) => { map.set(key, value); }) };
  const store = new DemoSessionStore(storage, ids);
  const callbacks: (() => void)[] = []; const cancelled: unknown[] = [];
  const scheduler: DemoScheduler = { schedule: callback => { callbacks.push(callback); return callbacks.length; }, cancel: handle => { cancelled.push(handle); } };
  const controller = new DemoController(store, scheduler);
  return { map, storage, store, controller, callbacks, cancelled, scheduler, ids };
}
function session(store: DemoSessionStore) { const view = store.getSnapshot(); if (view.status !== 'READY') throw Error('TEST_SESSION_NOT_READY'); return view.session; }
function tick(store: DemoSessionStore, seconds: number) { for (let i = 0; i < seconds; i++) { const s = session(store); store.tick(s.sessionId, s.generation); } }
function command(store: DemoSessionStore): DemoCommand { const s = session(store); return { id: `DEMO-CMD-${s.sessionId}:binder`, sessionId: s.sessionId, generation: s.generation, time: s.time, patientId: 'DEMO-PT-A', type: 'APPLY_PELVIC_BINDER' }; }
function start(store: DemoSessionStore) { store.control('START'); store.navigate('CM'); }
describe('real shared-domain offline demo runtime (engines are not mocked)', () => {
  test('two synthetic patients initialize coherently with a separately versioned fixture', () => {
    const { store } = fixture(); const s = session(store);
    expect(s).toMatchObject({ fixture: DEMO_FIXTURE, time: 0, lifecycle: 'READY', generation: 0 });
    expect(s.sessionId).toMatch(/^DEMO-LOCAL-/); expect(s.patients.map(p => p.id)).toEqual(['DEMO-PT-A','DEMO-PT-B']);
    expect(s.patients.every(p => p.vitals.timestamp === 0 && p.hemorrhage.elapsedTime === 0)).toBe(true);
  });
  test('actual hemorrhage, pleural and respiratory domain functions drive progression', () => {
    const { store } = fixture(); const initial = initialPatients(); start(store); tick(store, 60);
    const after = session(store);
    let hemorrhage = initial[0].hemorrhage;
    for (let i = 0; i < 60; i++) hemorrhage = tickHemorrhagePatientProcess(hemorrhage, 1).process;
    expect(after.patients[0].hemorrhage).toEqual(hemorrhage);
    let respiration = initial[1].respiration!; let p = initial[1].pleural!;
    for (let i = 0; i < 60; i++) { p = tickPleuralInjuryPatientProcess(p, 1); respiration = tickRespiratoryFailurePatientProcess(respiration, 1, Number(p.outputs.runtimeContributions!.respiratoryImpairmentMultiplier)); }
    expect(after.patients[1].pleural).toEqual(p);
    expect(after.patients[1].respiration).toEqual(respiration);
    expect(after.patients[0].vitals.readings.heartRate.current).toBeGreaterThan(initial[0].vitals.readings.heartRate.current);
    expect(after.patients[0].vitals.readings.systolicBp.current).toBeLessThan(initial[0].vitals.readings.systolicBp.current);
    expect(after.patients[1].vitals.readings.spo2.current).toBeLessThan(initial[1].vitals.readings.spo2.current);
    expect(after.patients[1].vitals.readings.respiratoryRate.current).toBeGreaterThan(initial[1].vitals.readings.respiratoryRate.current);
  });
  test('fixture provenance matches existing reference inputs; synthetic composition is immutable', () => {
    const patients = initialPatients();
    expect(patients[0].hemorrhage.configuration).toEqual(PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION);
    expect(patients[1].hemorrhage.configuration).toEqual({ ...PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION, baselineBleedingRateMlMin: defaultPleuralInjuryConfiguration.bloodAccumulationPerMin });
    expect(patients[1].pleural?.configuration).toEqual(defaultPleuralInjuryConfiguration);
    expect(patients[1].respiration?.configuration).toEqual(defaultRespiratoryFailureConfiguration);
    expect(Object.isFrozen(DEMO_PATIENTS)).toBe(true); expect(Object.isFrozen(DEMO_PATIENTS[0])).toBe(true);
  });
  test('one controller clock advances both patients consistently across modes', () => {
    const { store, controller, callbacks } = fixture(); controller.control('START');
    expect(callbacks).toHaveLength(1); callbacks[0](); store.navigate('CM'); callbacks[0](); store.navigate('EXCON'); callbacks[0]();
    const s = session(store); expect(s.time).toBe(3); expect(callbacks).toHaveLength(1);
    for (const p of s.patients) { expect(p.vitals.timestamp).toBe(3); expect(p.hemorrhage.elapsedTime).toBe(3); }
    expect(s.patients[1].respiration?.elapsedTime).toBe(3); controller.dispose();
  });
  test('start pause resume is explicit and old timer callbacks cannot resume time', () => {
    const { store, controller, callbacks, cancelled } = fixture(); controller.control('START'); callbacks[0]();
    controller.control('PAUSE'); const paused = session(store); callbacks[0](); tick(store, 5);
    expect(session(store)).toBe(paused); expect(cancelled).toContain(1);
    controller.control('RESUME'); expect(callbacks).toHaveLength(2); callbacks[0](); callbacks[1]();
    expect(session(store).time).toBe(2); controller.dispose();
  });
  test('background pauses and foreground does not implicitly resume or catch up', () => {
    const { store, controller, callbacks } = fixture(); controller.control('START'); callbacks[0]();
    controller.setForeground(false); callbacks[0](); expect(session(store)).toMatchObject({ lifecycle: 'PAUSED', time: 1 });
    controller.setForeground(true); expect(callbacks).toHaveLength(1); expect(session(store).events.at(-1)?.kind).toBe('BACKGROUND');
    controller.control('RESUME'); callbacks[1](); expect(session(store).time).toBe(2); controller.dispose();
  });
  test('force-stop reconstruction pauses RUNNING and preserves engine state without wall-time jump', () => {
    const { store, storage, ids, controller } = fixture(); start(store); tick(store, 12); const before = session(store); controller.dispose();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(9_999_999_999_999);
    const restored = new DemoSessionStore(storage, ids); expect(session(restored)).toMatchObject({ time: 12, lifecycle: 'PAUSED', patients: before.patients });
    expect(session(restored).events.at(-1)?.kind).toBe('RECOVERY'); clock.mockRestore();
    restored.navigate('EXCON'); expect(session(new DemoSessionStore(storage, ids)).time).toBe(12);
  });
  test('real binder effect reduces subsequent blood loss rather than directly editing displayed vitals', () => {
    const { store } = fixture(); const untreated = fixture(); start(store); start(untreated.store);
    const before = session(store).patients[0].vitals; expect(store.command(command(store))).toBe('ACCEPTED');
    expect(session(store).patients[0].vitals).toEqual(before); tick(store, 60); tick(untreated.store, 60);
    expect(session(store).patients[0].hemorrhage.clinicalState.bleedingRateMlMin).toBe(56);
    expect(session(store).patients[0].hemorrhage.clinicalState.cumulativeLossMl).toBeLessThan(session(untreated.store).patients[0].hemorrhage.clinicalState.cumulativeLossMl);
    expect(session(store).patients[0].vitals.readings.heartRate.current).toBeLessThan(session(untreated.store).patients[0].vitals.readings.heartRate.current);
  });
  test('CM command and EXCON history are the same authoritative session', () => {
    const { store } = fixture(); start(store); const c = command(store); store.command(c); const patient = session(store).patients;
    store.navigate('EXCON'); expect(session(store).patients).toEqual(patient); expect(session(store).commands).toEqual([c]);
    expect(session(store).events.at(-1)).toMatchObject({ kind: 'BINDER_APPLIED', commandId: c.id });
    store.navigate('CM'); expect(session(store).commands).toHaveLength(1);
  });
  test('duplicate ID delivery in any property order has one effect, receipt and event', () => {
    const { store, storage } = fixture(); start(store); const c = command(store); store.command(c); const before = session(store); storage.setItemSync.mockClear();
    expect(store.command({ type: c.type, time: c.time, patientId: c.patientId, generation: c.generation, sessionId: c.sessionId, id: c.id })).toBe('DUPLICATE');
    expect(session(store)).toBe(before); expect(storage.setItemSync).not.toHaveBeenCalled();
    expect(() => store.command({ ...c, time: c.time + 1 })).toThrow('DEMO_COMMAND_ID_CONFLICT');
  });
  test('new IDs cannot silently repeat the one supported binder action', () => {
    const { store } = fixture(); start(store); const c = command(store); store.command(c);
    expect(() => store.command({ ...c, id: 'DEMO-CMD-repeat' })).toThrow('DEMO_BINDER_ALREADY_APPLIED'); expect(session(store).commands).toHaveLength(1);
  });
  test.each([{ type: 'IMAGING_ORDER' }, { patientId: 'REAL-PATIENT' }, { time: -1 }, { id: 'PRODUCTION-CMD' }, { extra: 'PAYLOAD' }])('invalid command is rejected without mutation %j', patch => {
    const { store, storage } = fixture(); start(store); const before = session(store); storage.setItemSync.mockClear();
    expect(() => store.command({ ...command(store), ...patch })).toThrow('DEMO_COMMAND_INVALID'); expect(session(store)).toBe(before); expect(storage.setItemSync).not.toHaveBeenCalled();
  });
  test('wrong session, generation, paused state, time and selection fail closed', () => {
    const { store } = fixture(); start(store); const c = command(store);
    for (const patch of [{ sessionId: 'DEMO-LOCAL-other' }, { generation: 1 }]) expect(() => store.command({ ...c, ...patch })).toThrow('DEMO_COMMAND_OBSOLETE');
    expect(() => store.command({ ...c, time: 1 })).toThrow('DEMO_COMMAND_NOT_READY');
    store.navigate('CM', 'DEMO-PT-B'); expect(() => store.command(c)).toThrow('DEMO_COMMAND_NOT_READY');
    store.navigate('EXCON'); expect(() => store.command(c)).toThrow('DEMO_COMMAND_NOT_READY');
    store.navigate('CM', 'DEMO-PT-A'); store.control('PAUSE'); expect(() => store.command(c)).toThrow('DEMO_COMMAND_NOT_READY');
  });
  test('committed command restores once without replay duplication', () => {
    const { store, storage, ids } = fixture(); start(store); const c = command(store); store.command(c); tick(store, 30);
    const restored = new DemoSessionStore(storage, ids); expect(session(restored).commands).toEqual([c]);
    expect(restored.command(c)).toBe('DUPLICATE'); expect(session(restored).events.filter(e => e.kind === 'BINDER_APPLIED')).toHaveLength(1);
  });
  test('failed save cannot advertise success; supported recovery restores last valid committed state', () => {
    const { store, storage, controller } = fixture(); start(store); tick(store, 2); const before = session(store);
    storage.setItemSync.mockImplementationOnce(() => { throw Error('SECRET_NOT_TO_DISPLAY'); });
    expect(() => store.command(command(store))).toThrow('DEMO_STORAGE_UNAVAILABLE'); expect(store.getSnapshot().status).toBe('RECOVERY_REQUIRED');
    expect(store.recover()).toBe(true); expect(session(store).patients).toEqual(before.patients); expect(session(store).commands).toEqual([]); expect(session(store).lifecycle).toBe('PAUSED'); controller.dispose();
  });
  test('lost persistence acknowledgement is reconciled against exact persisted bytes', () => {
    const { store, storage, map } = fixture(); start(store); const c = command(store);
    storage.setItemSync.mockImplementationOnce((key, value) => { map.set(key, value); throw Error('LOST_ACK'); });
    expect(store.command(c)).toBe('ACCEPTED'); expect(session(store).commands).toEqual([c]);
    expect(new DemoSessionStore(storage).command(c)).toBe('DUPLICATE');
  });
  test('torn or incompatible storage is visible and requires explicit recovery/reset', () => {
    const { store, map, storage, ids } = fixture(); start(store); map.set(DEMO_RUNTIME_KEY, '{torn');
    const restored = new DemoSessionStore(storage, ids); expect(restored.getSnapshot().status).toBe('RECOVERY_REQUIRED');
    expect(restored.recover()).toBe(false); expect(restored.reset()).toBe(true); expect(session(restored).time).toBe(0);
  });
  test.each(['{"schemaVersion":1}', '{"schemaVersion":2,"canonicalRuntime":{}}', 'null'])('foreign/corrupt snapshot is not fabricated into a valid session %s', raw => {
    const { storage, map } = fixture(); map.set(DEMO_RUNTIME_KEY, raw); expect(new DemoSessionStore(storage).getSnapshot().status).toBe('RECOVERY_REQUIRED');
  });
  test('tampered engine values, command/event lineage, fixture and clock are rejected', () => {
    const { store } = fixture(); start(store); store.command(command(store)); tick(store, 3); const s = session(store);
    for (const mutate of [(v: any) => { v.patients[0].vitals.readings.heartRate.current = 999; }, (v: any) => { v.time = 2; },
      (v: any) => { v.fixture = 'production@1'; }, (v: any) => { v.events[1].commandId = 'different'; }, (v: any) => { v.lifecycle = 'PAUSED'; }]) {
      const copy = structuredClone(s); mutate(copy); expect(() => restoreSession(JSON.stringify(copy))).toThrow();
    }
  });
  test('reset during running cancels timer and fences old commands and confirmation callbacks', () => {
    const { store, controller, callbacks, cancelled } = fixture(); start(store); const old = session(store); const c = command(store); callbacks[0]();
    expect(controller.reset(old.sessionId, old.generation)).toBe(true); callbacks[0]();
    const reset = session(store); expect(reset).toMatchObject({ time: 0, lifecycle: 'READY', generation: 1, commands: [], events: [] });
    expect(reset.patients).toEqual(initialPatients()); expect(cancelled).toContain(1);
    expect(controller.reset(old.sessionId, old.generation)).toBe(false); expect(() => store.command(c)).toThrow('DEMO_COMMAND_OBSOLETE'); controller.dispose();
  });
  test('repeated reset touches only the versioned demo runtime key and preserves other namespaces', () => {
    const { store, storage, map } = fixture(); for (let i = 0; i < 3; i++) { const s = session(store); store.reset(s.sessionId, s.generation); }
    expect(session(store).generation).toBe(3); expect(session(store).patients).toEqual(initialPatients());
    expect(storage.setItemSync.mock.calls.every(([key]) => [DEMO_RUNTIME_KEY, DEMO_RESET_RECEIPT_KEY].includes(key))).toBe(true);
    expect(map.get('canonical-private')).toBe('DO_NOT_TOUCH'); expect(map.get('russicaptor.demo.builder.draft')).toBe('KEEP'); expect(map.get(DEMO_STORAGE_KEY)).toBe('LEGACY_DEMO_KEEP');
  });
  test('all returned engine structures and ledgers are immutable', () => {
    const { store } = fixture(); expect(Object.isFrozen(session(store).patients[0].hemorrhage.clinicalState)).toBe(true);
    expect(Object.isFrozen(session(store).commands)).toBe(true);
  });
  test('bounded simulation pauses at 15 minutes and remains restorable', () => {
    const { store, storage } = fixture(); start(store); tick(store, DEMO_MAX_SECONDS); const s = session(store);
    expect(s).toMatchObject({ time: DEMO_MAX_SECONDS, lifecycle: 'PAUSED' }); expect(s.events.at(-1)?.kind).toBe('LIMIT');
    expect(store.control('RESUME')).toBe(false); tick(store, 1); expect(session(store).time).toBe(DEMO_MAX_SECONDS);
    expect(new DemoSessionStore(storage).getSnapshot().status).toBe('READY');
  });
  test('disposed controller and background callbacks cannot dispatch or restart work', () => {
    const { store, controller, callbacks } = fixture(); start(store); const c = command(store); controller.dispose(); callbacks[0]();
    expect(session(store).time).toBe(0); expect(() => controller.binder(c)).toThrow('DEMO_COMMAND_NOT_READY'); expect(() => controller.control('START')).toThrow('DEMO_CONTROL_NOT_READY');
  });
  test('disposed AppState callbacks and obsolete controls cannot change a reset session', () => {
    const { store, controller, scheduler } = fixture(); start(store); const old = session(store); controller.reset(old.sessionId, old.generation);
    expect(controller.control('START', old)).toBe(false); expect(controller.navigate('CM', undefined, old)).toBe(false);
    controller.dispose(); const fresh = new DemoController(store, scheduler); fresh.control('START'); const before = session(store);
    controller.setForeground(false); expect(session(store)).toBe(before); expect(controller.reset(before.sessionId, before.generation)).toBe(false); fresh.dispose();
  });
  test('serialized receipts have deterministic key order independent of input object order', () => {
    const left = fixture(); const right = fixture(); start(left.store); start(right.store); const c = command(left.store);
    left.store.command(c); right.store.command({ type: c.type, patientId: c.patientId, time: c.time, generation: c.generation, sessionId: c.sessionId, id: c.id });
    expect(left.map.get(DEMO_RUNTIME_KEY)).toBe(right.map.get(DEMO_RUNTIME_KEY));
  });
  test('an obsolete reset confirmation cannot erase a newer session even while recovery is required', () => {
    const { store, controller, storage } = fixture(); const old = session(store); controller.reset(old.sessionId, old.generation);
    const next = session(store); store.fail(); storage.setItemSync.mockClear();
    expect(controller.reset(old.sessionId, old.generation)).toBe(false); expect(storage.setItemSync).not.toHaveBeenCalled();
    expect(store.recover()).toBe(true); expect(session(store).sessionId).toBe(next.sessionId); controller.dispose();
  });
});
