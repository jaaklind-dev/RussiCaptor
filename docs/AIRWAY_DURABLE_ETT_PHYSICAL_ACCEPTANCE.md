# Durable ETT physical acceptance

Deferred until a physical Samsung is available.

1. Create a fresh supported Narva exercise and open a patient with package-authorized ETT.
2. Wait for durable command readiness, then submit one ETT intent.
3. Verify one durable command, one writer materialization, one active canonical ETT, and unchanged ventilation prerequisites.
4. Cold-restart and verify the same ETT without duplicate intervention or evidence.
5. With a second client, submit from the reader and verify writer-only materialization and convergence.

Do not use direct Runtime-owner calls or backend row mutation during this gate.
