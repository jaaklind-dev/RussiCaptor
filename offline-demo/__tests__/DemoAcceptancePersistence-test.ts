import { DemoUpgradeNotice, DEMO_UPGRADE_NOTICE_KEY } from '../src/DemoUpgrade';
import { DEMO_STORAGE_KEY } from '../src/DemoStore';
import { DemoSessionStore, DEMO_RUNTIME_KEY, DEMO_RESET_RECEIPT_KEY, type DemoCommand } from '../src/runtime/DemoSession';
import { DemoController, type DemoScheduler } from '../src/runtime/DemoController';

const legacy = JSON.stringify({ schemaVersion: 1, generation: 3, screen: 'patient', visits: 7 });
function fixture(entries: [string, string][] = []) {
  const map = new Map(entries); let id = 0;
  const storage = { getItemSync: jest.fn((key: string): string | null => map.get(key) ?? null),
    setItemSync: jest.fn((key: string, value: string) => { map.set(key, value); }) };
  const store = new DemoSessionStore(storage, () => `DEMO-LOCAL-evidence-${++id}`);
  const notice = new DemoUpgradeNotice(storage);
  return { map, storage, store, notice };
}
const session = (store: DemoSessionStore) => { const v = store.getSnapshot(); if (v.status !== 'READY') throw Error('TEST_SESSION_UNAVAILABLE'); return v.session; };
function accepted(store: DemoSessionStore): DemoCommand {
  store.control('START'); store.navigate('CM');
  for (let i = 0; i < 2; i++) { const s = session(store); store.tick(s.sessionId, s.generation); }
  const s = session(store); const command: DemoCommand = { id: `DEMO-CMD-${s.sessionId}:binder`, sessionId: s.sessionId,
    generation: s.generation, time: s.time, patientId: 'DEMO-PT-A', type: 'APPLY_PELVIC_BINDER' };
  store.command(command); store.control('PAUSE'); return command;
}
describe('explicit retained-legacy policy and persisted demo evidence', () => {
  test('fresh installation does not invent an upgrade or saved runtime', () => {
    const { notice, storage, store } = fixture(); expect(notice.inspect()).toBe('CLEAR');
    expect(storage.setItemSync).not.toHaveBeenCalled();
    expect(() => store.acceptanceReport(session(store))).toThrow('DEMO_ACCEPTANCE_UNAVAILABLE');
  });
  test('valid 0.1.0 state is detected without migrating or deleting the opening counter', () => {
    const { notice, map, storage, store } = fixture([[DEMO_STORAGE_KEY, legacy]]);
    expect(notice.inspect()).toBe('LEGACY_PRESENT'); expect(session(store)).toMatchObject({ time: 0, commands: [], generation: 0 });
    expect(storage.setItemSync).not.toHaveBeenCalled(); expect(notice.acknowledge()).toBe('CLEAR');
    expect(map.get(DEMO_STORAGE_KEY)).toBe(legacy); expect(map.has(DEMO_RUNTIME_KEY)).toBe(false);
    expect(storage.setItemSync.mock.calls.map(([key]) => key)).toEqual([DEMO_UPGRADE_NOTICE_KEY]);
  });
  test('an existing valid 0.2.0 session survives first legacy notice unchanged', () => {
    const { store, storage, map, notice } = fixture([[DEMO_STORAGE_KEY, legacy]]); const c = accepted(store);
    const raw = map.get(DEMO_RUNTIME_KEY); const before = session(store); storage.setItemSync.mockClear();
    expect(notice.inspect()).toBe('LEGACY_PRESENT'); expect(notice.acknowledge()).toBe('CLEAR');
    expect(map.get(DEMO_RUNTIME_KEY)).toBe(raw); expect(session(store)).toBe(before); expect(session(store).commands).toEqual([c]);
    expect(storage.setItemSync.mock.calls.every(([key]) => key === DEMO_UPGRADE_NOTICE_KEY)).toBe(true);
  });
  test('notice acknowledgement survives launch and runtime reset without retrigger', () => {
    const { store, notice, storage, map } = fixture([[DEMO_STORAGE_KEY, legacy]]); notice.acknowledge();
    store.navigate('CM'); const s = session(store); store.reset(s.sessionId, s.generation);
    expect(new DemoUpgradeNotice(storage).inspect()).toBe('CLEAR');
    expect(session(new DemoSessionStore(storage)).generation).toBe(1); expect(map.get(DEMO_STORAGE_KEY)).toBe(legacy);
  });
  test('a valid v2-only installation needs no fabricated historical notice', () => {
    const { store, notice } = fixture(); accepted(store); expect(notice.inspect()).toBe('CLEAR');
  });
  test.each(['{PRIVATE_LEGACY_SECRET', 'x'.repeat(1025), '{"schemaVersion":9}', 'null'])('unrecognized legacy is preserved with bounded classification', raw => {
    const { notice, map } = fixture([[DEMO_STORAGE_KEY, raw]]); expect(notice.inspect()).toBe('LEGACY_UNRECOGNIZED');
    expect(notice.acknowledge()).toBe('CLEAR'); expect(map.get(DEMO_STORAGE_KEY)).toBe(raw);
  });
  test('notice read errors and malformed acknowledgement fail closed without raw exceptions', () => {
    const { notice, storage, map } = fixture(); storage.getItemSync.mockImplementationOnce(() => { throw Error('PRIVATE_SECRET'); });
    expect(notice.inspect()).toBe('UNAVAILABLE'); map.set(DEMO_UPGRADE_NOTICE_KEY, 'PRIVATE_BAD_MARKER');
    expect(notice.inspect()).toBe('UNAVAILABLE'); expect(notice.acknowledge()).toBe('UNAVAILABLE');
  });
  test('failed notice save is not reported as acknowledged; lost response is reconciled', () => {
    const { notice, storage, map } = fixture([[DEMO_STORAGE_KEY, legacy]]);
    storage.setItemSync.mockImplementationOnce(() => { throw Error('PRIVATE_SECRET'); }); expect(notice.acknowledge()).toBe('UNAVAILABLE');
    expect(notice.inspect()).toBe('LEGACY_PRESENT');
    storage.setItemSync.mockImplementationOnce((key, value) => { map.set(key, value); throw Error('LOST_ACK'); });
    expect(notice.acknowledge()).toBe('CLEAR'); expect(notice.acknowledge()).toBe('CLEAR');
    expect(storage.setItemSync).toHaveBeenCalledTimes(2);
  });
  test('evidence reads the actual persisted command ID and verified event once, without writes', () => {
    const { store, storage, map } = fixture(); const c = accepted(store); storage.setItemSync.mockClear();
    const evidence = store.acceptanceReport(session(store));
    expect(evidence).toMatchObject({ source: 'PERSISTED_DEMO_ROW', generation: 0, simulationTimeSec: 2,
      lifecycle: 'PAUSED', commandCount: 1, commands: [{ id: JSON.parse(map.get(DEMO_RUNTIME_KEY)!).commands[0].id,
        type: c.type, simulationTimeSec: 2, processingStatus: 'APPLIED_EVENT_VERIFIED' }], resetTransition: { status: 'NOT_AVAILABLE' } });
    expect(storage.setItemSync).not.toHaveBeenCalled(); expect(Object.isFrozen(evidence.commands[0])).toBe(true);
  });
  test('the exporter cannot substitute an in-memory command for an older persisted row', () => {
    const { store, map } = fixture(); store.control('START'); store.navigate('CM'); const raw = map.get(DEMO_RUNTIME_KEY)!;
    const s = session(store); store.command({ id: `DEMO-CMD-${s.sessionId}:binder`, sessionId: s.sessionId, generation: s.generation,
      time: 0, patientId: 'DEMO-PT-A', type: 'APPLY_PELVIC_BINDER' }); map.set(DEMO_RUNTIME_KEY, raw);
    expect(session(store).commands).toHaveLength(1); expect(store.acceptanceReport(s).commandCount).toBe(0);
  });
  test('duplicate delivery and restart preserve one actual persisted identity and effect', () => {
    const { store, storage } = fixture(); const c = accepted(store); const raw = storage.getItemSync(DEMO_RUNTIME_KEY);
    expect(store.command(c)).toBe('DUPLICATE'); expect(storage.getItemSync(DEMO_RUNTIME_KEY)).toBe(raw);
    const restored = new DemoSessionStore(storage); const report = restored.acceptanceReport(session(restored));
    expect(report.commands.map(command => command.id)).toEqual([c.id]); expect(report.commandCount).toBe(1);
  });
  test('a non-UI command identity is not allowed to smuggle arbitrary text into an export', () => {
    const { store } = fixture(); store.control('START'); store.navigate('CM'); const s = session(store);
    store.command({ id: 'DEMO-CMD-PRIVATE-SECRET', sessionId: s.sessionId, generation: s.generation, time: 0,
      patientId: 'DEMO-PT-A', type: 'APPLY_PELVIC_BINDER' });
    expect(() => store.acceptanceReport(s)).toThrow(/^DEMO_ACCEPTANCE_UNAVAILABLE$/);
  });
  test('reset exports real before/after generations and survives restart', () => {
    const { store, storage, map } = fixture(); accepted(store); const before = session(store);
    expect(store.reset(before.sessionId, before.generation)).toBe(true);
    const receipt = JSON.parse(map.get(DEMO_RESET_RECEIPT_KEY)!); expect(receipt).toMatchObject({ fromGeneration: 0, toGeneration: 1, fromTimeSec: 2, toTimeSec: 0 });
    const restored = new DemoSessionStore(storage); const report = restored.acceptanceReport(session(restored));
    expect(report).toMatchObject({ commandCount: 0, generation: 1, simulationTimeSec: 0,
      resetTransition: { status: 'PERSISTED_BEFORE_AND_AFTER', fromGeneration: 0, toGeneration: 1, fromSimulationTimeSec: 2, toSimulationTimeSec: 0 } });
    expect(report.sessionId).not.toBe(before.sessionId);
  });
  test('old command, timer and export callbacks cannot target a reset generation', () => {
    const { store } = fixture(); const callbacks: (() => void)[] = [];
    const scheduler: DemoScheduler = { schedule: callback => { callbacks.push(callback); return callbacks.length; }, cancel: jest.fn() };
    const controller = new DemoController(store, scheduler); controller.control('START'); store.navigate('CM');
    const before = session(store); const c: DemoCommand = { id: `DEMO-CMD-${before.sessionId}:binder`, sessionId: before.sessionId,
      generation: before.generation, time: 0, type: 'APPLY_PELVIC_BINDER', patientId: 'DEMO-PT-A' };
    callbacks[0](); controller.reset(before.sessionId, before.generation); const after = session(store); callbacks[0]();
    expect(session(store)).toBe(after); expect(() => store.command(c)).toThrow('DEMO_COMMAND_OBSOLETE');
    expect(() => store.acceptanceReport(before)).toThrow('DEMO_ACCEPTANCE_UNAVAILABLE'); controller.dispose();
  });
  test('interrupted secondary receipt write does not corrupt reset or manufacture transition evidence', () => {
    const { store, storage } = fixture(); accepted(store); const original = storage.setItemSync.getMockImplementation()!;
    storage.setItemSync.mockImplementation((key, value) => { if (key === DEMO_RESET_RECEIPT_KEY) throw Error('PRIVATE_SECRET'); original(key, value); });
    const before = session(store); expect(store.reset(before.sessionId, before.generation)).toBe(true);
    expect(store.acceptanceReport(session(store))).toMatchObject({ generation: 1, commandCount: 0, resetTransition: { status: 'NOT_AVAILABLE' } });
  });
  test('failed primary reset write creates no successful receipt and preserves prior committed data', () => {
    const { store, storage, map } = fixture(); accepted(store); const before = session(store); const raw = map.get(DEMO_RUNTIME_KEY);
    storage.setItemSync.mockImplementationOnce(() => { throw Error('PRIVATE_SECRET'); });
    expect(() => store.reset(before.sessionId, before.generation)).toThrow('DEMO_STORAGE_UNAVAILABLE');
    expect(map.get(DEMO_RUNTIME_KEY)).toBe(raw); expect(map.has(DEMO_RESET_RECEIPT_KEY)).toBe(false);
  });
  test('a second reset replaces only the bounded demo receipt; legacy, notice and Builder data survive', () => {
    const { store, notice, map, storage } = fixture([[DEMO_STORAGE_KEY, legacy], ['demo-builder-key', 'KEEP'], ['canonical-private', 'SECRET']]);
    notice.acknowledge(); accepted(store);
    for (let i = 0; i < 2; i++) { const before = session(store); store.reset(before.sessionId, before.generation); }
    expect(store.acceptanceReport(session(store)).resetTransition).toMatchObject({ fromGeneration: 1, toGeneration: 2 });
    expect(map.get(DEMO_STORAGE_KEY)).toBe(legacy); expect(map.get('demo-builder-key')).toBe('KEEP'); expect(map.get('canonical-private')).toBe('SECRET');
    expect(storage.getItemSync.mock.calls.every(([key]) => [DEMO_RUNTIME_KEY, DEMO_STORAGE_KEY, DEMO_UPGRADE_NOTICE_KEY, DEMO_RESET_RECEIPT_KEY].includes(key))).toBe(true);
    expect(storage.setItemSync.mock.calls.every(([key]) => [DEMO_RUNTIME_KEY, DEMO_UPGRADE_NOTICE_KEY, DEMO_RESET_RECEIPT_KEY].includes(key))).toBe(true);
  });
  test.each(['{PRIVATE_SECRET', '{"schemaVersion":2,"canonicalRuntime":{}}', 'x'.repeat(160001)])('invalid persisted runtime cannot leak through diagnostics', raw => {
    const { store, map } = fixture(); accepted(store); map.set(DEMO_RUNTIME_KEY, raw);
    expect(() => store.acceptanceReport(session(store))).toThrow(/^DEMO_ACCEPTANCE_UNAVAILABLE$/);
  });
  test('read failure and row change during capture fail with a fixed code', () => {
    const { store, storage, map } = fixture(); accepted(store); const s = session(store); const raw = map.get(DEMO_RUNTIME_KEY)!;
    storage.getItemSync.mockImplementationOnce(() => { throw Error('PRIVATE_SECRET'); });
    expect(() => store.acceptanceReport(s)).toThrow(/^DEMO_ACCEPTANCE_UNAVAILABLE$/);
    storage.getItemSync.mockReturnValueOnce(raw).mockReturnValueOnce(null).mockReturnValueOnce('DIFFERENT');
    expect(() => store.acceptanceReport(s)).toThrow(/^DEMO_ACCEPTANCE_UNAVAILABLE$/);
  });
  test('malformed reset receipt cannot produce false proof or expose extra fields', () => {
    const { store, map } = fixture(); accepted(store); const s = session(store); store.reset(s.sessionId, s.generation);
    const receipt = JSON.parse(map.get(DEMO_RESET_RECEIPT_KEY)!);
    for (const patch of [{ fromGeneration: 9 }, { extra: 'PRIVATE_SECRET' }, { fromSessionId: 'PRIVATE_SECRET' }, { toTimeSec: 99 }]) {
      map.set(DEMO_RESET_RECEIPT_KEY, JSON.stringify({ ...receipt, ...patch }));
      expect(() => store.acceptanceReport(session(store))).toThrow(/^DEMO_ACCEPTANCE_UNAVAILABLE$/);
    }
  });
  test('a valid receipt from an older reset is explicitly not current evidence', () => {
    const { store, map } = fixture(); accepted(store); let s = session(store); store.reset(s.sessionId, s.generation);
    const oldReceipt = map.get(DEMO_RESET_RECEIPT_KEY)!; s = session(store); store.reset(s.sessionId, s.generation);
    map.set(DEMO_RESET_RECEIPT_KEY, oldReceipt); expect(store.acceptanceReport(session(store)).resetTransition.status).toBe('NOT_AVAILABLE');
  });
  test('export has an exact bounded whitelist, no patient content, storage path or legacy counter', () => {
    const { store } = fixture([[DEMO_STORAGE_KEY, legacy], ['canonical-private', 'PRIVATE_SECRET']]); accepted(store);
    const report = store.acceptanceReport(session(store)); const text = JSON.stringify(report);
    expect(Object.keys(report).sort()).toEqual(['schemaVersion','kind','source','sessionId','generation','simulationTimeSec','lifecycle','commandCount','commands','resetTransition'].sort());
    expect(text.length).toBeLessThan(2048);
    for (const token of ['patients', 'DEMO-PT-A', 'vitals', 'hemorrhage', 'visits', 'PRIVATE_SECRET', '/data/', 'token']) expect(text).not.toContain(token);
  });
});
