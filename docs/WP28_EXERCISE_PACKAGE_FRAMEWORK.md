# WP-28 — Exercise Package Framework

## Outcome

WP-28 establishes the immutable, versioned Exercise Package as RussiCaptor's
canonical exercise deployment unit. A package bundles its Exercise Definition,
patient dataset reference, enabled PatientProcess modules, Analytics and Metric
provider selections, descriptive metadata and compatibility manifest. It contains
configuration only—never runtime, timeline, Debrief, Analytics output or replay
state.

```text
Exercise Package (immutable distribution unit)
        ↓
Exercise Definition (immutable configuration)
        ↓
Authoritative Runtime (mutable execution state)
```

## Package and manifest contract

Every package has a stable package ID, semantic package version, patient dataset
ID, metadata, and an immutable manifest containing the definition hash and
compatibility version. Runtime retains the package and definition as read-only
inputs and never writes either.

The package hash covers the canonical definition, provider/module selections,
patient dataset reference, metadata and manifest. Because a hash cannot include
itself, `manifest.packageHash` is excluded from the hash input; the calculated
value is then stored identically in `package.packageHash` and
`manifest.packageHash`. Runtime, timeline, Debrief, Analytics, replay, wall-clock
and device data are excluded.

## Validation, compatibility and loading

`ExercisePackageValidator` returns typed deterministic diagnostics for identity,
semantic version, manifest linkage, definition and package hashes, static module
and provider availability, duplicate selections, definition/package selection
consistency, and compatibility.

- `SUPPORTED`: current compatibility contract;
- `LEGACY`: older non-negative compatibility contract that remains safe to load;
- `INCOMPATIBLE`: unknown future or invalid compatibility contract and rejected.

`ExercisePackageRegistry` provides deterministic ID/version ordering, exact and
latest-version lookup, and duplicate detection. `ExercisePackageLoader` validates
before publishing, registers the immutable definition when necessary, rejects a
same-version definition conflict, and may bind the definition to an exercise. It
does not execute runtime or download content.

## Integrations

- The authoritative exercise runtime receives the bound immutable package and its
  definition.
- Dashboard and Debrief show a shared read-only Package Information projection.
- Analytics records package ID, version and hash as non-hashed report metadata;
  the canonical Analytics hash calculation is unchanged.
- Package installation binds a package and its definition together.

## Canonical templates

Configuration-only template packages are shipped for ALS, Trauma, MASCAL,
Botulism, Emergency Department and Custom profiles. They use the static WP-27
module/provider catalog and do not contain package-specific runtime branches.

## Explicit non-goals

WP-28 adds no authoring UI, runtime editing, cloud catalogue, dynamic download,
scenario editor, execution changes, scoring or package-specific clinical logic.

## Verification

Tests cover validation, hashing and self-reference, registry ordering and version
resolution, loader and definition binding, compatibility states, immutable
templates, Analytics metadata isolation, and 100-package performance. Existing
Golden, Runtime Hardening, replay and Analytics hash tests remain unchanged.
