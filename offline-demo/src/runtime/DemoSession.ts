import { advancePatients, applyBinder, DEMO_FIXTURE, DEMO_MAX_SECONDS, initialPatients, type DemoPatient } from './DemoDomain';
export const DEMO_RUNTIME_KEY = 'russicaptor.offline-demo.runtime.v2';
export const DEMO_RESET_RECEIPT_KEY = 'russicaptor.offline-demo.acceptance.reset.v1';
export type DemoCommand = Readonly<{ id: string; sessionId: string; generation: number; time: number; patientId: 'DEMO-PT-A'; type: 'APPLY_PELVIC_BINDER' }>;
export type DemoEvent = Readonly<{ id: number; time: number; kind: 'START' | 'PAUSE' | 'RESUME' | 'BACKGROUND' | 'RECOVERY' | 'BINDER_APPLIED' | 'LIMIT'; commandId?: string }>;
export type DemoSession = { schemaVersion: 2; fixture: typeof DEMO_FIXTURE; sessionId: string; generation: number;
  mode: 'home' | 'CM' | 'EXCON'; selectedPatient: 'DEMO-PT-A' | 'DEMO-PT-B'; lifecycle: 'READY' | 'RUNNING' | 'PAUSED';
  time: number; patients: DemoPatient[]; commands: DemoCommand[]; events: DemoEvent[] };
