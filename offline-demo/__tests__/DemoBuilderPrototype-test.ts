import { execFileSync } from 'node:child_process';
import { newBuilderPatient, type DemoBuilderDraft } from '../src/builder/DemoBuilderDraft';
import { BUILDER_KEY, DemoBuilderStore, type BuilderStorage } from '../src/builder/DemoBuilderStore';
import { exactKeys, validateBuilderDraft } from '../src/builder/DemoBuilderValidation';
function fixture() {
  const map = new Map<string, string>();
  const storage: BuilderStorage = { getItemSync: k => map.get(k) ?? null, setItemSync: (k, update) => { map.set(k, update(map.get(k) ?? null)); } };
  const store = new DemoBuilderStore(storage);
  const draft: DemoBuilderDraft = { ...store.create(), name: 'Prototüübi test', patients: [newBuilderPatient()] };
  return { draft, store, map };
}
function reject(value: unknown) { expect(validateBuilderDraft(value).some(e => e.category === 'SCHEMA_INVALID')).toBe(true); }
describe('Builder prototype and descriptor boundary', () => {
  test('same computed source: native Node owns a data key; actual Expo Babel Object.assign changes the prototype', () => {
    const { draft } = fixture();
    const source = 'const key = "__proto__"; const object = { ...draft, [key]: { secret: "forbidden" } }; return object;';
    const script = `const babel=require('@babel/core');const draft=${JSON.stringify(draft)};
      const source=${JSON.stringify(source)};
      const inspect=o=>({ownKeys:Reflect.ownKeys(o),ownDescriptor:Object.getOwnPropertyDescriptor(o,'__proto__')??null,
        standardPrototype:Object.getPrototypeOf(o)===Object.prototype,prototypeKeys:Object.getOwnPropertyNames(Object.getPrototypeOf(o))});
      const native=new Function('draft',source)(draft);
      const wrapped='function construct(draft){'+source+'}';
      const transformed=babel.transformSync(wrapped,{presets:['babel-preset-expo'],envName:'test',filename:'proto.ts'}).code;
      const expo=new Function(transformed+';return construct;')()(draft);
      const literal='return {...draft,__proto__:{secret:"forbidden"}};';
      const literalTransformed=babel.transformSync('function construct(draft){'+literal+'}',{presets:['babel-preset-expo'],envName:'test',filename:'proto.ts'}).code;
      console.log(JSON.stringify({native:inspect(native),expo:inspect(expo),transformed,
        nativeLiteral:inspect(new Function('draft',literal)(draft)),
        expoLiteral:inspect(new Function(literalTransformed+';return construct;')()(draft))}));`;
    const evidence = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
    expect(evidence.native.ownKeys).toContain('__proto__'); expect(evidence.native.standardPrototype).toBe(true);
    expect(evidence.native.ownDescriptor).toMatchObject({ enumerable: true, writable: true, configurable: true });
    expect(evidence.expo.ownKeys).not.toContain('__proto__'); expect(evidence.expo.standardPrototype).toBe(false);
    expect(evidence.expo.prototypeKeys).toEqual(['secret']); expect(evidence.transformed).toContain('Object.assign');
    expect(evidence.nativeLiteral.standardPrototype).toBe(false); expect(evidence.nativeLiteral.prototypeKeys).toEqual(['secret']);
    expect(evidence.expoLiteral.standardPrototype).toBe(true); expect(evidence.expoLiteral.ownKeys).not.toContain('__proto__');
    const key = '__proto__', actual = { ...draft, [key]: { secret: 'forbidden' } };
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(actual))).toEqual(['secret']);
    reject(actual); expect(exactKeys(actual, Object.keys(draft).join(','))).toBe(false);
  });
  test('Expo drops literal-only inherited payload; actual changed prototypes and JSON own keys remain rejected', () => {
    const { draft } = fixture();
    const literal = { ...draft, __proto__: { secret: 'forbidden' } };
    expect(Object.hasOwn(literal, '__proto__')).toBe(false);
    // Expo's Object.assign skips the literal's inherited payload entirely.
    // This object is plain and contains no extra data; do not pretend it has a dangerous own key.
    expect(Object.getPrototypeOf(literal)).toBe(Object.prototype); expect(validateBuilderDraft(literal)).toEqual([]);
    const actualPrototype = Object.setPrototypeOf(structuredClone(draft), { secret: 'forbidden' }); reject(actualPrototype);
    const parsed = JSON.parse(JSON.stringify(draft).replace(/}$/, ',"__proto__":{"secret":"forbidden"}}'));
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true); expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype); reject(parsed);
  });
  test('null, foreign and inherited prototypes, own non-enumerables and symbols are rejected', () => {
    const { draft } = fixture();
    const inherited = Object.create({ credentials: 'forbidden' }); Object.defineProperties(inherited, Object.getOwnPropertyDescriptors(draft));
    const nullProto = Object.assign(Object.create(null), draft);
    const hidden = structuredClone(draft); Object.defineProperty(hidden, 'secret', { value: 'forbidden', enumerable: false });
    const symbol = structuredClone(draft); Object.defineProperty(symbol, Symbol('hidden'), { value: 1, enumerable: true });
    const own = structuredClone(draft); Object.defineProperty(own, '__proto__', { value: {}, enumerable: false });
    [inherited, nullProto, hidden, symbol, own].forEach(reject);
    expect(exactKeys(hidden, Object.keys(draft).join(','))).toBe(false);
  });
  test('nested prototype/descriptor/array corruption and accessors fail without invoking getters', () => {
    const { draft } = fixture(); const getter = jest.fn(() => 'unexpected');
    const accessor = structuredClone(draft); Object.defineProperty(accessor, 'name', { get: getter, enumerable: true });
    reject(accessor); expect(getter).not.toHaveBeenCalled();
    const nested = structuredClone(draft); Object.setPrototypeOf(nested.patients[0].initialInputs, { secret: 1 }); reject(nested);
    const array = structuredClone(draft); Object.setPrototypeOf(array.patients, Object.create(Array.prototype)); reject(array);
    const hidden = structuredClone(draft); Object.defineProperty(hidden.patients[0].laboratory, 'secret', { value: 1 }); reject(hidden);
    const sparse = structuredClone(draft); sparse.patients.length = 2; reject(sparse);
    const key = structuredClone(draft); Object.defineProperty(key.patients[0].imaging[0], 'constructor', { value: {}, enumerable: true }); reject(key);
  });
  test('raw hostile input rejected before clone; serialization normalization is not permission to save', () => {
    const { draft, store, map } = fixture();
    const hostile = Object.create({ secret: 'forbidden' }); Object.defineProperties(hostile, Object.getOwnPropertyDescriptors(draft));
    const raw = map.get(BUILDER_KEY); reject(hostile); expect(() => store.save(hostile, 0)).toThrow('SCHEMA_INVALID');
    expect(map.get(BUILDER_KEY)).toBe(raw);
    // JSON strips inherited data: this plain result is structurally different,
    // not evidence that direct validation of the original hostile object passed.
    expect(validateBuilderDraft(JSON.parse(JSON.stringify(hostile)))).toEqual([]);
    expect(Object.hasOwn(Object.prototype, 'secret')).toBe(false);
  });
  test('valid plain data and persisted drafts restore; corrupt/future JSON remains untouched', () => {
    const { draft, store, map } = fixture(); expect(validateBuilderDraft(draft)).toEqual([]);
    const saved = store.save(draft, 0, true); expect(store.list()).toEqual([saved]);
    const parsed = JSON.parse(map.get(BUILDER_KEY)!); parsed.drafts[0].patients[0].laboratory = JSON.parse('{"panelId":"DEMO_TRAUMA_BASIC_V1","delaySeconds":30,"__proto__":{}}');
    const corrupt = JSON.stringify(parsed); map.set(BUILDER_KEY, corrupt);
    expect(() => store.list()).toThrow(); expect(() => store.delete(draft.draftId, 1)).toThrow(); expect(map.get(BUILDER_KEY)).toBe(corrupt);
  });
});
