# WP-NARVA-10B0 IRO package immutability resolution

## Decision

The immutable identity drift is confirmed. The original capability-incomplete
`russicaptor.narva-iro-evacuation@1.0.0` package and
`patients.narva-iro-evacuation.v1` dataset are restored exactly from commit
`bf0d76e3c799ea1165b832554109d0685a6bab95`. The clinically complete content
previously shipped under the same package version is retained without clinical or
physiology changes and published as `russicaptor.narva-iro-evacuation@1.0.1` with
`patients.narva-iro-evacuation.v2`.

The current definition has `definitionVersion: 2`. This is an immutable identity
change required so that the registry can retain the historical definition and the
clinically complete definition simultaneously; it does not alter clinical behavior.

## Provenance

The original package, dataset and fixture were introduced by `bf0d76e` in:

- `src/services/exercise/NarvaExercisePackages.ts`;
- `src/services/exercise/NarvaPatientDatasets.ts`;
- `src/services/exercise/CanonicalPatientDatasets.ts`;
- `src/services/exercise/ExercisePackageService.ts`.

Commit `f0da064bdfd685f011a027d46136cd38d5f33d24` materially expanded the
package under the unchanged `1.0.0` identity. It added the complete treatment
palette, active-treatment bootstrap, IRO scenario state and readiness metadata.
Later accepted Runtime work added the package-bound vasopressor and ventilation
fault paths, HOLD/RESUME evidence, cause-gated PEA/ROSC and post-ROSC behavior.
Those capabilities remain in `1.0.1`.

Commit `ad46389837a5f63d5bcd55594cca0c180a424acd` first recorded
`cc3bfde4a9723a8328aed726df08823590da82f7e8e25a5a5cf853ac1c4854e5`
as an “IRO reference hash”. Repository history contains no package artifact or
canonical hash computation that produces that value. It is neither the raw source
package hash nor the composed registry package hash and is superseded by the
canonical values below.

## Frozen identities and hashes

Canonical package hashing uses `packageHashInput` → `stableJson` → `sha256Text`
in `src/services/exercise/ExercisePackageHash.ts`. Definition hashing uses
`hashExerciseDefinition` in `src/services/exercise/ExerciseDefinitionRegistry.ts`.
The app catalog and exact-version registry expose the module-composed package, so
the composed hashes are the operational freeze values. Raw source-package hashes
are also frozen to make composition provenance explicit.

### Historical 1.0.0 / dataset v1

- raw package hash: `c8838293554026a107e1bbcff6e54d8891fe9f753f88dd115bce2c986073ac78`;
- raw definition hash: `d4ab35758766e91816600315086003d517f0b4a866051d82dd1818e34790530a`;
- composed package hash: `8ab413dad6025b2b60d8a5acefc879cd972fbdc4b5bdec879b811db9f788e1f8`;
- composed definition hash: `f1b145cd0750f659354aaa6558cacdca8486bd483114c0231618de064a19d86a`;
- dataset hash: `20a51862ed3df9d37437c227447d10a0e0d16e9ca131e0af3ebe421e1014a87c`.

### Clinically complete 1.0.1 / dataset v2

- raw package hash: `31d8267f61a62ccc3423d4ef15ac8f1f566d4603ab4ae0d55c7f21e7126b5cc4`;
- raw definition hash: `587b1b041131af126af2019550a0c3fcc3be70807d71b7c812d9d097d924b770`;
- composed package hash: `da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95`;
- composed definition hash: `6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0`;
- dataset hash: `8f6f105025fc273d35cfbd870ae0dd96d6d8981543c1f4824f3da41dd3eee39c`.

## Semantic compatibility

After replacing only the new package, dataset, fixture and definition identity
fields with their v72 values, the `1.0.1` source package reproduces the v72 raw
package hash `cc3bf334088f4790032ab602d506686adf4bcc7618081f73e36fcc61146b179c`,
and dataset v2 reproduces the v72 dataset hash
`7eea5ca9c008a673b2e04091c74c97653e635324203e73910ed2aafee35274c4`.
This proves that the version correction changes identity only. The 70 kg patient,
baseline observations, active ventilation and infusions, treatment palette,
resources, fault configuration, HOLD/RESUME, PEA/ROSC and post-ROSC behavior are
unchanged from the v72 clinically complete package.

Exact-version lookup resolves both immutable versions. Historical references to
`1.0.0` and dataset v1 remain deterministic; new rehearsal work must request
`1.0.1` and dataset v2 explicitly.
