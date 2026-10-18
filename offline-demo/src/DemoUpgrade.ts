import { DEMO_STORAGE_KEY, validDemoSnapshot, type DemoStorage } from './DemoStore';

export const DEMO_UPGRADE_NOTICE_KEY = 'russicaptor.offline-demo.upgrade-notice.v1';
const acknowledged = '{"schemaVersion":1,"policy":"LEGACY_COUNTER_NOT_MIGRATED","acknowledged":true}';
export type DemoUpgradeState = 'CLEAR' | 'LEGACY_PRESENT' | 'LEGACY_UNRECOGNIZED' | 'UNAVAILABLE';
/** Presence detects retained legacy data, not an installation timestamp or an account identity. */
export class DemoUpgradeNotice {
  constructor(private readonly storage: DemoStorage) {}
  inspect(): DemoUpgradeState {
    try {
      const marker = this.storage.getItemSync(DEMO_UPGRADE_NOTICE_KEY);
      if (marker === acknowledged) return 'CLEAR';
      if (marker !== null) return 'UNAVAILABLE';
      const raw = this.storage.getItemSync(DEMO_STORAGE_KEY);
      if (raw === null) return 'CLEAR';
      if (raw.length > 1024) return 'LEGACY_UNRECOGNIZED';
      try { return validDemoSnapshot(JSON.parse(raw)) ? 'LEGACY_PRESENT' : 'LEGACY_UNRECOGNIZED'; }
      catch { return 'LEGACY_UNRECOGNIZED'; }
    } catch { return 'UNAVAILABLE'; }
  }
  acknowledge(): DemoUpgradeState {
    const state = this.inspect();
    if (state === 'CLEAR' || state === 'UNAVAILABLE') return state;
    // Only the notice marker is written. Neither legacy nor current runtime is migrated/deleted.
    try { this.storage.setItemSync(DEMO_UPGRADE_NOTICE_KEY, acknowledged); } catch { /* reconcile a possible lost acknowledgement */ }
    try { return this.storage.getItemSync(DEMO_UPGRADE_NOTICE_KEY) === acknowledged ? 'CLEAR' : 'UNAVAILABLE'; }
    catch { return 'UNAVAILABLE'; }
  }
}
