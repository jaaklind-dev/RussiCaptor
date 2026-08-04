# WP-30 — Exercise Catalog (MVP)

## Status

Implemented against the frozen Architecture v0.7 extension points. WP-30 adds no
runtime layer, canonical package model, registry, or new dependency direction and
therefore does not require an ADR.

## Catalog architecture

```text
ExercisePackageRegistry (single source of truth)
        ↓ read-only packages
ExerciseCatalogSelectors
        ↓ deterministic projection
Exercise Catalog UI
        ↓ explicit selection
ActiveExercisePackageService (local preference only)
```

The Catalog reads `ExercisePackageRegistry.packages` directly. Search, profile,
compatibility, tag filtering, and alphabetical sorting produce presentation-only
arrays. Package objects are never copied into another registry, cached as a
catalog database, or mutated.

Package Detail renders the selected immutable `ExercisePackage`, its embedded
`ExerciseDefinition`, manifest hashes, objectives, capabilities, process and
provider selections, compatibility, and provenance metadata.

## Registry usage

`ExercisePackageRegistry` remains the only catalog data source. Registration and
validation continue through the existing Package framework. WP-30 introduces no
parallel catalog model and does not change Package or Definition hashes.

The existing runtime flow is unchanged:

```text
ExercisePackage
        ↓
ExercisePackageLoader
        ↓
ExerciseDefinition
        ↓
Runtime
```

## Active package policy

`ActiveExercisePackageService` stores one package identity (`packageId@version`)
in device-local storage. It resolves that identity back through the canonical
Registry on every load. Unknown or stale persisted identities are ignored.

Activation is explicit and:

- requires an existing Registry package;
- replaces the prior local selection atomically;
- persists only package identity, never package contents;
- publishes a change notification;
- emits a deterministic `ActiveExercisePackageSelected` audit entry;
- is idempotent when the same package is selected again;
- does not bind a package to an exercise;
- does not start, reset, or mutate Runtime.

The active Catalog package is a preference for future exercise setup. An exercise
already retains the Package associated with that exercise through the canonical
Package Loader binding.

## User interface

Route: `/excon/catalog`

The responsive screen contains:

- client-side search over name, description, author, organization, and tags;
- profile, compatibility, and tag filters;
- deterministic alphabetical list ordering with package version tie-breaking;
- current active-package badge;
- read-only Package Detail;
- explicit activation action disabled for the active or incompatible package.

Wide screens show list and detail side by side. Android phones stack the same
sections vertically. ExCon navigation exposes the Catalog without changing the
existing Dashboard.

## Architecture v0.7 compliance

- no new canonical model or Package Registry;
- no Package or Definition mutation;
- no Runtime, Replay, Timeline, Debrief, or Analytics change;
- no upward dependency into Runtime;
- UI contains presentation state only;
- Package and Definition hashes remain canonical;
- activation uses a published extension point and does not alter exercise
  ownership.

## Verification

Automated coverage includes deterministic sorting, search, all filter classes,
tag discovery, active selection persistence, single-active enforcement,
idempotent audit behavior, unknown-package rejection, Registry integration,
Runtime non-mutation, and a 100-entry presentation performance check.

Required release checks:

- TypeScript;
- ESLint;
- `git diff --check`;
- full Jest suite;
- Golden Replay;
- Runtime Hardening;
- Analytics hash stability;
- fixed Package and Definition hashes;
- Android emulator, physical Android, and desktop responsive verification;
- GitHub Actions Node 20/22/24/26 after push.
