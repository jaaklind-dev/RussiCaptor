# Runtime native lease heartbeat

Android release builds demonstrated that foreground JavaScript timers can pause for longer than the 60-second Runtime writer lease. The native heartbeat is therefore a process-level Android scheduler that invokes the existing authenticated `renew_runtime_writer` RPC every 20 seconds. It is transport only: the database function remains the sole authority for user identity, writer instance, lease validity, release state and expiry.

## Contract

The RPC accepts the immutable lease ID and writer instance ID plus the existing 60-second lease duration. Its `auth.uid()` check, writer-instance check, released/expired check and row lock remain unchanged. The heartbeat additionally holds the exercise ID and a local heartbeat generation only to bind its own lifecycle; neither is a new server authority field.

The native bridge receives a current Supabase access token in process memory after JS has acquired and confirmed the server lease. It also receives the existing public project URL/key. It never stores tokens, uses a service-role key, writes tables directly, or logs identifiers/tokens. A refreshed JS session replaces the in-memory token. No valid session means no native start.

## Lifecycle and failure policy

- One native controller is created only for a confirmed current writer lease.
- Repeating the same start is idempotent; a newer local heartbeat generation stops the older scheduler.
- A 20-second cadence preserves the existing renewal policy. The 60-second lease retains at least one normal renewal opportunity before expiry; one temporary transport retry is bounded to five seconds.
- Server rejection (`STALE_WRITER`, authorization denial, expired/not-writer) stops the heartbeat. Native diagnostic state never grants local writer authority; JS reconciles/demotes when it runs.
- The current product policy deliberately relinquishes the writer on app background. That stop also stops the native heartbeat before releasing the server lease.
- Process death ends the scheduler and lets the server lease expire normally. There is no boot receiver, persistent service or foreground service.
- Android uses native renewal as the sole periodic scheduler. JS retains acquisition, publication, reconciliation and non-Android renewal behavior; it does not run a competing Android interval.

## Diagnostics

Validation builds retain the bounded JS trace and add native `NATIVE_HEARTBEAT_*` / `NATIVE_RENEW_RPC_*` events. Native logs contain only a local heartbeat generation label, result category and latency—never bearer tokens, lease IDs, writer IDs, exercise IDs or payloads.
