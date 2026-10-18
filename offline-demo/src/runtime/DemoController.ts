import { DemoSessionStore, type DemoCommand, type DemoSession } from './DemoSession';
type Binding = Pick<DemoSession, 'sessionId' | 'generation'>;
export type DemoScheduler = { schedule(callback: () => void): unknown; cancel(handle: unknown): void };
const scheduler: DemoScheduler = { schedule: callback => setInterval(callback, 1000), cancel: handle => clearInterval(handle as ReturnType<typeof setInterval>) };
export class DemoController {
  private handle?: unknown;
  private epoch = 0;
  private foreground: boolean;
  private disposed = false;
  private readonly unsubscribe: () => void;
  constructor(readonly store: DemoSessionStore, private readonly timer: DemoScheduler = scheduler, foreground = true) {
    this.foreground = foreground; this.unsubscribe = store.subscribe(() => this.reconcile()); this.setForeground(foreground);
  }
  private stop() { this.epoch++; if (this.handle !== undefined) this.timer.cancel(this.handle); this.handle = undefined; }
  private reconcile() {
    const view = this.store.getSnapshot();
    if (this.disposed || !this.foreground || view.status !== 'READY' || view.session.lifecycle !== 'RUNNING') { this.stop(); return; }
    if (this.handle !== undefined) return;
    const { sessionId, generation } = view.session; const epoch = ++this.epoch;
    this.handle = this.timer.schedule(() => {
      if (this.disposed || !this.foreground || epoch !== this.epoch) return;
      try { this.store.tick(sessionId, generation); } catch { this.stop(); this.store.fail(); }
    });
  }
  setForeground(active: boolean) {
    if (this.disposed) return;
    this.foreground = active;
    if (!active) {
      this.stop(); const view = this.store.getSnapshot();
      if (view.status === 'READY' && view.session.lifecycle === 'RUNNING') {
        try { this.store.control('BACKGROUND'); } catch { this.store.fail(); }
      }
    }
    this.reconcile();
  }
  private matches(binding?: Binding) {
    const view = this.store.getSnapshot(); return !binding || view.status === 'READY' && view.session.sessionId === binding.sessionId && view.session.generation === binding.generation;
  }
  navigate(mode: DemoSession['mode'], patientId: DemoSession['selectedPatient'] | undefined, binding: Binding) {
    if (this.disposed || !this.foreground || !this.matches(binding)) return false;
    this.store.navigate(mode, patientId); return true;
  }
  control(kind: 'START' | 'PAUSE' | 'RESUME', binding?: Binding) {
    if (this.disposed || !this.foreground) throw new Error('DEMO_CONTROL_NOT_READY');
    if (!this.matches(binding)) return false;
    return this.store.control(kind);
  }
  binder(command: DemoCommand) { if (this.disposed || !this.foreground) throw new Error('DEMO_COMMAND_NOT_READY'); return this.store.command(command); }
  reset(sessionId?: string, generation?: number) {
    if (this.disposed) return false;
    const view = this.store.getSnapshot();
    if (view.status === 'READY' && (view.session.sessionId !== sessionId || view.session.generation !== generation)) return false;
    this.stop(); return this.store.reset(sessionId, generation);
  }
  dispose() { this.disposed = true; this.stop(); this.unsubscribe(); }
}
