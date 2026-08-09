# WP-31 — Clinical Module Composition Foundation

## Status

Implemented in compliance with
[`ADR-016`](./ADR-016_CLINICAL_MODULE_COMPOSITION.md) and the frozen Architecture
v0.7 baseline. WP-31 adds composition infrastructure only. It ships no ALS,
Airway, Botulism, Trauma or other production Clinical Module.

## Architecture

```text
one immutable Exercise Package
        ↓ requiredClinicalModules (exact versions)
static ClinicalModuleRegistry
        ↓
ClinicalDependencyResolver
        ↓ dependency-first stable order
ClinicalConflictValidator
        ↓ fatal conflicts only
ClinicalModuleComposer
        ↓
one immutable canonical Exercise Definition + provenance
        ↓
existing ExercisePackageLoader
        ↓
Runtime
```

Runtime imports no Clinical Module service, registry, resolver or composer. Module
composition occurs in the existing Package configuration boundary before
Definition publication. Runtime continues to receive one Package and one
canonical Exercise Definition.

## Immutable contracts

The foundation introduces:

- `ClinicalModuleDependency`: exact `moduleId` and version;
- `ClinicalModuleManifest`: identity, description, dependencies and composition
  compatibility version;
- `ClinicalModule`: immutable manifest, deterministic module hash and immutable
  registrations;
- `ClinicalModuleRegistrations`: declarative registration IDs and optional
  objectives;
- `ClinicalModuleProvenance`: module identity, version, hash and composition
  order;
- `ClinicalModuleComposition`: canonical provenance and merged registrations;
- typed immutable composition diagnostics.

Modules contain no Runtime, Replay, patient, clock, timeline, Package activation,
ownership or wall-clock state.

## Static registry

`ClinicalModuleRegistry` provides deterministic static registration and exact
lookup. It validates:

- manifest identity and explicit version;
- description and dependency shape;
- dependency uniqueness;
- composition compatibility version;
- deterministic module hash;
- unique `moduleId@version` registration.

The registry permits several explicit versions of one module to exist, but one
composition cannot resolve two versions of the same module ID. There is no
download, dynamic loading or implicit upgrade path. The production registry is
empty after WP-31.

## Dependency resolution

`ClinicalDependencyResolver` resolves the closed transitive graph by exact
versions. It rejects missing dependencies, unavailable versions, duplicate root
declarations, version conflicts and cycles.

The stable topological order is dependency-first. Ready nodes use module identity
as deterministic tie-breaker. File order, registry insertion order, Map order,
locale, device and network timing cannot change the result.

## Conflict validation

`ClinicalConflictValidator` rejects duplicate registrations without selecting a
winner. Fatal groups include:

- PatientProcesses;
- Clinical Effects;
- Interventions;
- Medications;
- Assessment Rules;
- Analytics Providers;
- Metric Providers;
- Capabilities;
- Objectives;
- validation rules.

Conflicts with the base Exercise Definition are also fatal. There is no priority,
last-writer-wins or import-order behavior.

## Composition and provenance

`ClinicalModuleComposer` returns either:

- one deeply immutable canonical Exercise Definition, composition provenance and
  INFO diagnostics; or
- immutable ERROR diagnostics with no partial Definition.

The composed Definition records exact module IDs, versions, hashes and zero-based
composition order. Registrations are canonicalized before publication.

## Package integration and hashing

`ExercisePackage.requiredClinicalModules` is optional. A Package without it follows
the previous code path unchanged.

For a module-enabled Package, `ExercisePackageLoader`:

1. validates the immutable input Package;
2. composes its declared exact dependencies;
3. validates the canonical composed Definition;
4. creates a canonical Package with the existing hashing mechanism;
5. publishes one Package and one Definition through the existing registries.

Module dependency order is canonicalized. Module identities, versions, hashes and
contributions affect the composed Definition hash and therefore the canonical
Package hash. No independent runtime module hash or replay hash is introduced.

All six existing Packages declare no modules. Their fixed Package and Definition
hashes remain unchanged.

## Read-only presentation

Existing Package and Definition information cards now display required and
composed module provenance. Because the same cards are used by Catalog, Dashboard
and Debrief, provenance is visible without redesigning Debrief or adding a new
state owner. Packages without modules display `None`.

Analytics remains a Debrief consumer and has no dependency on the composer. The
Analytics hash is unchanged by isolated composition.

## Architecture v0.7 compliance

- one active Exercise Package;
- one canonical Exercise Definition;
- Package Loader remains the binding authority;
- no Runtime, Replay, Timeline, clock, synchronization or mutation changes;
- no Debrief or Analytics framework redesign;
- no dynamic loading;
- no new Runtime layer or upward dependency;
- no production Clinical Modules.

The source dependency-cycle regression test remains green.

## Verification

Dedicated tests cover:

- registry validation, lookup, uniqueness and deterministic ordering;
- immutable order-independent module hashing;
- dependency-first graph ordering;
- missing dependencies and version mismatches;
- duplicate and conflicting module declarations;
- cycle detection;
- all required registration conflict classes;
- immutable composition and provenance;
- Package → Composer → Definition integration;
- unchanged legacy Package/Definition hashes and Runtime-facing selection;
- unchanged Analytics hash;
- 100 modules and approximately 1,000 dependency edges within the configuration
  performance budget.

Release verification must keep TypeScript, ESLint, `git diff --check`, all Jest
tests, Golden Replay, Runtime Hardening, Analytics hash stability and the GitHub
Node 20/22/24/26 matrix green. Android emulator and physical Android must continue
to load the exercise, Package, Definition, Catalog and Debrief with unchanged
Runtime behavior.
