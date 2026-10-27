import { BUILDER_CAPABILITIES as C } from '../src/builder/DemoBuilderCapabilities';
import { newBuilderPatient, type DemoBuilderDraft } from '../src/builder/DemoBuilderDraft';
import { BUILDER_KEY, DemoBuilderStore, type BuilderStorage } from '../src/builder/DemoBuilderStore';
import { validateBuilderDraft } from '../src/builder/DemoBuilderValidation';
function fixture() {
  const map = new Map<string, string>();
  const storage: BuilderStorage = { getItemSync: k => map.get(k) ?? null, setItemSync: (k, update) => { map.set(k, update(map.get(k) ?? null)); } };
  const store = new DemoBuilderStore(storage);
  const empty = store.create();
  const draft: DemoBuilderDraft = { ...empty, name: 'Sünteetiline õppus', patients: [newBuilderPatient()] };
  return { map, storage, store, draft };
}
describe('Builder input security uses actual schema/content validation', () => {
  test.each([
    'https://example.invalid/x', 'HTTP://example.invalid', 'ftp://example.invalid', 'custom:payload',
    '//example.invalid/x', 'www.example.invalid', 'example.invalid', '127.0.0.1',
    'file:///private/data', 'content://provider/file', '/private/data', '../data', './data', 'C:\\data\\file',
    'folder/file', 'draft.json', '%68%74%74%70%3a', '<script>bad</script>',
    'access_token', 'refresh_token', 'accessToken', 'refreshToken', 'password', 'Bearer value',
    'authorization', 'client_secret', 'api key', 'API-key', 'credential value',
  ])('rejects prohibited free-text content: %s', value => {
    const { draft, map, store } = fixture();
    for (const field of ['name', 'description'] as const) {
      const candidate = { ...draft, [field]: value };
      expect(validateBuilderDraft(candidate).some(e => e.path === field && e.category === 'SCHEMA_INVALID')).toBe(true);
      const before = map.get(BUILDER_KEY); expect(() => store.save(candidate, 0)).toThrow(); expect(map.get(BUILDER_KEY)).toBe(before);
    }
    expect(validateBuilderDraft({ ...draft, patients: [{ ...draft.patients[0], displayName: value }] }).length).toBeGreaterThan(0);
  });
  test('ordinary Estonian synthetic prose, decimals and units remain accepted', () => {
    const { draft } = fixture();
    expect(validateBuilderDraft({ ...draft, description: 'Sünteetiline patsient – vaagnalahas. Temperatuur 36,8 °C; SpO₂ 98%.\nEi ole kliiniliselt valideeritud!' })).toEqual([]);
    expect(validateBuilderDraft({ ...draft, name: 'Õ'.repeat(C.maxName), description: 'a'.repeat(C.maxDescription) })).toEqual([]);
  });
  test.each(['access_token', 'refresh_token', 'credentials', 'checkpoint', 'runtime', 'publication', '__proto__'])('rejects unexpected nested object field %s and preserves persisted bytes', key => {
    const { draft, map, store } = fixture();
    const variants = [
      { ...draft, [key]: { secret: 'forbidden' } },
      { ...draft, patients: [{ ...draft.patients[0], [key]: { nested: true } }] },
      { ...draft, patients: [{ ...draft.patients[0], initialInputs: { ...draft.patients[0].initialInputs, [key]: {} } }] },
      { ...draft, patients: [{ ...draft.patients[0], laboratory: { ...draft.patients[0].laboratory, [key]: {} } }] },
      { ...draft, patients: [{ ...draft.patients[0], imaging: [{ ...draft.patients[0].imaging[0], [key]: {} }] }] },
      { ...draft, description: { [key]: {} } },
    ];
    for (const value of variants) {
      expect(validateBuilderDraft(value).length).toBeGreaterThan(0);
      const before = map.get(BUILDER_KEY); expect(() => store.save(value as DemoBuilderDraft, 0)).toThrow(); expect(map.get(BUILDER_KEY)).toBe(before);
    }
  });
  test.each([
    (d: DemoBuilderDraft) => { d.patients[0].imaging[0].assetId = 'https://example.invalid'; },
    (d: DemoBuilderDraft) => { d.patients[0].imaging[0].examinationId = '../image'; },
    (d: DemoBuilderDraft) => { d.patients[0].patientId = 'PT-001'; },
    (d: DemoBuilderDraft) => { d.patients[0].clinicalPresetId = 'UNSUPPORTED'; },
    (d: DemoBuilderDraft) => { d.draftId = 'EX-1'; },
    (d: DemoBuilderDraft) => { d.description = 'x'.repeat(C.maxDescription + 1); },
  ])('rejects invalid identities, asset references and excessive text', change => {
    const { draft } = fixture(); change(draft); expect(validateBuilderDraft(draft).length).toBeGreaterThan(0);
  });
  test.each(['{broken', JSON.stringify({ schemaVersion: 2, drafts: [] })])('future/corrupt collection cannot be edited or deleted', raw => {
    const { draft, map, store } = fixture(); map.set(BUILDER_KEY, raw);
    for (const operation of [() => store.list(), () => store.create(), () => store.save(draft, 0), () => store.delete(draft.draftId, 0)]) {
      expect(operation).toThrow(); expect(map.get(BUILDER_KEY)).toBe(raw);
    }
  });
});