export type DemoStorage = Readonly<{ getItemSync(key: string): string | null; setItemSync(key: string, value: string): void }>;
export type SessionView = Readonly<{ status: 'READY'; session: DemoSession; restored: boolean } | { status: 'RECOVERY_REQUIRED'; reason: 'STATE_INVALID' | 'STORAGE_UNAVAILABLE' }>;
export const newDemoId = () => `DEMO-LOCAL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function freshSession(id: string, generation: number): DemoSession {
  if (!/^DEMO-LOCAL-[a-z0-9-]{1,100}$/.test(id) || !Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER) throw new Error('DEMO_SESSION_IDENTITY_INVALID');
  return { schemaVersion: 2, fixture: DEMO_FIXTURE, sessionId: id, generation, mode: 'home', selectedPatient: 'DEMO-PT-A',
    lifecycle: 'READY', time: 0, patients: initialPatients(), commands: [], events: [] };
}
function keys(value: unknown, expected: string): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected.split(',').sort().join(',');
}
const safeInt = (n: unknown, max = Number.MAX_SAFE_INTEGER - 1): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
type ResetReceipt = { schemaVersion: 1; fromSessionId: string; toSessionId: string; fromGeneration: number; toGeneration: number;
  fromTimeSec: number; toTimeSec: 0 };
export type DemoAcceptanceReport = Readonly<{
  schemaVersion: 1; kind: 'OFFLINE_DEMO_ACCEPTANCE'; source: 'PERSISTED_DEMO_ROW'; sessionId: string;
  generation: number; simulationTimeSec: number; lifecycle: DemoSession['lifecycle']; commandCount: number;
  commands: ReadonlyArray<Readonly<{ id: string; type: 'APPLY_PELVIC_BINDER'; simulationTimeSec: number; processingStatus: 'APPLIED_EVENT_VERIFIED' }>>;
  resetTransition: Readonly<{ status: 'NOT_AVAILABLE' } | { status: 'PERSISTED_BEFORE_AND_AFTER'; fromGeneration: number;
    toGeneration: number; fromSimulationTimeSec: number; toSimulationTimeSec: 0 }>;
}>;
function resetReceipt(raw: string): ResetReceipt {
  if (raw.length > 1024) throw new Error('DEMO_ACCEPTANCE_UNAVAILABLE');
  const r: ResetReceipt = JSON.parse(raw);
  if (!keys(r, 'schemaVersion,fromSessionId,toSessionId,fromGeneration,toGeneration,fromTimeSec,toTimeSec') || r.schemaVersion !== 1 ||
      typeof r.fromSessionId !== 'string' || typeof r.toSessionId !== 'string' ||
      !/^DEMO-LOCAL-[a-z0-9-]{1,100}$/.test(r.fromSessionId) || !/^DEMO-LOCAL-[a-z0-9-]{1,100}$/.test(r.toSessionId) ||
      r.fromSessionId === r.toSessionId || !safeInt(r.fromGeneration) || !safeInt(r.toGeneration) ||
      r.toGeneration !== r.fromGeneration + 1 || !safeInt(r.fromTimeSec, DEMO_MAX_SECONDS) || r.toTimeSec !== 0) throw new Error('DEMO_ACCEPTANCE_UNAVAILABLE');
  return r;
}
export function validCommand(value: unknown): value is DemoCommand {
  if (!keys(value, 'id,sessionId,generation,time,patientId,type')) return false;
  const c = value as DemoCommand;
  return typeof c.id === 'string' && /^DEMO-CMD-[A-Za-z0-9:-]{1,160}$/.test(c.id) && /^DEMO-LOCAL-[a-z0-9-]{1,100}$/.test(c.sessionId) &&
    safeInt(c.generation) && safeInt(c.time, DEMO_MAX_SECONDS) && c.patientId === 'DEMO-PT-A' && c.type === 'APPLY_PELVIC_BINDER';
}
export function restoreSession(raw: string): DemoSession {
  if (raw.length > 160_000) throw new Error('DEMO_STATE_INVALID');
  const s: DemoSession = JSON.parse(raw);
  if (!keys(s, 'schemaVersion,fixture,sessionId,generation,mode,selectedPatient,lifecycle,time,patients,commands,events') || s.schemaVersion !== 2 ||
      s.fixture !== DEMO_FIXTURE || typeof s.sessionId !== 'string' || !/^DEMO-LOCAL-[a-z0-9-]{1,100}$/.test(s.sessionId) ||
      !safeInt(s.generation) || !safeInt(s.time, DEMO_MAX_SECONDS) || !['home','CM','EXCON'].includes(s.mode) ||
      !['DEMO-PT-A','DEMO-PT-B'].includes(s.selectedPatient) || !['READY','RUNNING','PAUSED'].includes(s.lifecycle) ||
      !Array.isArray(s.commands) || s.commands.length > 1 || !Array.isArray(s.events) || s.events.length > 2000 ||
      s.lifecycle === 'READY' && (s.time !== 0 || s.commands.length !== 0 || s.events.length !== 0)) throw new Error('DEMO_STATE_INVALID');
  for (const c of s.commands) if (!validCommand(c) || c.sessionId !== s.sessionId || c.generation !== s.generation || c.time > s.time) throw new Error('DEMO_STATE_INVALID');
  let lastTime = 0; let phase: DemoSession['lifecycle'] = 'READY';
  for (const [index, event] of s.events.entries()) {
    if (!keys(event, event.kind === 'BINDER_APPLIED' ? 'id,time,kind,commandId' : 'id,time,kind') || event.id !== index + 1 ||
        !safeInt(event.time, s.time) || event.time < lastTime || !['START','PAUSE','RESUME','BACKGROUND','RECOVERY','BINDER_APPLIED','LIMIT'].includes(event.kind) ||
        event.time > lastTime && phase !== 'RUNNING') throw new Error('DEMO_STATE_INVALID');
    if (event.kind === 'START') { if (phase !== 'READY' || event.time !== 0) throw new Error('DEMO_STATE_INVALID'); phase = 'RUNNING'; }
    else if (event.kind === 'RESUME') { if (phase !== 'PAUSED' || event.time >= DEMO_MAX_SECONDS) throw new Error('DEMO_STATE_INVALID'); phase = 'RUNNING'; }
    else if (event.kind === 'BINDER_APPLIED') { if (phase !== 'RUNNING') throw new Error('DEMO_STATE_INVALID'); }
    else { if (phase !== 'RUNNING' || event.kind === 'LIMIT' && event.time !== DEMO_MAX_SECONDS) throw new Error('DEMO_STATE_INVALID'); phase = 'PAUSED'; }
    lastTime = event.time;
  }
  if (phase !== s.lifecycle || s.time > lastTime && phase !== 'RUNNING' || s.time === DEMO_MAX_SECONDS && phase === 'RUNNING') throw new Error('DEMO_STATE_INVALID');
  const actions = s.events.filter(e => e.kind === 'BINDER_APPLIED');
  if (actions.length !== s.commands.length || actions.some((e, i) => e.commandId !== s.commands[i].id || e.time !== s.commands[i].time) ||
      s.lifecycle !== 'READY' && (s.events[0]?.kind !== 'START' || s.events[0]?.time !== 0)) throw new Error('DEMO_STATE_INVALID');
  // Reconstruct using the real domain engines. Never trust a deserialized clinical object by shape alone.
  let patients = initialPatients();
  for (let time = 0; time <= s.time; time++) {
    if (time > 0) patients = advancePatients(patients, time);
    for (const c of s.commands.filter(command => command.time === time)) patients = applyBinder(patients, c.id, time);
  }
  if (JSON.stringify(patients) !== JSON.stringify(s.patients)) throw new Error('DEMO_STATE_INVALID');
  return s;
}
export class DemoSessionStore {
  private view!: SessionView;
  private generation = 0;
  private identity?: Readonly<{ sessionId: string; generation: number }>;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: DemoStorage, private readonly idFactory = newDemoId) {
    this.load();
  }
  private load() {
    try {
      const raw = this.storage.getItemSync(DEMO_RUNTIME_KEY);
      const session = raw === null ? freshSession(this.idFactory(), 0) : restoreSession(raw);
      this.generation = session.generation;
      this.identity = { sessionId: session.sessionId, generation: session.generation };
      if (session.lifecycle === 'RUNNING') { session.lifecycle = 'PAUSED'; this.event(session, 'RECOVERY'); }
      this.view = freeze({ status: 'READY', session, restored: raw !== null });
    } catch { this.view = freeze({ status: 'RECOVERY_REQUIRED', reason: 'STATE_INVALID' }); }
  }
  getSnapshot = (): SessionView => this.view;
  fail() { this.publish({ status: 'RECOVERY_REQUIRED', reason: 'STATE_INVALID' }); }
  recover() { if (this.view.status !== 'RECOVERY_REQUIRED') return false; this.load(); this.listeners.forEach(listener => listener()); return this.getSnapshot().status === 'READY'; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(view: SessionView) { this.view = freeze(view); this.listeners.forEach(listener => listener()); }
  private requireSession(): DemoSession { if (this.view.status !== 'READY') throw new Error('DEMO_RECOVERY_REQUIRED'); return this.view.session; }
  private save(next: DemoSession) {
    const serialized = JSON.stringify(next);
    try { this.storage.setItemSync(DEMO_RUNTIME_KEY, serialized); }
    catch {
      // A lost acknowledgement may follow a successful atomic SQLite upsert.
      let saved = false;
      try { saved = this.storage.getItemSync(DEMO_RUNTIME_KEY) === serialized; } catch { /* fixed, bounded recovery state */ }
      if (!saved) { this.publish({ status: 'RECOVERY_REQUIRED', reason: 'STORAGE_UNAVAILABLE' }); throw new Error('DEMO_STORAGE_UNAVAILABLE'); }
    }
    // Publish exactly the representation accepted by storage, not a second mutable candidate.
    const committed = JSON.parse(serialized) as DemoSession;
    this.generation = committed.generation; this.identity = { sessionId: committed.sessionId, generation: committed.generation };
    this.publish({ status: 'READY', session: committed, restored: false });
  }
  private event(s: DemoSession, kind: DemoEvent['kind'], commandId?: string) {
    if (s.events.length >= 2000) throw new Error('DEMO_HISTORY_LIMIT');
    s.events.push({ id: s.events.length + 1, time: s.time, kind, ...(commandId ? { commandId } : {}) });
  }
  private current(sessionId: string, generation: number) { return this.view.status === 'READY' && this.view.session.sessionId === sessionId && this.view.session.generation === generation; }
  navigate(mode: DemoSession['mode'], patientId?: DemoSession['selectedPatient']) {
    if (!['home','CM','EXCON'].includes(mode) || patientId && !['DEMO-PT-A','DEMO-PT-B'].includes(patientId)) throw new Error('DEMO_NAVIGATION_INVALID');
    const next = structuredClone(this.requireSession()); next.mode = mode; if (patientId) next.selectedPatient = patientId; this.save(next);
  }
  control(kind: 'START' | 'PAUSE' | 'RESUME' | 'BACKGROUND') {
    if (!['START','PAUSE','RESUME','BACKGROUND'].includes(kind)) throw new Error('DEMO_CONTROL_INVALID');
    const next = structuredClone(this.requireSession());
    if ((kind === 'START' && next.lifecycle !== 'READY') || (kind === 'RESUME' && next.lifecycle !== 'PAUSED') ||
        (['PAUSE','BACKGROUND'].includes(kind) && next.lifecycle !== 'RUNNING') || next.time >= DEMO_MAX_SECONDS && ['START','RESUME'].includes(kind)) return false;
    next.lifecycle = ['START','RESUME'].includes(kind) ? 'RUNNING' : 'PAUSED'; this.event(next, kind); this.save(next); return true;
  }
  tick(sessionId: string, generation: number): boolean {
    if (!this.current(sessionId, generation)) return false;
    const next = structuredClone(this.requireSession()); if (next.lifecycle !== 'RUNNING') return false;
    if (next.time >= DEMO_MAX_SECONDS) return false;
    next.time++; next.patients = advancePatients(next.patients, next.time);
    if (next.time === DEMO_MAX_SECONDS) { next.lifecycle = 'PAUSED'; this.event(next, 'LIMIT'); }
    this.save(next); return true;
  }
  command(value: unknown): 'ACCEPTED' | 'DUPLICATE' {
    if (!validCommand(value)) throw new Error('DEMO_COMMAND_INVALID');
    const session = this.requireSession();
    if (!this.current(value.sessionId, value.generation)) throw new Error('DEMO_COMMAND_OBSOLETE');
    const existing = session.commands.find(c => c.id === value.id);
    if (existing) { if (Object.keys(existing).some(key => existing[key as keyof DemoCommand] !== value[key as keyof DemoCommand])) throw new Error('DEMO_COMMAND_ID_CONFLICT'); return 'DUPLICATE'; }
    if (session.lifecycle !== 'RUNNING' || value.time !== session.time || session.mode !== 'CM' || session.selectedPatient !== value.patientId) throw new Error('DEMO_COMMAND_NOT_READY');
    if (session.commands.length) throw new Error('DEMO_BINDER_ALREADY_APPLIED');
    const next = structuredClone(session); next.patients = applyBinder(next.patients, value.id, value.time);
    next.commands.push({ id: value.id, sessionId: value.sessionId, generation: value.generation, time: value.time,
      patientId: value.patientId, type: value.type }); this.event(next, 'BINDER_APPLIED', value.id); this.save(next); return 'ACCEPTED';
  }
  /** Read-only, whitelisted evidence from the real committed row, never the rendered/in-memory command list. */
  acceptanceReport(binding: Pick<DemoSession, 'sessionId' | 'generation'>): DemoAcceptanceReport {
    try {
      if (!this.current(binding.sessionId, binding.generation)) throw new Error();
      const raw = this.storage.getItemSync(DEMO_RUNTIME_KEY);
      if (raw === null) throw new Error(); // A never-saved fresh session is not persisted evidence.
      const s = restoreSession(raw);
      if (s.sessionId !== binding.sessionId || s.generation !== binding.generation ||
          s.commands.some(c => c.id !== `DEMO-CMD-${s.sessionId}:binder`)) throw new Error();
      const receiptRaw = this.storage.getItemSync(DEMO_RESET_RECEIPT_KEY);
      const receipt = receiptRaw === null ? undefined : resetReceipt(receiptRaw);
      const transition: DemoAcceptanceReport['resetTransition'] = receipt?.toSessionId === s.sessionId && receipt.toGeneration === s.generation
        ? { status: 'PERSISTED_BEFORE_AND_AFTER', fromGeneration: receipt.fromGeneration, toGeneration: receipt.toGeneration,
          fromSimulationTimeSec: receipt.fromTimeSec, toSimulationTimeSec: receipt.toTimeSec }
        : { status: 'NOT_AVAILABLE' };
      if (this.storage.getItemSync(DEMO_RUNTIME_KEY) !== raw) throw new Error();
      return freeze({ schemaVersion: 1, kind: 'OFFLINE_DEMO_ACCEPTANCE', source: 'PERSISTED_DEMO_ROW', sessionId: s.sessionId,
        generation: s.generation, simulationTimeSec: s.time, lifecycle: s.lifecycle, commandCount: s.commands.length,
        commands: s.commands.map(c => ({ id: c.id, type: c.type, simulationTimeSec: c.time, processingStatus: 'APPLIED_EVENT_VERIFIED' })),
        resetTransition: transition });
    } catch { throw new Error('DEMO_ACCEPTANCE_UNAVAILABLE'); }
  }
  reset(sessionId?: string, generation?: number): boolean {
    if (this.view.status === 'READY' && !this.current(sessionId ?? '', generation ?? -1)) return false;
    if ((sessionId !== undefined || generation !== undefined) &&
        (this.identity?.sessionId !== sessionId || this.identity?.generation !== generation)) return false;
    if (this.generation >= Number.MAX_SAFE_INTEGER - 1) throw new Error('DEMO_GENERATION_LIMIT');
    const id = this.idFactory();
    if (this.view.status === 'READY' && id === this.view.session.sessionId) throw new Error('DEMO_SESSION_ID_COLLISION');
    let before: DemoSession | undefined;
    try {
      const raw = this.storage.getItemSync(DEMO_RUNTIME_KEY);
      if (raw !== null) {
        const persisted = restoreSession(raw);
        if (persisted.sessionId === this.identity?.sessionId && persisted.generation === this.generation) before = persisted;
      }
    } catch { /* Reset may recover a corrupt session, but cannot claim a verified previous generation. */ }
    this.save(freshSession(id, this.generation + 1));
    // Diagnostic receipt is secondary: its failure cannot undo or corrupt a successful runtime reset.
    // A crash before this write leaves NOT_AVAILABLE evidence, never a fabricated successful transition.
    if (before) try {
      const raw = this.storage.getItemSync(DEMO_RUNTIME_KEY);
      const after = raw === null ? undefined : restoreSession(raw);
      if (after?.sessionId === id && after.generation === before.generation + 1 && after.time === 0) {
        const receipt: ResetReceipt = { schemaVersion: 1, fromSessionId: before.sessionId, toSessionId: after.sessionId,
          fromGeneration: before.generation, toGeneration: after.generation, fromTimeSec: before.time, toTimeSec: 0 };
        this.storage.setItemSync(DEMO_RESET_RECEIPT_KEY, JSON.stringify(receipt));
      }
    } catch { /* Export reports a missing/stale receipt explicitly. No clinical or raw error data is logged. */ }
    return true;
  }
}
