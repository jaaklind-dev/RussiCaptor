let transactionDepth = 0;
const pendingNotifications = new Map<string, () => void>();

export function publishDerivedSnapshotNotification(key: string, notify: () => void): void {
  if (transactionDepth > 0) pendingNotifications.set(key, notify);
  else notify();
}

/** Subscribers are notified only after all canonical derived stores are replaced. */
export function runRuntimeDerivedSnapshotTransaction(action: () => void): void {
  transactionDepth += 1;
  let failed = false;
  try { action(); }
  catch (error) { failed = true; throw error; }
  finally {
    transactionDepth -= 1;
    if (transactionDepth === 0) {
      if (failed) pendingNotifications.clear();
      else {
        const notifications = [...pendingNotifications.values()];
        pendingNotifications.clear();
        notifications.forEach(notify => notify());
      }
    }
  }
}
