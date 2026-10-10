# Exercise-state publication provenance and writer handoff

The 2026-10-10 historical `exercise_states` PAUSED/revision-24 incident was
written by the CloudSync projection publication path. Two successful POSTs
around 17:45:27–17:45:28 UTC were authenticated as the controlled account.
Retained server logs do not identify which client callback scheduled the
publication. `HISTORICAL_TRIGGER_SUBTYPE_UNRECOVERABLE` is the bounded result;
AppState foreground, a local-state notification, and another scheduling wake
cannot be distinguished retrospectively. The prior client neither retained
publication-intent provenance nor fenced a changed writer lease identity at
the final send boundary.

Only a local mutation or explicit terminal reconciliation creates an intent.
Foreground resume, Realtime reconnect, and background flush can wake an
existing intent but cannot create one. Each intent records its origin, local
creation time, exercise ID, lifecycle candidate, auth/cloud/reader/writer
generations, the reader-convergence version as an exercise-binding fence,
writer lease identity for local comparison, sync freshness, and
publication generation. A fixed-field diagnostic records intent ID, origin,
wake reason, send count, accepted/rejected result, bounded reason code, and
HTTP status. Diagnostic serialization omits the lease ID itself as well as
tokens, passwords, Authorization headers, patient data, and projection payloads.
The diagnostic ring is bounded; device logs retain the same safe event.

Queue-time eligibility is advisory. Following asynchronous auth lookup and
immediately before the mutation is initiated, the client rechecks the exact
exercise, auth, runtime, reader, writer-lease, publication, and sync
generations, plus the completion fence. A lease change increments the writer
generation even if both old and new states are labeled WRITER. The old queued
intent is dropped without a POST; the new writer may create a new intent.
Hydration, route mount, and workbench open remain read-only.

This is a client-side fence for authority changes observed by the client. An
unobserved remote takeover still depends on the server-side authorization
model; this note does not claim that a client can detect an unseen remote
lease change without an atomic server check. The completed APK-165 physical
ChestXR and cleanup evidence is retained; this change does not reopen the
completed exercise.
