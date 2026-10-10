/** Match the Runtime RPC's active-lease semantics; expired rows are historical. */
export function isActiveRuntimeWriterLease(
  lease: Readonly<{ expires_at: string; released_at: string | null }>,
  nowMs = Date.now(),
): boolean {
  if (lease.released_at) return false;
  const expiresMs = Date.parse(lease.expires_at);
  // Malformed server data must not make revocation permissive.
  return !Number.isFinite(expiresMs) || expiresMs > nowMs;
}
