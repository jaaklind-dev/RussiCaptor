# WP-45A generic exercise package import contract

The module-package importer keeps the existing manifest contract and the two allowed runtime sheet classes: `RUNTIME_CONFIG` and `EXERCISE_DATA`. A generic clinical exercise is identified by an `ExercisePackage` sheet in its single `EXERCISE_INSTANCE` module.

## Generic exercise sheets

| Sheet | Class | Required columns | Ownership |
| --- | --- | --- | --- |
| `ExercisePackage` | `EXERCISE_DATA` | `PackageID`, `PackageVersion`, `ContentHash`, `PackageJSON` | Exercise module |
| `PackagePatientDataset` | `EXERCISE_DATA` | `DatasetID`, `DatasetVersion`, `DatasetJSON` | Exercise module |
| `PatientRuntimeFixtures` | `RUNTIME_CONFIG` or `EXERCISE_DATA` | `PatientID`, `RuntimeFixtureJSON` | Dataset/exercise module |
| `PatientProcessBindings` | `RUNTIME_CONFIG` | `BindingID`, `PatientID`, `ProcessType`, `ProviderModuleID`, `ProviderVersion` | Declared provider module |
| `CanonicalActionBindings` | `RUNTIME_CONFIG` | `ActionID`, `DefinitionID`, `ProviderModuleID`, `ProviderVersion`, `Scope`, `PatientID`, `ProcessType`, `OwnerModuleID` | Declared provider module |
| `PackageLocations` | `EXERCISE_DATA` | `LocationID`, `Code`, `Name` | Exercise module |
| `RelationshipBindings` | `EXERCISE_DATA` | `RelationshipID`, `SourcePatientID`, `TargetPatientID`, `RelationshipType` | Exercise module; optional rows |

`PackageJSON` is the immutable canonical `ExercisePackage`, including its calculated package hash. `DatasetJSON` is a separate versioned `PackagePatientDataset`. Each patient record declares `initialLocationId`; the ID and the patient-facing location name must both resolve through `PackageLocations`.

Runtime fixtures are attached by patient ID without embedding package-specific process names in importer code. `PatientProcessBindings` must resolve to a repository Runtime process or an exact registered clinical-module process. Canonical actions similarly resolve either to an exact clinical-module registration or a repository intervention definition. Legacy `InterventionOptions.Type` values do not participate in this contract.

## Validation and publication

Generic validation runs first. Package-specific validators are selected through `PackageSpecificValidatorRegistry`; the Botulism validator owns its historical `PT-012`, process-count and respiratory-trigger requirements.

The existing manifest dependency, ownership, duplicate, deprecation, staging and rollback rules remain authoritative. Source workbook hashes remain raw-byte SHA-256 values. Identical package/dataset identity and content is idempotent; the same identity with different content is rejected.

