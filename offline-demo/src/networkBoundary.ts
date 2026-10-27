function blocked(): never { throw new Error('OFFLINE_DEMO_NETWORK_FORBIDDEN'); }
/** Install before Expo registration or application imports. No automatic fallback. */
export function installOfflineNetworkBoundary(target: object): void {
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    const prior = Object.getOwnPropertyDescriptor(target, name);
    if (prior && !prior.configurable) {
      if (prior.value !== blocked) throw new Error('OFFLINE_DEMO_NETWORK_BOUNDARY_UNAVAILABLE');
      continue;
    }
    Object.defineProperty(target, name, { value: blocked, writable: false, configurable: false });
  }
}
