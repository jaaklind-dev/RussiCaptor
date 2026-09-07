# WP-NARVA-06 — multi-CM command routing and terminal convergence

## Scope

WP-NARVA-06 separates patient-command submission authority from whole-exercise
checkpoint-writer authority and makes exercise completion a fenced atomic
protocol. It does not change clinical physiology, package configuration,
checkpoint hashing, CAS, lease duration, heartbeat transport, or recovery
authorization.

## Patient command path

An authenticated exercise-scoped CM may submit a mutable clinical command only
for a patient it currently owns. EXCON retains its existing scoped control
permission. `submit_runtime_patient_command` serializes acceptance against the
authoritative patient head, checks its base revision, increments that revision,
records the command and audit entry, and publishes only a payload-light Realtime
notification. A completion fence rejects later commands.

Accepted commands live in `runtime_patient_commands` and have one server-issued
sequence. The one active Runtime writer drains that durable inbox in sequence,
uses existing resource, MTP, and clinical-treatment handlers to materialize the
effect, records the result under its live lease, advances a checkpointed cursor,
and publishes the resulting canonical checkpoint. A writer restart or takeover
can resume from the durable cursor. Existing command IDs remain the effect-level
idempotency key.

The exercise still has exactly one whole-exercise Runtime/checkpoint writer.
Patient owners do not acquire a Runtime writer lease merely to submit a command.

## Completion protocol

`submit_runtime_completion_request` validates the EXCON scope, locks the
exercise, establishes a durable command-sequence fence, and leaves the request
`PENDING`. Commands accepted before the fence are drained. Commands submitted
after it fail closed with `COMPLETION_FENCED`.

The current writer applies the existing canonical completion command and
prepares the terminal checkpoint with lifecycle `COMPLETED`. The
`finalize_runtime_completion` RPC then performs, in one database transaction:

1. live writer/lease validation;
2. terminal generation, checkpoint revision, lifecycle, and fence-cursor checks;
3. terminal checkpoint and payload-light checkpoint notification write;
4. terminal `exercise_states` projection write;
5. completion request acknowledgement;
6. explicit writer-lease release and authority audit.

Database triggers reject ordinary checkpoint publication after the fence,
terminal checkpoint publication outside the finalizer, and lease acquisition or
renewal after completed terminalization. A forward-only projection fence also
rejects stale `exercise_states` writes from the moment completion is requested,
so an old client cannot resurrect `RUNNING` after terminalization. Cloud
projection sync does not issue a separate terminal write while this protocol
owns the projection. The client
reports success only after the completed request is observed. Timeout or
transport failure remains explicit and recoverable; it never fabricates a local
successful completion.

## Compatibility and security

- Existing finite/unlimited inventory, interventions, physiology, and package
  values are unchanged.
- Existing patient ownership and revision-CAS remain authoritative.
- Existing Runtime command handlers retain clinical-effect idempotency.
- Historical checkpoints omit `runtimePatientCommandCursor`; absence means zero
  and therefore does not change historical serialization or hashes.
- Direct writes to the new tables are revoked. Normal authenticated,
  exercise-scoped RPCs are the only mutation path.
- Realtime carries command-sequence/completion metadata, not clinical payloads.

## Physical validation boundary

Automated backend and client validation in this work package does not replace
the later two-device physical A/B/D and terminal-completion gate. No physical
PASS is claimed here.
