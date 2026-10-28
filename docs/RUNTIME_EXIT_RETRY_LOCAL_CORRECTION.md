# Local runtime-exit retry correction

Baseline APK189: `984aaafbafb858300fc9a0b03e22a04515c23f15`.
This later source candidate did not build the installed APK and is not deployed.

Impact classification before release: persistence/authority + mode transition;
runtime, persistence and multi-device guardrail groups; A–C, M–U, X/Y remain
mandatory. No canonical format, SQL, package, roles, native lifecycle or mode
authorization contract changes. Required local release checks apply; physical
mode-transition/publication/recovery remains a separate release gate. No new
APK, production/device access or physical acceptance is part of this work.

The diagnosed conditional defect is a dirty exit publication failing once,
setting sync status FAILED, then a manual retry refusing to publish because
the routine publisher requires WRITER. The first historical physical failure's
trigger remains unknown: its original exception was not retained.

The explicit exit drain can now publish the already prepared checkpoint after
waiting for any in-flight publication, checking the server's active lease and
matching the frozen exercise/lease/writer/sync-generation. It does not clear
the drain fence, restore command authority, acquire a lease, automatically retry,
or select the destination mode. Normal repository CAS and final explicit
release/readback remain mandatory. Failure or changed authority stays blocked.

Up to eight operational in-memory failure entries retain stage, timestamp,
allowlisted code and coarse error kind. No arbitrary message, stack, cause,
identifier, credential or payload is retained. Unknown messages are explicitly
UNCLASSIFIED_ERROR, not a claim to preserve an unavailable root cause. The
entries are exposed through existing operational-state inspection, not a
test-only runtime switch. They do not persist across process death.

Regression executes actual extracted source closures with synthetic platform
and I/O boundaries. It proves the exercised orchestration branches, not an
Android/native/server reproduction of the original incident.

The canonical profile's two exact hashes for the changed Runtime sync source
are updated to the independently inspected source and existing deterministic
transform. No transform code, forbidden-module list, hash strictness, version,
or build/signing configuration changes. The retry regression executes both the
raw source closures and the canonical operational transformed closures. Two old
source-structure selectors follow the new explicit drain parameter signature;
their serialization, coalescing, acknowledgement and retry assertions remain.
