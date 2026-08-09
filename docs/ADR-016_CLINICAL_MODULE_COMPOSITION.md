# ADR-016 — Clinical Module Composition

**Status:** Proposed  
**Date:** 2026-08-09  
**Architecture baseline:** Architecture v0.7 (`architecture-v0.7`)  
**Related decisions:** ADR-014 — Canonical Exercise Definition; ADR-015 — Exercise Package Architecture

## Context

Architecture v0.7 establishes one immutable active `ExercisePackage`, one
canonical `ExerciseDefinition`, deterministic Runtime and Replay, and read-only
Debrief and Analytics consumers.

An Exercise Package currently selects PatientProcesses, Analytics providers and
Metric providers directly. This is sufficient for standalone exercises but does
not provide a canonical way to reuse a larger clinical behavior set across
Botulism, MASCAL, Trauma and future exercises.

For example, a Botulism exercise may require the reusable behavior represented by
ALS, Airway Management, Respiratory Failure, Mechanical Ventilation and Medication
Core. Activating several Exercise Packages is not an acceptable solution because
it would create ambiguous Package and Definition authority, provenance, hashing,
provider origin and replay identity.

## Decision

An Exercise Package remains the only active package.

Reusable clinical functionality is described by immutable, explicitly versioned
Clinical Modules. The Package's canonical Exercise Definition declares exact
module dependencies. A deterministic `ClinicalModuleComposer` resolves and
validates those dependencies and produces one canonical composed Exercise
Definition before Runtime initialization.

Clinical Modules never execute independently. Runtime does not discover or load
modules and remains unaware that composition occurred. It receives exactly one
canonical Exercise Definition through the existing Package Loader flow.

```text
Exercise Package
        ↓
exact Module Dependency List
        ↓
ClinicalModuleComposer
        ↓
one Canonical Exercise Definition
        ↓
existing ExercisePackageLoader
        ↓
Runtime
```

This is an extension of the frozen Package and Definition configuration points,
not a new Runtime layer.

## Clinical Module contract

A Clinical Module is an immutable and versioned description of reusable domain
configuration and registrations. It is not an exercise, runtime, package or
independent authority.

A module has at least:

- stable module identifier;
- explicit module version;
- deterministic module hash;
- compatible composition-contract version;
- exact dependencies on other module identifiers and versions;
- immutable contributions;
- provenance metadata needed for validation and read-only presentation.

Floating versions, ranges such as `latest`, and implicit dependency selection are
forbidden.

Clinical Modules may contribute:

- PatientProcess registrations;
- Clinical Effect registrations;
- Intervention definitions;
- Medication definitions;
- Assessment rules;
- Analytics providers;
- Metric providers;
- capabilities;
- optional objectives;
- validation rules.

Module contributions are configuration and registration declarations only. They
must resolve through the existing frozen extension points and canonical owners.
They cannot add a Runtime layer or a new mutation path.

Clinical Modules shall not contain:

- runtime or replay state;
- patient records or patient datasets;
- exercise metadata or active Package information;
- ownership or command authority;
- timelines, audits or Exercise Clock state;
- device, network or wall-clock state;
- mutable caches or executable lifecycle ownership.

## Dependency declaration and versioning

Module dependencies are immutable canonical input to the Exercise Definition.
Every dependency names an exact module identifier and version, for example:

```text
ALS@1
AIRWAY@2
RESPIRATORY_FAILURE@3
MEDICATION_CORE@1
```

The dependency graph must be closed and acyclic. Every transitive dependency must
be resolvable before composition begins. A missing module, incompatible contract
version, duplicate module identifier, conflicting version of the same module or
dependency cycle is fatal validation failure.

Existing Exercise Packages with no module dependency declaration remain valid and
behave exactly as before.

## Deterministic composition

`ClinicalModuleComposer` has only these responsibilities:

1. resolve exact dependencies from immutable input;
2. validate graph closure, versions and compatibility;
3. calculate a stable topological order;
4. validate all contributed registrations and configuration;
5. reject conflicts without mutating source modules or the Package;
6. produce one immutable canonical Exercise Definition.

Ordering is determined by dependency topology and then module identifier and
version as stable tie-breakers. Registration order, Map insertion order, file
order, locale, device and network arrival order are not composition inputs.

The same Package and module set must produce a bit-for-bit identical Definition,
Definition hash, Package hash, provenance projection and validation result.

## Conflict policy

Composition does not silently choose a winner. The following are fatal:

- duplicate module identifiers;
- two requested versions of one module identifier;
- missing or cyclic dependencies;
- duplicate PatientProcess registration IDs;
- duplicate Clinical Effect, Intervention or Medication definition IDs;
- duplicate Assessment Rule, Analytics Provider or Metric Provider IDs;
- incompatible composition-contract versions;
- incompatible configuration contributions;
- a capability or objective collision rejected by its existing validator.

Capability and objective deduplication is allowed only when the relevant canonical
validator defines exact semantic equality. Otherwise the collision is fatal. No
priority-, import-order- or last-writer-wins conflict resolution is introduced.

## Hashing and provenance

The existing Definition and Package hash algorithms and their authority remain
unchanged. There is no independent runtime module hash or second replay hash.

Each module's identity, exact version, hash and canonical contributions are part
of the composed Exercise Definition input. Therefore a change to module
dependencies or module content changes the resulting Definition hash and, through
the existing Package hashing contract, the Package hash value. “Package hash
remains unchanged” means the canonical hashing mechanism is not replaced or
bypassed; it does not mean that different module content may retain the same hash
value.

Runtime and Replay continue to identify one Package and one Definition. Module
provenance is immutable configuration provenance, not runtime state.

## Runtime, Replay and ownership

Runtime receives only the composed canonical Exercise Definition through the
existing `ExercisePackageLoader`. Runtime shall not:

- query a module registry;
- resolve dependencies;
- activate or deactivate modules;
- branch on module-loading state;
- retain mutable module objects;
- calculate an additional module or composition hash.

No Runtime, Replay, Timeline, Debrief, Analytics Framework, Core Metrics, command,
clock, synchronization or mutation contract changes under this decision.

## Read-only projections

Without changing their ownership, downstream views may expose composition
provenance:

- Exercise Catalog: required modules, exact versions, module hashes and
  compatibility;
- Debrief: Package, composed modules and Definition version used by the exercise;
- Analytics: composed module provenance and provider provenance already associated
  with the Package/Definition.

These are read-only projections of canonical configuration. They do not resolve,
compose, activate or mutate modules.

## Future module categories

The composition contract may later classify modules as Clinical, Operational,
Communication, Infrastructure, Resource or Simulation. A category is metadata and
validation input, not permission to create another Runtime or authority layer.

## Migration and compatibility

- Existing Packages without modules remain valid and retain current behavior.
- Existing Package and Definition bindings remain authoritative.
- Existing replay data is not migrated or reinterpreted.
- Module composition is optional until a Package declares module dependencies.
- No current Package hash, Definition hash or Golden expectation is changed by
  accepting this ADR alone.

## Out of scope

ADR-016 does not introduce:

- implementation of `ClinicalModuleComposer`;
- a Module Registry, Repository, download service or marketplace;
- dynamic Runtime loading or hot module replacement;
- Package or Exercise authoring;
- Package import/export;
- new clinical behavior;
- changes to Runtime, Replay, Timeline, Debrief, Analytics or Core Metrics.

Implementation requires a separate, bounded work package after this ADR is
accepted. That work package must use existing Architecture v0.7 extension points
and preserve all current regression and performance contracts.

## Consequences

### Benefits

- one authoritative active Exercise Package and Exercise Definition;
- deterministic reuse of clinical configuration and registrations;
- unambiguous Package, Definition, provider and replay provenance;
- reusable clinical building blocks for Botulism, MASCAL, Trauma and future
  exercises;
- future Exercise Authoring can assemble validated modules without introducing
  multiple active Packages.

### Trade-offs

- one mandatory pre-Runtime composition step for module-enabled Packages;
- dependency and compatibility validation becomes part of Package validation;
- module producers must maintain explicit versions and stable identifiers;
- conflicts fail Package validation instead of being resolved automatically.

## Architecture v0.7 compliance

ADR-016 preserves:

- the single active Exercise Package required by ADR-015;
- the single canonical Exercise Definition required by ADR-014;
- the frozen Runtime layer order and mutation ownership;
- deterministic Replay and canonical hashing;
- read-only Debrief, Analytics and presentation boundaries;
- Package Loader authority.

It introduces no new Runtime, canonical mutable owner or upward dependency.

## Acceptance criteria

ADR-016 may move from **Proposed** to **Accepted** when the architectural review
confirms that this contract:

- preserves one active Exercise Package and one canonical Exercise Definition;
- enables exact-version reuse of ALS, Airway, Respiratory Failure and future
  clinical logic;
- keeps Runtime unaware of composition details;
- defines deterministic graph resolution, ordering, conflict rejection and
  provenance;
- preserves replay determinism and Architecture v0.7 guarantees;
- has no unresolved contradiction with ADR-014 or ADR-015.

Acceptance of the ADR authorizes a later implementation work package within this
contract. It does not itself authorize Runtime changes or dynamic module loading.
