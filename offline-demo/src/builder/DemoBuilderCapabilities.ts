import manifest from '../../assets/imaging/manifest.json';

/** Authoring capabilities, never production permissions or an engine configuration. */
export const BUILDER_CAPABILITIES = Object.freeze({ version: 'DEMO-BUILDER-MVP1', maxPatients: 2,
  maxPresetInstances: 1, maxDrafts: 10, maxName: 100, maxDescription: 2000, maxPatientName: 80,
  maxRecordChars: 24000, maxStoreChars: 260000, minAge: 18, maxAge: 100 });
export const PRESETS = Object.freeze([
  Object.freeze({ id: 'PELVIC', version: '1.0.0', label: 'Vaagnatrauma', configurationId: 'DEMO-PELVIC-V1',
    summary: 'Olemasolev vaagnaverejooksu mudel; toetatud sekkumine on vaagnalahas. Algse kliinilise konfiguratsiooni muutmine ei ole veel saadaval.', asset: manifest.assets[0] }),
  Object.freeze({ id: 'THORACIC', version: '1.0.0', label: 'Rindkeretrauma', configurationId: 'DEMO-THORACIC-V1',
    summary: 'Olemasolev pleuravigastuse ja hingamispuudulikkuse mudel. Algse kliinilise konfiguratsiooni muutmine ei ole veel saadaval.', asset: manifest.assets[1] }),
]);
export const LOCATIONS = Object.freeze(['DEMO_ED', 'DEMO_SCENE']);
export function capabilityState(kind: 'preset' | 'panel', id: string): 'SUPPORTED' | 'UNAVAILABLE' | 'UNKNOWN' {
  if (kind === 'preset' ? PRESETS.some(p => p.id === id) : id === 'DEMO_TRAUMA_BASIC_V1') return 'SUPPORTED';
  // Recognized product concept only. No clinical implementation is implied.
  if (kind === 'preset' ? id === 'ADDITIONAL_PRESETS' : id === 'ADDITIONAL_PANELS') return 'UNAVAILABLE';
  return 'UNKNOWN';
}
export function presetById(id: string) { return PRESETS.find(p => p.id === id); }
