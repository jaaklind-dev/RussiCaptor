# CI baseline alignment after APK188 deployed-source reconciliation

Scope: test/qualification tooling only, based on
`01e50bd8c0be57f4c9b1484268052039831c4d47`. No application source, release
metadata, deployed migration, database control or operational grant is changed.

## Trusted migration inventory, version2

`test/fixtures/writer-authorization/migration-baseline-v2.json` supersedes the
old inline54/55-file assumption and unsafe migration54 hash. Its56 ordered
filenames/full hashes come from the frozen
`bootstrap-history-guard-fix-v2-2026-10-25/PATCH-MANIFEST.json`, SHA256
`d5910f83033ff299ea3951972c1ca0619e44053083b48baf092faca7d94ed74b`.
The schema hash is anchored to the exact reviewed base commit, not arbitrary
working-tree content. The versioned fixture itself is pinned in the reader.

The reader checks the entire source inventory before slicing an explicitly
requested native54/55 stage. No future migration is implicitly scheduled by
that staging helper. Missing/extra/duplicate/reordered/altered inputs, schema or
symlink substitutions and forged staged descriptors fail closed. The CI writer
runner applies all56 accepted migrations, without editing or skipping SQL.

Exact protected artifacts remain:

- 54: `7317bd8d1675ed4bacfa3f67cae53c468eeaf5cb7d9acca10b68477618996250`
- 55: `1a0cb02b1775b09729cca7e02ac37cc0cf8ab660ba7e8b00ad79955bd68f7b58`
- 56 bootstrap: `48240c3e054b630d17ca5abeab49f651eb62e8580225afb84c439176614c3f5d`

## Historical protection is a missing CI prerequisite, not a new migration

The accepted production historical protections were established separately
before54/55. Merely applying the tracked schema/migration files did not recreate
that precondition. The reconciled bootstrap SQL correctly requires its original
guard and source-CAS; neither check is removed or relaxed.

`historical-protection-v1.json` copies ONLY function definitions and relevant
catalog metadata from indexed local evidence
`bootstrap-history-guard-fix-v2-2026-10-25/IMMEDIATE-BEFORE-FULL-CAS.json`, SHA256
`b91f161b6dd4e4b0868cfa86d37730c393d1a6e70e5b4561a2587b05deb86524`.
It contains no production users, historical IDs, payloads or registry rows.

The disposable setup installs the exact definitions of
`assert_operational_id`, `guard_runtime`, `immutable_identity` and the original
bootstrap-grant function, with recorded owners/ACLs, a private RLS-protected
identity registry and the15 historical-runtime triggers plus identity-immutability
trigger. Registry/table scaffolding is constructed from the recorded columns,
policy and established registry shape; this is not a full production clone.
The exact guard definition hashes remain:

- runtime guard: `ce4ab6c02b3ea5858b8643938b8ec4aa9a344c852d135f4aebb1a3e0bba83262`
- operational-ID assertion: `fddbbb35d77a791f982b62a8156cec5d277b4d94bbd338e3142ae1b5a3c55b93`
- identity immutability: `cb95c69a74b477f78e62d4a63c4bb80c5dc08caf0f9b82bff8d4fa1735e0b017`
- pre-bootstrap grant: `19feb454782a5eaf2ce6cd6e3a015827892b579fd8d5b1115cae4cb5ad6dc023`

Installation happens after53, before54, in the already existing isolated PGlite
test runner. Explicit synthetic registry allocations are added only for the
existing synthetic cases; no unknown ID is automatically accepted by a guard.
The focused tests check all four historical states, unknown-ID rejection,
exact42501/reason semantics under actual roles, trigger enforcement, private
privileges, immutability, tamper detection, and legitimate fresh bootstrap while
retaining expired consumed history. Existing writer/CAS/generation/clinical and
TRUNCATE/TRIGGER tests retain their assertions and protected operations.

## Verification and limitations

The existing `npm run test:writer-authorization` command runs its original six
Jest subtests plus one inventory-regression subtest. Detailed synthetic checks
are nested evidence, not additional top-level Jest test totals. The local task
record stores actual command/output hashes, source comparison and final counts.

CI uses the locked PGlite0.5.10 package (embedded PostgreSQL18.6). This is not a
claim that the synthetic run is native PostgreSQL17.6, physical acceptance or
A2/M1 reacceptance. Native17.6 connection configuration/staging negative checks
remain; no complete native CLI qualification is newly claimed. No production
connection, real data, backup/safe-hold mount, APK build or device action occurs.
Existing dependencies and runtime are reused without upgrades. GitHub CI for the
new commit remains unverified until separately authorized publication.

The preservation branch, original APK188 commit/tree, frozen packages and
historical acceptance decisions remain unchanged. This local CI alignment does
not change deployed behavior, release APK188 again or authorize any deployment.
