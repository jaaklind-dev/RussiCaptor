export const DEMO_DATABASE = 'russicaptor-offline-demo-v1.db';
export const DEMO_STORAGE_KEY = 'russicaptor.offline-demo.session.v1';
export type DemoStorage = Readonly<{ getItemSync(key: string): string | null; setItemSync(key: string, value: string): void }>;
export type DemoSnapshot = Readonly<{ schemaVersion: 1; generation: number; screen: 'home' | 'patient'; visits: number }>;
export const SYNTHETIC_PATIENT = Object.freeze({ id: 'DEMO-PATIENT-001', name: 'Demo patsient A',
  triage: 'P2', location: 'DEMO vastuvõtt', presentation: 'Sünteetiline näidispatsient. Kliinilisi toiminguid selles versioonis ei tehta.',
  vitals: Object.freeze({ heartRate: 80, systolic: 120, diastolic: 80, respiratoryRate: 16, oxygenSaturation: 98 }) });
const initial = (generation: number): DemoSnapshot => Object.freeze({ schemaVersion: 1, generation, screen: 'home', visits: 0 });
export function validDemoSnapshot(value: unknown): value is DemoSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join(',') === 'generation,schemaVersion,screen,visits' && v.schemaVersion === 1 &&
    Number.isSafeInteger(v.generation) && Number(v.generation) >= 0 && Number(v.generation) < Number.MAX_SAFE_INTEGER &&
    Number.isSafeInteger(v.visits) && Number(v.visits) >= 0 && Number(v.visits) < Number.MAX_SAFE_INTEGER &&
    (v.screen === 'home' || v.screen === 'patient');
}
export class DemoStore {
  private snapshot: DemoSnapshot = initial(0);
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: DemoStorage) {
    const raw = storage.getItemSync(DEMO_STORAGE_KEY);
    if (raw !== null) {
      try { const parsed: unknown = JSON.parse(raw); if (!validDemoSnapshot(parsed)) throw new Error(); this.snapshot = Object.freeze(parsed); }
      catch { throw new Error('OFFLINE_DEMO_STATE_INVALID'); }
    }
  }
  getSnapshot = (): DemoSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  /** Captured generation makes callbacks from an exited/reset view harmless. */
  openPatient = (generation: number): boolean => this.commit(generation, { ...this.snapshot, screen: 'patient', visits: this.snapshot.visits + 1 });
  home = (generation: number): boolean => this.commit(generation, { ...this.snapshot, screen: 'home' });
  reset = (generation: number): boolean => {
    if (generation !== this.snapshot.generation) return false;
    this.persist(initial(this.snapshot.generation + 1)); return true;
  };
  private commit(generation: number, next: DemoSnapshot): boolean {
    if (generation !== this.snapshot.generation) return false;
    this.persist(next); return true;
  }
  private persist(next: DemoSnapshot): void {
    if (!validDemoSnapshot(next)) throw new Error('OFFLINE_DEMO_STATE_INVALID');
    try { this.storage.setItemSync(DEMO_STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error('OFFLINE_DEMO_STORAGE_UNAVAILABLE'); }
    this.snapshot = Object.freeze(next); this.listeners.forEach(listener => listener());
  }
}
