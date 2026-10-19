import type { DemoBuilderDraft } from './DemoBuilderDraft';
import { BUILDER_CAPABILITIES as C, capabilityState, LOCATIONS, presetById } from './DemoBuilderCapabilities';
export type BuilderIssue = { category: 'SCHEMA_INVALID' | 'UNSUPPORTED_CAPABILITY' | 'CLINICALLY_INCONSISTENT' | 'MISSING_ASSET' | 'REVISION_CONFLICT'; path: string; message: string };
export const exactKeys = (v: unknown, fields: string): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).every(key => typeof key === 'string' &&
    Object.getOwnPropertyDescriptor(v, key)?.enumerable === true && 'value' in Object.getOwnPropertyDescriptor(v, key)!) &&
  Reflect.ownKeys(v).sort().join(',') === fields.split(',').sort().join(',');
/** Accept only inert JSON-shaped data. Inspect descriptors before reading values;
 * cloning/stringifying first could erase a hostile prototype or invoke accessors. */
export function plainBuilderData(value: unknown): boolean {
  const ancestors = new Set<object>(); let nodes = 0;
  function visit(v: unknown, depth: number): boolean {
    if (++nodes > 4000 || depth > 16) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v !== 'object' || ancestors.has(v)) return false;
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) return false;
    const names = Reflect.ownKeys(v);
    if (names.length > 1000) return false;
    ancestors.add(v);
    for (const key of names) {
      if (typeof key !== 'string') return false;
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in descriptor)) return false;
      if (array && key === 'length') continue;
      if (!descriptor.enumerable || array && !/^(?:0|[1-9]\d*)$/.test(key) || !visit(descriptor.value, depth + 1)) return false;
    }
    if (array && Object.keys(v).length !== (v as unknown[]).length) return false;
    ancestors.delete(v); return true;
  }
  try { return visit(value, 0); } catch { return false; }
}
// Authoring prose only: letters, numbers, spacing and these presentation marks.
// No address/path delimiters, markup, key/value assignments or encoded escapes.
// This is a content policy, not an alternative URL parser or service denylist.
const prose = /^[\p{L}\p{N}\p{Zs}\n\r\t.,;!?()'"’“”„–—%°+−-]*$/u;
const addressLike = /\bwww\.|(?:[\p{L}\p{N}-]+\.)+[a-z]{2,63}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|%[a-f0-9]{2}/iu;
const credentialLike = /\b(?:\w*token\w*|password|authorization|bearer|secret|credential\w*|api[ -]?key)\b/i;
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max &&
  prose.test(v) && !addressLike.test(v) && !credentialLike.test(v);
const id = (v: unknown, prefix: string) => typeof v === 'string' && new RegExp(`^${prefix}-[a-z0-9-]{1,100}$`).test(v);
const stamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function validateBuilderDraft(value: unknown, complete = true): BuilderIssue[] {
  const errors: BuilderIssue[] = [];
  const add = (category: BuilderIssue['category'], path: string, message: string) => errors.push({ category, path, message });
  if (!plainBuilderData(value) || !exactKeys(value, 'schemaVersion,capabilityVersion,revision,draftId,name,description,createdAt,modifiedAt,patients,validationReceipt') || value.schemaVersion !== 1) {
    add('SCHEMA_INVALID', 'schemaVersion', 'Mustandi vorming ei ole toetatud. Algandmeid ei kirjutata üle.'); return errors;
  }
  const d = value as unknown as DemoBuilderDraft;
  if (d.capabilityVersion !== C.version) add('UNSUPPORTED_CAPABILITY', 'capabilityVersion', 'Mustand vajab teist võimekuste versiooni.');
  if (!id(d.draftId, 'DEMO-DRAFT')) add('SCHEMA_INVALID', 'draftId', 'Vigane DEMO mustandi ID.');
  if (!Number.isSafeInteger(d.revision) || d.revision < 0 || d.revision >= Number.MAX_SAFE_INTEGER) add('SCHEMA_INVALID', 'revision', 'Vigane revisjon.');
  if (!stamp(d.createdAt) || !stamp(d.modifiedAt) || d.modifiedAt < d.createdAt) add('SCHEMA_INVALID', 'modifiedAt', 'Vigased autoritöö ajatemplid.');
  if (!text(d.name, C.maxName) || complete && !d.name.trim()) add('SCHEMA_INVALID', 'name', 'Nimi on kohustuslik, kuni 100 märki.');
  if (!text(d.description, C.maxDescription)) add('SCHEMA_INVALID', 'description', 'Kirjeldus peab olema lihttekst, kuni 2000 märki.');
  if (!Array.isArray(d.patients)) { add('SCHEMA_INVALID', 'patients', 'Patsiendiloend puudub.'); return errors; }
  if (d.patients.length > C.maxPatients || complete && d.patients.length === 0) add('UNSUPPORTED_CAPABILITY', 'patients', 'MVP toetab 1–2 patsienti.');
  const ids = new Set<string>(), presets = new Set<string>();
  d.patients.forEach((p, i) => {
    const path = `patients[${i}]`;
    if (!exactKeys(p, 'patientId,displayName,age,sex,triage,initialLocation,clinicalPresetId,presetVersion,initialInputs,laboratory,imaging')) { add('SCHEMA_INVALID', path, 'Patsiendi vorming on vigane.'); return; }
    if (!id(p.patientId, 'DEMO-PATIENT') || ids.has(p.patientId)) add('SCHEMA_INVALID', `${path}.patientId`, 'Patsiendi ID peab olema unikaalne DEMO ID.');
    ids.add(p.patientId);
    if (!text(p.displayName, C.maxPatientName) || !p.displayName.trim()) add('SCHEMA_INVALID', `${path}.displayName`, 'Sünteetiline nimi on kohustuslik, kuni 80 märki.');
    if (!Number.isInteger(p.age) || p.age < C.minAge || p.age > C.maxAge || !['F','M','OTHER','UNKNOWN'].includes(p.sex)) add('SCHEMA_INVALID', `${path}.demographics`, 'Demo toetab vanust 18–100 ja loetletud soo väärtusi. See ei muuda füsioloogiat.');
    if (!['P1','P2','P3','P4'].includes(p.triage) || !LOCATIONS.includes(p.initialLocation)) add('SCHEMA_INVALID', path, 'Triaaž või algasukoht ei ole toetatud.');
    const preset = presetById(p.clinicalPresetId);
    if (capabilityState('preset', p.clinicalPresetId) !== 'SUPPORTED' || !preset || p.presetVersion !== preset.version) { add('UNSUPPORTED_CAPABILITY', `${path}.clinicalPresetId`, 'Kliiniline mall on tundmatu või pole selles versioonis saadaval.'); return; }
    if (presets.has(preset.id)) add('UNSUPPORTED_CAPABILITY', path, 'MVP lubab iga traumamalli ühe korra.');
    presets.add(preset.id);
    if (!exactKeys(p.initialInputs, 'configurationId') || p.initialInputs.configurationId !== preset.configurationId) add('CLINICALLY_INCONSISTENT', `${path}.initialInputs`, 'Lubatud on ainult kontrollitud malli algsisendid, mitte tuletatud näitude muutmine.');
    if (!exactKeys(p.laboratory, 'panelId,delaySeconds') || p.laboratory.panelId !== 'DEMO_TRAUMA_BASIC_V1' || p.laboratory.delaySeconds !== 30) add('UNSUPPORTED_CAPABILITY', `${path}.laboratory`, 'Toetatud on seitsme analüüdi paneel 30 simulatsioonisekundiga.');
    const a = p.imaging?.[0];
    if (!Array.isArray(p.imaging) || p.imaging.length !== 1 || !exactKeys(a, 'examinationId,assetId,reportId,sha256,delaySeconds') ||
      a.assetId !== preset.asset.assetId || a.sha256 !== preset.asset.sha256 || a.reportId !== preset.asset.reportId || a.examinationId !== preset.asset.examinationId || a.delaySeconds !== 30)
      add('MISSING_ASSET', `${path}.imaging`, 'Uuring peab viitama selle malli heakskiidetud lokaalsele varale ja raportile.');
  });
  const r = d.validationReceipt;
  if (r !== null && (!exactKeys(r, 'validatorVersion,validatedRevision') || r.validatorVersion !== 'MVP1-V1' || r.validatedRevision !== d.revision)) add('SCHEMA_INVALID', 'validationReceipt', 'Valideerimiskinnitus on aegunud või vigane.');
  if (JSON.stringify(d).length > C.maxRecordChars) add('SCHEMA_INVALID', '', 'Mustand on liiga suur.');
  return errors;
}
