import { BUILDER_CAPABILITIES as C, capabilityState } from '../src/builder/DemoBuilderCapabilities';
import { editBuilderDraft, newBuilderPatient } from '../src/builder/DemoBuilderDraft';
import { BUILDER_KEY, DemoBuilderStore, type BuilderStorage } from '../src/builder/DemoBuilderStore';
import { validateBuilderDraft } from '../src/builder/DemoBuilderValidation';
import { DemoSessionStore } from '../src/runtime/DemoSession';
function fixture() {
  const map = new Map<string, string>(); let n = 0;
  const storage: BuilderStorage = { getItemSync: k => map.get(k) ?? null,
    setItemSync: (k, fn) => { const value = fn(map.get(k) ?? null); map.set(k, value); } };
  const store = new DemoBuilderStore(storage, () => '2026-10-19T00:00:00.000Z', () => `DEMO-DRAFT-${++n}`);
  const empty = store.create();
  const complete = editBuilderDraft(empty, { name: 'Sünteetiline õppus', patients: [newBuilderPatient('DEMO-PATIENT-a')] });
  return { map, storage, store, empty, complete };
}
describe('versioned offline Builder model and transactional store', () => {
  test('create/list independent copies, unique IDs, multiple drafts, stable identity and saved receipt', () => {
    const { store, complete } = fixture(); const other = store.create(); expect(other.draftId).not.toBe(complete.draftId);
    const saved = store.save(complete, 0, true); expect(saved.revision).toBe(1); expect(saved.validationReceipt?.validatedRevision).toBe(1);
    const list = store.list(); list[0].name = 'not persisted'; expect(store.list()[0].name).toBe('Sünteetiline õppus');
    const edited = editBuilderDraft(saved, { description: 'Muudatus' }); expect(edited.validationReceipt).toBeNull();
    expect(store.save(edited, 1).validationReceipt).toBeNull();
  });
  test('restart, delete and stale revisions never recreate a deleted record or overwrite another draft', () => {
    const { store, storage, complete } = fixture(); const saved = store.save(complete, 0);
    const restarted = new DemoBuilderStore(storage); expect(restarted.list()[0]).toEqual(saved);
    expect(() => restarted.save(complete, 0)).toThrow('REVISION_CONFLICT');
    expect(() => store.delete(saved.draftId, 0)).toThrow('REVISION_CONFLICT');
    store.delete(saved.draftId, 1); expect(restarted.list()).toEqual([]);
    expect(() => store.save(saved, 1)).toThrow('REVISION_CONFLICT');
  });
  test('limits are explicit versioned capabilities, not patient-ID slots or a two-element tuple', () => {
    const { complete } = fixture(); const two = editBuilderDraft(complete, { patients: [...complete.patients, newBuilderPatient('DEMO-PATIENT-arbitrary', 'THORACIC')] });
    expect(validateBuilderDraft(two)).toEqual([]); expect(C.version).toBe('DEMO-BUILDER-MVP1');
    expect(validateBuilderDraft(editBuilderDraft(two, { patients: [...two.patients, newBuilderPatient('DEMO-PATIENT-third')] })).some(e => e.category === 'UNSUPPORTED_CAPABILITY')).toBe(true);
    expect(capabilityState('preset', 'ADDITIONAL_PRESETS')).toBe('UNAVAILABLE'); expect(capabilityState('preset', 'invented')).toBe('UNKNOWN');
    expect(capabilityState('panel', 'ADDITIONAL_PANELS')).toBe('UNAVAILABLE'); expect(capabilityState('preset', 'PELVIC')).toBe('SUPPORTED');
  });
  test.each([
    ['future-schema', (d: any) => { d.schemaVersion = 2; }, 'SCHEMA_INVALID'],
    ['production-id', (d: any) => { d.draftId = 'EX-123'; }, 'SCHEMA_INVALID'],
    ['bad-revision', (d: any) => { d.revision = -1; }, 'SCHEMA_INVALID'],
    ['blank-name', (d: any) => { d.name = ''; }, 'SCHEMA_INVALID'],
    ['long-name', (d: any) => { d.name = 'a'.repeat(101); }, 'SCHEMA_INVALID'],
    ['long-description', (d: any) => { d.description = 'a'.repeat(2001); }, 'SCHEMA_INVALID'],
    ['URL', (d: any) => { d.description = 'https://example.invalid'; }, 'SCHEMA_INVALID'],
    ['credentials-field', (d: any) => { d.accessToken = 'not-allowed'; }, 'SCHEMA_INVALID'],
    ['runtime-commands', (d: any) => { d.commands = []; }, 'SCHEMA_INVALID'],
    ['age', (d: any) => { d.patients[0].age = 5; }, 'SCHEMA_INVALID'],
    ['noninteger-age', (d: any) => { d.patients[0].age = 35.1; }, 'SCHEMA_INVALID'],
    ['sex', (d: any) => { d.patients[0].sex = 'invalid'; }, 'SCHEMA_INVALID'],
    ['triage', (d: any) => { d.patients[0].triage = 'P9'; }, 'SCHEMA_INVALID'],
    ['location', (d: any) => { d.patients[0].initialLocation = 'production'; }, 'SCHEMA_INVALID'],
    ['unknown-preset', (d: any) => { d.patients[0].clinicalPresetId = 'invalid'; }, 'UNSUPPORTED_CAPABILITY'],
    ['unavailable-preset', (d: any) => { d.patients[0].clinicalPresetId = 'ADDITIONAL_PRESETS'; }, 'UNSUPPORTED_CAPABILITY'],
    ['preset-version', (d: any) => { d.patients[0].presetVersion = '2.0.0'; }, 'UNSUPPORTED_CAPABILITY'],
    ['derived-output', (d: any) => { d.patients[0].initialInputs = { heartRate: 100 }; }, 'CLINICALLY_INCONSISTENT'],
    ['wrong-config', (d: any) => { d.patients[0].initialInputs.configurationId = 'other'; }, 'CLINICALLY_INCONSISTENT'],
    ['lab-value', (d: any) => { d.patients[0].laboratory.Hb = 100; }, 'UNSUPPORTED_CAPABILITY'],
    ['lab-delay', (d: any) => { d.patients[0].laboratory.delaySeconds = 3; }, 'UNSUPPORTED_CAPABILITY'],
    ['missing-asset', (d: any) => { d.patients[0].imaging = []; }, 'MISSING_ASSET'],
    ['wrong-asset', (d: any) => { d.patients[0].imaging[0].assetId = 'other'; }, 'MISSING_ASSET'],
    ['wrong-hash', (d: any) => { d.patients[0].imaging[0].sha256 = '0'.repeat(64); }, 'MISSING_ASSET'],
    ['wrong-report', (d: any) => { d.patients[0].imaging[0].reportId = 'other'; }, 'MISSING_ASSET'],
    ['file-path', (d: any) => { d.patients[0].imaging[0].uri = 'file:///other'; }, 'MISSING_ASSET'],
    ['duplicate-id', (d: any) => { d.patients.push(newBuilderPatient(d.patients[0].patientId, 'THORACIC')); }, 'SCHEMA_INVALID'],
    ['duplicate-preset', (d: any) => { d.patients.push(newBuilderPatient('DEMO-PATIENT-b')); }, 'UNSUPPORTED_CAPABILITY'],
  ])('%s rejected without mutating input', (_name, change, category) => {
    const { complete } = fixture(), value = structuredClone(complete); change(value); const before = JSON.stringify(value);
    expect(validateBuilderDraft(value).some(e => e.category === category)).toBe(true); expect(JSON.stringify(value)).toBe(before);
  });
  test.each(['{broken', JSON.stringify({ schemaVersion: 2, drafts: [] }), JSON.stringify({ schemaVersion: 1, drafts: [{ schemaVersion: 99 }] })])('corrupt/future records are preserved byte-for-byte', raw => {
    const { map, store, complete } = fixture(); map.set(BUILDER_KEY, raw);
    for (const operation of [() => store.list(), () => store.create(), () => store.save(complete, 0), () => store.delete(complete.draftId, 0)]) {
      expect(operation).toThrow(); expect(map.get(BUILDER_KEY)).toBe(raw);
    }
  });
  test('capacity is ten, ID collision and interrupted transaction leave original bytes unchanged', () => {
    const { store, storage, map, complete } = fixture(); for (let i = 0; i < 9; i++) store.create();
    const raw = map.get(BUILDER_KEY); expect(() => store.create()).toThrow('UNSUPPORTED_CAPABILITY'); expect(map.get(BUILDER_KEY)).toBe(raw);
    const interrupted = new DemoBuilderStore({ ...storage, setItemSync: (_k, fn) => { fn(raw!); throw Error('interrupted before commit'); } });
    expect(() => interrupted.save(complete, 0)).toThrow('STORAGE_UNAVAILABLE'); expect(map.get(BUILDER_KEY)).toBe(raw);
  });
  test('lost acknowledgement accepted only after exact persisted readback; no partial publication', () => {
    const { storage, complete } = fixture(); const lost = new DemoBuilderStore({ ...storage, setItemSync: (key, fn) => { storage.setItemSync(key, fn); throw Error('lost acknowledgement'); } });
    expect(lost.save(complete, 0).revision).toBe(1); expect(lost.list()[0].name).toBe(complete.name);
  });
  test('runtime reset never accesses Builder keys and never removes drafts', () => {
    const { map, store, complete } = fixture(); store.save(complete, 0); const before = map.get(BUILDER_KEY);
    const runtime = new DemoSessionStore({ getItemSync: k => map.get(k) ?? null, setItemSync: (k, v) => { map.set(k, v); } });
    const v = runtime.getSnapshot(); if (v.status !== 'READY') throw Error('fixture'); runtime.reset(v.session.sessionId, v.session.generation);
    expect(map.get(BUILDER_KEY)).toBe(before); expect(store.list()).toHaveLength(1);
  });
});
