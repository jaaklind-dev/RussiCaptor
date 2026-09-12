# WP-NARVA-01 Narva exercise packages

## Scope and provenance

This original change registered two immutable package identities:

- `russicaptor.narva-trauma@1.0.0` with `patients.narva-trauma.v1`;
- `russicaptor.narva-iro-evacuation@1.0.0` with `patients.narva-iro-evacuation.v1`.

The IRO identity above is retained as the exact historical, capability-incomplete
artifact introduced by `bf0d76e`. The later clinically complete IRO content is
published separately as `russicaptor.narva-iro-evacuation@1.0.1` with
`patients.narva-iro-evacuation.v2`; see `WP_NARVA_10B0_IRO_PACKAGE_IMMUTABILITY.md`.

The approved `Narva_scenario_input_matrix.docx` and the two referenced source-scenario files were not present in the supplied workspace or attachment set. Values explicitly repeated in the WP-NARVA-01 contract were used. No unavailable Narva-specific value was invented.

## Trauma package

The package contains exactly `PT-PELVIC-001` and `PT-CHEST-001`. Injury time is stored as canonical simulation-relative configuration (`-300` and `-1800` seconds). The pelvic source uses the accepted hemorrhage model at 140 ml/min and binder efficiency 0.6. The chest source uses the accepted pleural model with 1450 ml initial drainage and 200 ml/h persistent bleeding.

The treatment palette contains only registered production treatments. `DEXKETOPROFEN` remains the canonical identity; Dolmen remains its catalog alias. Midazolam is not added. Blood inventory is six RBC, six plasma and zero platelet units; calcium uses the existing canonical replacement configuration. No fibrinogen/Fibryga identity exists and none is emulated.

Resource quantities marked “sufficient” in the task contract use a minimal non-constraining two-patient technical allocation and carry `CONFIGURATION_ASSUMPTION_PENDING_FINAL_LOCAL_COUNT`. Transport has one reanimobile, IVKH at 1800 seconds and PERH at 7200 seconds, with 600-second handover. Return/turnaround values reuse the accepted transport-reference mechanics because no authoritative matrix files were available.

The package does not force transport order. Existing timeline, treatment, ownership and transport evidence remains the assessment source.

### Known trauma capability gap

The fixtures persist authoritative injury time, but the production `ScenarioEngine` TXA command path explicitly does not consume an authoritative injury-onset timestamp. Therefore TXA three-hour classification cannot yet be claimed to use these package values. This is a missing Runtime capability, not package data that may be approximated.

## IRO package

The supported configuration captures the 70 kg patient baseline, ventilation reference, norepinephrine requirement, remifentanil requirement, two vascular accesses, monitoring and supported equipment. Urinary catheter and optional NGT remain non-digital checklist entries.

The package deliberately carries `not-full-scenario-ready`. The following real capabilities are absent and are not substituted:

- propofol;
- rocuronium / neuromuscular blockade;
- TOF/RASS/BIS state;
- package-bound deterministic vasopressor-interruption state machine;
- package-bound ventilation-fault state machine;
- reversible-cause-gated PEA/ROSC behavior;
- fixture bootstrap of already-active detached ventilation and medication treatments.

Exact fault timing windows were not available without the source scenario and are not invented.

## Architecture and compatibility

No checkpoint, canonical hashing, CAS, lease, heartbeat, Realtime, recovery, completion, shared-workflow or physiology implementation was changed. Existing package hashes are not rewritten. Both new package hashes include their definitions, dependencies, treatment palettes and transport configuration through the existing deterministic package hash contract.
