# WP-NEXT-03 physical validation harness

The normal CM workspace deliberately prevents a non-owner from editing a patient. That is the intended operational safeguard, but it makes three server-side race cases impossible to demonstrate through ordinary two-CM taps alone.

The `SharedWorkflowValidationCard` is compiled only when a signed `upgrade-validation` or `rollback-validation` artifact is built with `RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS=1`. The canonical field-release build rejects that variable and has no card.

The card is not a mock backend. It issues normal authenticated client requests through `apply_shared_workflow_patient_mutation`, retaining command IDs, authenticated actor attribution, ownership checks, idempotency and server CAS. It supports:

- simultaneous physical-client `CLAIM` requests;
- a prepared former-owner proposal submitted after a normal transfer, which must be rejected by ownership/CAS;
- two same-base `MUTABLE` proposals from two physical sessions of the same current CM identity. This isolates CAS stale-version behavior without weakening the distinct-CM ownership rule.

The staged proposal is rolled back locally until the authoritative RPC accepts it. The test marker is a validation-only note payload; it has no clinical effect. A fixture used for this harness is technical evidence only and must not be treated as a clinical exercise record.
