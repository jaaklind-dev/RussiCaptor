# Package projection/checkpoint divergence recovery

## Authority model

For an active exercise, `exercise_states.state` is the bounded discovery/UI
projection. It is not a second Runtime authority. A validated
`runtime_checkpoints.payload` envelope owns active Runtime continuity,
including the package reference carried by its canonical payload. The writer
lease owns permission to publish the next checkpoint; checkpoint revision and
CAS order durable Runtime mutations. Session version and lifecycle remain
canonical exercise state inside the checkpoint once one exists.

The root checkpoint `payloadHash` covers the entire canonical shared payload,
including `exercisePackageReference`. `provenanceHash` separately covers the
sorted Runtime-artifact provenance collection. Every Runtime artifact also has
its own canonical payload hash. Package identity is therefore root-hash
covered, while provenance gives an additional binding for the materialized
Runtime definitions.

Two active states for the same exercise, session version and lifecycle but
different package IDs or versions are never legitimate. Normal package
selection happens before the Runtime becomes active.

## Proven incident

For `EX-1788632289453-1`, the durable checkpoint was published at revision 18
with `russicaptor.clinical-sanity-reference@1.0.1`. The final checkpoint write
was recorded at 2026-09-05 18:56:47 UTC. The projection row was subsequently
written at 2026-09-05 19:20:28 UTC with the same session version and lifecycle,
but `russicaptor.botulism-johvi@2.0.0` and a later clock-only simulation time.
The actor was the scoped rehearsal EXCON identity. There was no active writer
lease and no package import after clinical-sanity 1.0.1 activation.

The only application production path that writes this active projection is
`CloudSyncService.publishCloudProjection()`. Its candidate was built from the
locally installed package registry by `createSharedExerciseProjection()`, and
the previous authorization gate checked only EXCON scope. It did not bind the
candidate package identity to either the last discovered active projection or
the validated local checkpoint. A stale/default local Botulism package could
therefore be combined with restored exercise-session identity and published as
a routine whole-projection update. The unchanged command/version plus advanced
simulation time in the affected row is the fingerprint of that path. The
database did not retain earlier projection-row versions, so the evidence proves
the decisive surviving write and its path, not an unrecorded first occurrence.

## Prevention

The client now rejects a projection candidate whose package identity differs
from the discovered active projection or same-exercise validated checkpoint.
The database independently rejects package identity changes while the prior
projection is RUNNING or PAUSED. This preserves new-exercise creation and
normal lifecycle writes while closing the stale package publication path.

## Supported recovery

Recovery uses safe terminalization rather than projection reconstruction. The
server cannot independently reproduce the client canonical JSON algorithm, so
it does not claim the checkpoint as a reconstruction source. The authenticated
client first performs the complete cooperative checkpoint validator (root hash,
Runtime-artifact hashes, provenance, exercise binding and active Runtime
coverage). The RPC then locks projection, checkpoint and lease rows and
rechecks the exact projection revision, checkpoint revision, hashes,
exercise/session/lifecycle, both package identities and absence of an active
lease. A race or ambiguity fails closed.

Successful recovery changes only the projection lifecycle to a recovery-marked
terminal state, preserves the durable checkpoint as evidence, releases any
expired unreleased lease row and writes `exercise_runtime_recovery_audit`.
Repeated invocation is non-mutating and returns `ALREADY_TERMINAL`.

The RPC is available only to authenticated users with
`EXERCISE_RUNTIME_RECOVERY` for the target exercise. PUBLIC and anonymous
execution are revoked; the definer function uses an empty fixed search path.
