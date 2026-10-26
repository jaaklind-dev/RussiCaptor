# APK188 release source and subsequently reconciled deployed SQL

This is a local source-provenance record, not a build, deployment, acceptance
decision, new migration, or permission to apply SQL to a database.

## Immutable operational APK188 baseline

- Application: `com.jaaklind.RussiCaptor`, versionName `1.2.1`, versionCode `188`.
- Actual build commit: `07201f6f352977f08a511146d0eb83afd36b9439`.
- Actual build tree: `c073511468d86d2ab1c98ea73725f80cdc95213d`.
- APK SHA-256: `33a7c527f00500b60dc46f010706141b98aa697a747b6ec6e1c9fb7f8511adfd`.
- Original frozen manifest SHA-256:
  `5fa4f39167b812c061c2155edf3f927539fe7a18b415799e90ef7e45ede4b0cc`.
- Original source preservation ref:
  `refs/tags/preserve/apk188-1.2.1-v188-20261026-07201f6f`.

The subsequent commit adding this document is NOT the commit that built APK188.
The original commit/tree, APK, signature, frozen manifests, historical decisions,
and accepted operational release remain unchanged. No version metadata, runtime,
Android code, permissions, dependencies or release descriptor is changed here.

## Exact deployed migration sources

Review branch: `review/apk188-deployed-sql-20261026`, based on the preserved exact
APK188 commit above. The only tracked changes are the following SQL alignment
and this provenance document.

1. `20261019171013_runtime_writer_controller_authorization.sql`:
   replace the old source hash
   `71af6d0095e9301f79d593ad2645b7d7351711124b3088de7004bb76a0e6581e`
   with the exact deployed guard-preserving hash
   `7317bd8d1675ed4bacfa3f67cae53c468eeaf5cb7d9acca10b68477618996250`.
   The sole textual correction is preserving
   `PERFORM rc_history.assert_operational_id(p_exercise_id);` as the first
   statement in `record_runtime_patient_command_result`. No SQL was redesigned.
2. `20261020070931_runtime_critical_table_privileges.sql`:
   already byte-identical; unchanged, SHA-256
   `1a0cb02b1775b09729cca7e02ac37cc0cf8ab660ba7e8b00ad79955bd68f7b58`.
3. Add the exact already-deployed
   `20261025162559_preserve_consumed_bootstrap_history.sql`, SHA-256
   `48240c3e054b630d17ca5abeab49f651eb62e8580225afb84c439176614c3f5d`.
   Its existing function/index source-CAS checks and historical protections are
   copied byte-for-byte, not regenerated or weakened.

These existing timestamp identifiers retain their original order: 54, 55, then
bootstrap `20261025162559`. This neither renumbers applied migrations nor repairs
production migration history. All three were already applied to the accepted
target according to the preserved deployment evidence. Do not rerun them or use
this reconciliation as deployment authorization. The bootstrap file retains its
specific prerequisite-definition CAS; no general clean-install compatibility or
new database acceptance is claimed by this source-only task.

## Preserved evidence lineage

The following paths identify the existing project evidence under the local
RussiCaptor ChatGPT project mirror's `outputs/` directory. Evidence directories
and generated APKs are not added to this Git commit.

- `operational-release188-2026-10-26/FROZEN-OPERATIONAL-MANIFEST.json` and
  `apk188-operational-release-decision-2026-10-26/OPERATIONAL-RELEASE-DECISION.txt`:
  original artifact and separate explicit operational release.
- `migration54-55-guard-preserving-2026-10-25/CANDIDATE-MANIFEST.json`, SHA-256
  `d1e33b53e2497359248cdef39ee6ca9715591f59b588f63d87441c1f4544bf5a`, and
  `migration54-55-keychain-deployment-2026-10-25/FINAL-DEPLOYMENT-DECISION.txt`:
  exact guard-preserving 54 and unchanged 55, deployed 2026-10-25.
- `bootstrap-history-guard-fix-v2-2026-10-25/PATCH-MANIFEST.json`, SHA-256
  `d5910f83033ff299ea3951972c1ca0619e44053083b48baf092faca7d94ed74b`, and
  its `FINAL-DEPLOYMENT-DECISION.txt`: exact bootstrap source/deployment.
- `checkpoint-pause-diagnosis-2026-10-26/BOOTSTRAP-CHANGE-AND-AUTHORIZATION.txt`:
  existing limitation in independently binding the earlier bootstrap offer to
  its user confirmation remains documented. The present source-reconciliation
  authorization does not retroactively resolve or rewrite that historical finding.

## Preservation and review boundary

The full original release ancestry is also preserved in a standalone local Git
bundle under the durable sibling preservation directory. Its hash, reconstruction
verification, original dirty-work snapshots, final reconciliation commit and
minimal diff are recorded in that directory's `evidence/` records.

Only local refs, an isolated repository/worktree, bundle and the scoped source
commit are authorized. No fetch/pull, push, merge into main, application build,
device action, production access, database operation, A2 restoration, asset
deletion or maintenance-state change is part of this work. No APK186/187
diagnostic mechanism is reintroduced. Existing dirty work stays in its original
checkout. Local preservation does not establish off-machine publication or a
current remote-tracking state. A separate review/publication decision is needed.
