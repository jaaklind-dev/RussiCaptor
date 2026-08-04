# WP-27 — Exercise Definition Framework

## Outcome

WP-27 introduces one immutable, versioned source of truth describing what an
exercise is. It exists before runtime and is separate from the mutable exercise
session. Runtime, ExCon, Debrief and Analytics consume the definition without
mutating it.

## Canonical model

`ExerciseDefinition` contains the exercise type and version, profile, descriptive
objectives, feature capabilities, enabled PatientProcess modules, Analytics
providers and Metric providers. Profiles, capabilities and objectives are typed.
Definitions contain no lifecycle, clock, patient, allocation or other runtime
state.

```text
ExerciseDefinition (immutable, versioned)
       ├── Scenario Runtime configuration
       ├── ExCon Exercise Information projection
       ├── Debrief Exercise Information projection
       └── Analytics/Metric provider selection
```

The definition is intentionally not embedded into the existing hashed Runtime or
Debrief artifacts. This preserves all existing replay and Analytics hashes.
Historical sessions retain their bound definition type and version; changing a
definition creates a new version rather than mutating an old object.

## Validation and registry

`ExerciseDefinitionValidator` rejects invalid versions and IDs, duplicate values,
unknown profiles, capabilities, PatientProcesses and providers, and malformed
objectives. It has no runtime dependency.

`ExerciseDefinitionRegistry` validates at registration, rejects duplicate
`exerciseTypeId@definitionVersion` keys and exposes deterministic type/version
ordering. Registered definitions and their nested values are deeply frozen.

No network or dynamic module loading is used. Provider and PatientProcess names
must belong to the static application catalog.

## Integrations

- The authoritative exercise runtime receives and retains the immutable bound
  definition when it is initialized.
- Analytics enables the providers and metric-provider outputs selected by the
  definition. When the canonical definition enables the complete registry, the
  previous Analytics configuration shape is retained so the hash is unchanged.
- ExCon Dashboard and Debrief render the same read-only Exercise Information card.
- Workbook-installed exercises are explicitly bound to the current canonical
  definition; future import formats can select another already registered
  definition version after validation.

## Explicit non-goals

There is no editor, runtime definition mutation, downloading, scoring, KPI
threshold, permission model, protocol policy or report-template behavior in
WP-27.

## Verification

Automated coverage includes validation, duplicate detection, version lookup,
immutability, deterministic ordering and hashing, Runtime module lookup,
read-only Analytics integration, and a 100-definition performance check.

Manual verification targets both Android emulator and physical Android and checks
profile, objectives, capabilities, enabled modules, definition version and both
provider lists.
