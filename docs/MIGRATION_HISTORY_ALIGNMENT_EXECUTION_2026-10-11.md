# Migration history alignment execution — 2026-10-11

Project: `fimcsrivizpliiuoqopv`. Starting branch `feature/exercise-builder-v1` at `f7fdde32cbb8a2400b21a7162df467137a95031c`. This is a running evidence record; live-history repair is forbidden until the isolated fresh-database gate passes. Historical audit: [semantic comparison](MIGRATION_HISTORY_ALIGNMENT_AUDIT_2026-10-11.md); [baseline resolution](MIGRATION_PRELEDGER_BASELINE_RESOLUTION_2026-10-11.md).

## Pre-change and local alignment

Pre-change local SQL files: **50**; live ledger entries: **42**. The live set contained 38 same-name/different-version pairs and eight unledgered baseline versions. The 38 renames below were calculated by exact semantic name from the live ledger. Target versions are unique and preserve the original semantic order. The names of all 42 current live rows now match local files at exactly the same versions; eight early files remain local-only. No migration SQL was edited: all 50 pre/post SHA-256 values agree.

| Old filename | Canonical filename | SHA-256 before = after |
| --- | --- | --- |
| `20260826185115_runtime_checkpoint_metadata_realtime.sql` | `20260826190508_runtime_checkpoint_metadata_realtime.sql` | `9b32314384f69d39843fed414e7e397fc5a565a62c077645d66210ca1c7a146b` |
| `20260828111809_runtime_checkpoint_delta_byte_budget.sql` | `20260828113258_runtime_checkpoint_delta_byte_budget.sql` | `714464b9cffccef0bfd9698cc6ec8c4638c6b09bff5166ea803475f8f7a30fc1` |
| `20260829111354_production_operator_identity_authorization.sql` | `20260829124632_production_operator_identity_authorization.sql` | `d4e9e06e6ccf6e0273377dbd50bcfee57dbc917b6fdf47851ba2f26726bbf0e0` |
| `20260829124726_production_operator_identity_authorization_hardening.sql` | `20260829124829_production_operator_identity_authorization_hardening.sql` | `25589c3c1e56903e4831e58eb7e3c51ccaabaacb80265dcf2aba43b957fb4081` |
| `20260829131400_conflict_safe_multi_cm_shared_workflow.sql` | `20260829135717_conflict_safe_multi_cm_shared_workflow.sql` | `c75121ab01278c27c480b3eeb57a9b8eed33c3b57b032b13491567968c88df76` |
| `202609010001_stale_checkpoint_expired_lease_recovery.sql` | `20260901071320_stale_checkpoint_expired_lease_recovery.sql` | `f5f834b2babe6de38c344efbd7b22039d471c4e092062fccbcaddd02c036a836` |
| `202609010002_stale_checkpoint_payload_envelope_fix.sql` | `20260901071552_stale_checkpoint_payload_envelope_fix.sql` | `5b291ab0b41261a19eb03d906528330a8c41307c60f9bca856677d8de6e3fa48` |
| `20260906055258_package_projection_divergence_recovery.sql` | `20260906063421_package_projection_divergence_recovery.sql` | `a52b35f7c351d1ebc3a62cddc0b9dd599dd2857982fd091a7cc9b74cfd0e92ea` |
| `20260907153105_narva_multicm_terminal_convergence.sql` | `20260907162401_narva_multicm_terminal_convergence.sql` | `7476588cbef844d99457f491d29e801d3881ebe4f51637433823153f4018504b` |
| `20260907163357_narva_terminal_projection_fence.sql` | `20260907163503_narva_terminal_projection_fence.sql` | `f679003494697ad25a6fa855fd1cd0c993cda403de810eb42f87e7308bb76c99` |
| `20260908041458_qualify_terminal_completion_sql.sql` | `20260908042246_qualify_terminal_completion_sql.sql` | `9f8e8ebbdfd7de49ebe24818f19d1c5a17d7952f70d35930bdcc7994e96b66a7` |
| `20260908091625_qualify_runtime_patient_command_sql.sql` | `20260908091942_qualify_runtime_patient_command_sql.sql` | `ace4ed42e5f46acb89f9f98b28298b143c6b31b9dd5c2fec0a25acd12ece4475` |
| `20260909055656_fence_shared_workflow_mutations_after_completion.sql` | `20260909060818_fence_shared_workflow_mutations_after_completion.sql` | `42978f44a1ec7baea663931612ae75974704dfc29e65b75b386509aeb8093aea` |
| `20260909123250_add_transport_runtime_patient_command.sql` | `20260909123746_add_transport_runtime_patient_command.sql` | `261e83e4de754aac129f54579ccf96188e8307c05397932b85e7a1dc46065e0a` |
| `20260910090104_large_terminal_checkpoint_timeout.sql` | `20260910090650_large_terminal_checkpoint_timeout.sql` | `a1a516379b85dcc48a155a155a19be2f5d5118939b920cc09dc7cba9ec1f17e9` |
| `20260912083420_narva_iro_scenario_controls.sql` | `20260912085404_narva_iro_scenario_controls.sql` | `92cc8cd54775eaf5eab80042443fc04940215493ad81c5a2a9d1fe05025532ea` |
| `20260913124047_persisted_canonical_checkpoint.sql` | `20260913125501_persisted_canonical_checkpoint.sql` | `598ac8c8118725e1da19bcef31f1ad2c96fc9430aa873ba558f8bec2c7d5f3d0` |
| `20260913125630_legacy_canonical_checkpoint_derivation.sql` | `20260913125805_legacy_canonical_checkpoint_derivation.sql` | `960bda078c63331b9c1ed9906236e6de94832e960a765edc99866ff575151e98` |
| `20260913130142_preserve_json_numeric_lexemes_in_legacy_derivation.sql` | `20260913130247_preserve_json_numeric_lexemes_in_legacy_derivation.sql` | `f62f87f95397891f8bffd39a8755b7661c1934dfc71d88b2393e5adcb552f352` |
| `20260913133730_decouple_canonical_checkpoint_publication.sql` | `20260913135054_decouple_canonical_checkpoint_publication.sql` | `0fcc20b6678bf8322b1b05e4473730b60351f2d6fcf327f2cab1a89b67e76c83` |
| `20260915101756_trusted_admin_exercise_role_provisioning.sql` | `20260915102524_trusted_admin_exercise_role_provisioning.sql` | `59865b9d0510746babae66618eff7215d16a69f79e09976399e3b74578e1a0eb` |
| `20260915140843_initialize_shared_workflow_patient_heads.sql` | `20260915111642_initialize_shared_workflow_patient_heads.sql` | `d67a85f9914f49803fab929d21b97890b4bf8715fcb736ae9cef89218c09dedc` |
| `20260915170000_narva_laboratory_runtime_commands.sql` | `20260915165109_narva_laboratory_runtime_commands.sql` | `bb46b40e2734114d80a494435b4b3ae057636806a8c9fbd65d76e8119ad61dd5` |
| `20260916053734_fresh_exercise_bootstrap_authorization.sql` | `20260916054932_fresh_exercise_bootstrap_authorization.sql` | `fcc1fd83d380a64e31d7632fd0fe9c5cf980dfd42bfbe1e3d49c8623c7e5749e` |
| `20260916055045_harden_fresh_exercise_bootstrap_authorization.sql` | `20260916055132_harden_fresh_exercise_bootstrap_authorization.sql` | `9fdfd99775c0adf0e8f362513f07dfff92423a8542215b248936b9f75ba48189` |
| `20260916080600_allow_bootstrap_insert_claim.sql` | `20260916080629_allow_bootstrap_insert_claim.sql` | `72acb6419d7953eaffc4d8cad59c1b14440f1a08c7a47229230038178893473d` |
| `20260916081500_separate_bootstrap_insert_authority.sql` | `20260916080939_separate_bootstrap_insert_authority.sql` | `b1d5c9254bc384d034ad7b93f207736d64a0eabb7edd169f0c419d1321c8d338` |
| `20260916084800_fix_bootstrap_insert_authorization_helper.sql` | `20260916084829_fix_bootstrap_insert_authorization_helper.sql` | `a234427d123100741fb3b177302a06de8dd866b29f4f527a8680a703b094262f` |
| `20260918123000_large_canonical_checkpoint_publication_timeout.sql` | `20260918145252_large_canonical_checkpoint_publication_timeout.sql` | `9a4b8a9213bd0464d7ca8b404088fcf0fd4fe19aaf575fd644ed0b88378c2888` |
| `20260925120000_add_imaging_runtime_patient_command.sql` | `20260928043420_add_imaging_runtime_patient_command.sql` | `53998d103eff56f36b6826fe3ede9a40298dd2c81def8dd07de299aa585a7bfd` |
| `20260926120000_add_endotracheal_intubation_runtime_patient_command.sql` | `20260928043446_add_endotracheal_intubation_runtime_patient_command.sql` | `b1b411031e5bd3903ad3e5bbc71cdaf14b776cef5236bb02320395d609acdf39` |
| `20260926143000_add_patient_complete_runtime_patient_command.sql` | `20260928043507_add_patient_complete_runtime_patient_command.sql` | `48553387691c2a3884375b29a7345ab20e8c66baa0d55fbb74b77780f416c371` |
| `20260927120000_add_patient_location_transfer_runtime_patient_command.sql` | `20260928043528_add_patient_location_transfer_runtime_patient_command.sql` | `5bfc19e82927c8208cc2d9d21fb662acfb933ca260d9c3f00d3c6fb494a260a4` |
| `20261004120000_user_exercise_admin_v1.sql` | `20261004111720_user_exercise_admin_v1.sql` | `252c1c2f258fb5e8398a2d42534e04bf52d5f80da8c2040843ff0f00e370c089` |
| `20261004123000_user_exercise_admin_v1_hardening.sql` | `20261004111830_user_exercise_admin_v1_hardening.sql` | `1c16ae51bba0f114028b9ed111165a02b290bd3e99970ac4d18f3928e4a56af0` |
| `20261006120000_recover_pending_completion_takeover.sql` | `20261006103300_recover_pending_completion_takeover.sql` | `f989593262f5f3ce88dc5fe970593d13b5e7024ddad70e4867e2a5fd7de93912` |
| `20261007120000_refuse_consumed_bootstrap_revocation.sql` | `20261007174526_refuse_consumed_bootstrap_revocation.sql` | `31bf3812d5c4f904114a0cda8aa75249e71bcb0a65bf3a5e80cd2b58d30ff2bd` |
| `20261007123000_allow_bootstrap_revocation_audit.sql` | `20261007191214_allow_bootstrap_revocation_audit.sql` | `b400e1f795c87a5ed0f34f941e5607845a2ad6b3b542cbed3e9c3040204b6021` |

The twelve unchanged files (eight early baseline plus four already matched by version) retained their SHA-256 values:

| Unchanged filename | SHA-256 |
| --- | --- |
| `202607270001_module_import_foundation.sql` | `7966470bb0b315b69d351e81d045493d2aa248b3dda07c5f0f4d01e2554f064c` |
| `202607270002_import_run_rollback.sql` | `c3b7ea35b742b181fae834541eb30fd336db0015bbbe3ef33a118ce51f7c486c` |
| `202607270003_exercise_self_binding.sql` | `d96c673a2d579054b640afee240ad4317b0d1673201504513c5ea9f4ba2206d5` |
| `202608120001_authorization_foundation.sql` | `9912bb83827956cb6f620c3c805822a6869a2e8d307a4265b6c35a5a135ff9a7` |
| `202608120002_instructor_evaluation_foundation.sql` | `1e45d00cc7ee9ede2f930be0c354e05402bda0ac05381c72d69cb9d9121bbb91` |
| `202608120003_runtime_checkpoint_authority.sql` | `3791738053ed77e6a0405b7b04746e55cea7dcead632fb1f1e098660c689db9b` |
| `202608140001_runtime_missing_recovery.sql` | `e374e86e5fab6c6a21848add9d62370887c1a137fd57b7bd59deb0f1e8afaca1` |
| `202608140002_runtime_recovery_acceptance_fixture.sql` | `da2a018d901f52f491692fd88596bc85b9d1ac9d98335868b5e86dcc565e5ece` |
| `202608190001_runtime_checkpoint_egress_hardening.sql` | `c42ab0244228cbffc70d3c02f25b45611bf3dd3762daf9b2d470101a1fba2fc8` |
| `20260828083146_runtime_checkpoint_delta_hydration.sql` | `d4187e19db00de6e1f97fd64cb894cae31dbd9a913e2ad3d56191aaf77d0c995` |
| `20261010051206_platform_admin_break_glass_recovery.sql` | `2cb0b00f137514dd72366e37bda1cc49fa613fadc9cb95fbf08055b2b4423c7a` |
| `20261010110021_builder_lab_package_binding.sql` | `1789bdb706d0cb4f2fb84d962c00a5dbf3e7caf59f148ef9f4f37e98d651ed50` |

Active file-path references were mechanically updated in 33 source/test/config files (63 lines); historical narrative documents retain their period-correct filenames and are superseded by this mapping. Targeted migration-related tests: 6 suites / 37 tests PASS. Complete suite: 317 suites / 2639 tests PASS. TypeScript, ESLint, field-release configuration and Runtime/multi-device guardrails PASS. These tests do **not** substitute for isolated fresh-database replay.

## Production pre-repair fingerprints

Read-only `pg_catalog`/`pg_policies` snapshots hash each category's ordered object keys and definitions with MD5. The function category hashes `pg_get_functiondef`; grants hash relation/function ACLs; publication hashes public table membership. These are comparison fingerprints, not credential data. The same exact query is to be run immediately before and after any future supported repair.

| Category | Objects | Pre-repair fingerprint |
| --- | ---: | --- |
| columns | 262 | `a401172bf500a8e271c743a671f284e9` |
| constraints | 168 | `cba486f920168c8701adde20e3bb22d6` |
| functions | 61 | `dbe9fdd473861834b56de039ef78c093` |
| grants | 96 | `723d2c5cf2f88ee40beb8f7afbb2c69f` |
| indexes | 63 | `c46b20579e11913c70d541a5994cd5a8` |
| policies | 35 | `d09a588eb7dbb4e353f31caaeca82eb1` |
| publication | 5 | `e88d1c627bc85f18773dc48ed4e49c92` |
| relations | 35 | `2cafaf03cfb62742f4c9060daa7404be` |
| triggers | 12 | `e1882bcec3b899980578fcd8e0a245ce` |

The live ledger's first version was `202608190001`; its highest was `20261010110021`. The initial ledger count and fingerprints were captured before any local rename. No live schema or history mutation has occurred so far.

## Fresh-database hard gate and repair semantics

The canonical isolated bootstrap to test is: initialize a **new disposable Supabase database** with standard managed `auth`/Realtime schemas, apply the tracked `supabase/schema.sql` shared-state precursor, then apply all 50 canonical-order files from `supabase/migrations`. `schema.sql` creates `exercise_states`, which no migration file creates. Compare tables, columns, constraints, indexes, triggers, functions/RPCs, policies, grants and publication membership to the production snapshot, classifying environment-specific differences separately. A bare `supabase db reset` is not proof of this repository's two-stage bootstrap.

At the earlier local-alignment checkpoint, no isolated database was available on this host. The separately authorized scratch project `thixnregyriwevgptclw` was subsequently created; its completed replay and read-only production comparison are recorded below. **No live repair may occur without a separately authorized production-history repair work package.**

Installed Supabase CLI: **2.119.0**. Its `migration repair --help` accepts `--status applied` and explicit versions. [Official Supabase documentation](https://supabase.com/docs/reference/cli/supabase-migration-repair) specifies that applied repair inserts history rows without running migration SQL; [db push documentation](https://supabase.com/docs/reference/cli/supabase-db-push) defines `--dry-run` and `--include-all`. No repair command has been run. The exact eight allowed future versions are `202607270001`, `202607270002`, `202607270003`, `202608120001`, `202608120002`, `202608120003`, `202608140001`, `202608140002`; their live effects and limited historical provenance are recorded in the prior audits. A repair, if later reached, records **operational alignment, not proof of original byte-for-byte execution**.

## Remaining execution gates

1. **Completed below:** authorized isolated scratch project, two-stage bootstrap and material schema comparison passed.
2. Immediately before any live repair, re-read the 42-row ledger and all production fingerprints; stop on drift.
3. Run supported `migration repair --status applied` for only the eight allowlisted versions in chronological order, recording each result; never execute their SQL on production and never manually edit the ledger.
4. Require 50 local = 50 live exact versions, zero local-only/remote-only, and unchanged production schema/policy/grant/function fingerprints. Run supported read-only list and dry-run; require zero historical SQL pending even with `--include-all`.
5. Only then set `MIGRATION_HISTORY_ALIGNMENT` and C7 to PASS. A future migration must be CLI-generated, unique and later than `20261010110021`; no writer-fence migration is authored in this work package.

Earlier intermediate result (before scratch replay): local 38-file alignment, SQL-byte preservation, version uniqueness and 42/42 known-live matching **PASS**. The scratch bootstrap has since passed; live history repair, 50/50 production readback, post-repair fingerprints and no-replay dry-run remain **NOT RUN**. Thus `MIGRATION_HISTORY_ALIGNMENT = READY_FOR_PRODUCTION_HISTORY_REPAIR` and C7 remains **BLOCKED_PENDING_PRODUCTION_HISTORY_REPAIR**. No production schema, data, RLS, grants, functions or Edge Functions changed; no branch push.

### Historical stopping checkpoint before scratch project authorization

This prior checkpoint is superseded by the successful scratch replay below. It recorded `STOP_REASON_CLASS = FRESH_DB_REPRODUCIBILITY_UNAVAILABLE` before scratch-project authorization, not a migration-chain failure.

## Isolated scratch replay — completed 2026-10-11

Scratch identity was checked before every migration: project ref `thixnregyriwevgptclw`, name `russicaptor-migration-scratch-20261011`, organization `stcktcuxpqywzkaveusy`, region `eu-west-1`, database host `db.thixnregyriwevgptclw.supabase.co`. Production `fimcsrivizpliiuoqopv` was used only for read-only catalog queries. The scratch project already had the committed `supabase/schema.sql` precursor applied, with `exercise_states`, three baseline RLS policies and Realtime configuration; its migration ledger was empty before replay.

Each migration was executed from `git show HEAD:<path>` at source commit `15c7e3e6b42a1ae64d32255372ec29430845dc22`, after checking that its worktree SHA-256 and committed SHA-256 matched the recorded value. The Supabase `apply_migration` tool applied the entire unchanged SQL and inserted one scratch ledger row per successful file. It assigns a *new scratch timestamp version* instead of preserving the filename's canonical version. The canonical source version remains in the ledger **name**, and all 50 ledger names match the committed files in exact order. Do not use these generated scratch timestamp versions to align production history.

The first file `202607270001_module_import_foundation.sql` matched expected SHA-256 `7966470bb0b315b69d351e81d045493d2aa248b3dda07c5f0f4d01e2554f064c` and applied successfully. Readback found the five import tables (`exercise_module_bindings`, `exercise_versions`, `import_run_modules`, `import_runs`, `module_versions`), their indexes and RLS policies, four import functions, and zero rows in those tables. An intermediate anon EXECUTE grant on those functions resulted from Supabase default function privileges; the later committed `20260829124632_production_operator_identity_authorization.sql` expressly revoked it. Final function ACLs match production. The second file initially received an expired tool confirmation state; ledger readback showed it had **not** applied. The identical committed file was retried once and applied. No SQL was edited, reordered or skipped.

| # | Committed canonical migration | SQL SHA-256 | Scratch ledger version | Result |
| ---: | --- | --- | --- | --- |
| 1 | `202607270001_module_import_foundation.sql` | `7966470bb0b315b69d351e81d045493d2aa248b3dda07c5f0f4d01e2554f064c` | `20261011072146` | PASS |
| 2 | `202607270002_import_run_rollback.sql` | `c3b7ea35b742b181fae834541eb30fd336db0015bbbe3ef33a118ce51f7c486c` | `20261011072855` | PASS |
| 3 | `202607270003_exercise_self_binding.sql` | `d96c673a2d579054b640afee240ad4317b0d1673201504513c5ea9f4ba2206d5` | `20261011072909` | PASS |
| 4 | `202608120001_authorization_foundation.sql` | `9912bb83827956cb6f620c3c805822a6869a2e8d307a4265b6c35a5a135ff9a7` | `20261011073043` | PASS |
| 5 | `202608120002_instructor_evaluation_foundation.sql` | `1e45d00cc7ee9ede2f930be0c354e05402bda0ac05381c72d69cb9d9121bbb91` | `20261011073052` | PASS |
| 6 | `202608120003_runtime_checkpoint_authority.sql` | `3791738053ed77e6a0405b7b04746e55cea7dcead632fb1f1e098660c689db9b` | `20261011073059` | PASS |
| 7 | `202608140001_runtime_missing_recovery.sql` | `e374e86e5fab6c6a21848add9d62370887c1a137fd57b7bd59deb0f1e8afaca1` | `20261011073117` | PASS |
| 8 | `202608140002_runtime_recovery_acceptance_fixture.sql` | `da2a018d901f52f491692fd88596bc85b9d1ac9d98335868b5e86dcc565e5ece` | `20261011073124` | PASS |
| 9 | `202608190001_runtime_checkpoint_egress_hardening.sql` | `c42ab0244228cbffc70d3c02f25b45611bf3dd3762daf9b2d470101a1fba2fc8` | `20261011073130` | PASS |
| 10 | `20260826190508_runtime_checkpoint_metadata_realtime.sql` | `9b32314384f69d39843fed414e7e397fc5a565a62c077645d66210ca1c7a146b` | `20261011073137` | PASS |
| 11 | `20260828083146_runtime_checkpoint_delta_hydration.sql` | `d4187e19db00de6e1f97fd64cb894cae31dbd9a913e2ad3d56191aaf77d0c995` | `20261011073144` | PASS |
| 12 | `20260828113258_runtime_checkpoint_delta_byte_budget.sql` | `714464b9cffccef0bfd9698cc6ec8c4638c6b09bff5166ea803475f8f7a30fc1` | `20261011073200` | PASS |
| 13 | `20260829124632_production_operator_identity_authorization.sql` | `d4e9e06e6ccf6e0273377dbd50bcfee57dbc917b6fdf47851ba2f26726bbf0e0` | `20261011073208` | PASS |
| 14 | `20260829124829_production_operator_identity_authorization_hardening.sql` | `25589c3c1e56903e4831e58eb7e3c51ccaabaacb80265dcf2aba43b957fb4081` | `20261011073222` | PASS |
| 15 | `20260829135717_conflict_safe_multi_cm_shared_workflow.sql` | `c75121ab01278c27c480b3eeb57a9b8eed33c3b57b032b13491567968c88df76` | `20261011073233` | PASS |
| 16 | `20260901071320_stale_checkpoint_expired_lease_recovery.sql` | `f5f834b2babe6de38c344efbd7b22039d471c4e092062fccbcaddd02c036a836` | `20261011073238` | PASS |
| 17 | `20260901071552_stale_checkpoint_payload_envelope_fix.sql` | `5b291ab0b41261a19eb03d906528330a8c41307c60f9bca856677d8de6e3fa48` | `20261011073250` | PASS |
| 18 | `20260906063421_package_projection_divergence_recovery.sql` | `a52b35f7c351d1ebc3a62cddc0b9dd599dd2857982fd091a7cc9b74cfd0e92ea` | `20261011073435` | PASS |
| 19 | `20260907162401_narva_multicm_terminal_convergence.sql` | `7476588cbef844d99457f491d29e801d3881ebe4f51637433823153f4018504b` | `20261011073445` | PASS |
| 20 | `20260907163503_narva_terminal_projection_fence.sql` | `f679003494697ad25a6fa855fd1cd0c993cda403de810eb42f87e7308bb76c99` | `20261011073454` | PASS |
| 21 | `20260908042246_qualify_terminal_completion_sql.sql` | `9f8e8ebbdfd7de49ebe24818f19d1c5a17d7952f70d35930bdcc7994e96b66a7` | `20261011073502` | PASS |
| 22 | `20260908091942_qualify_runtime_patient_command_sql.sql` | `ace4ed42e5f46acb89f9f98b28298b143c6b31b9dd5c2fec0a25acd12ece4475` | `20261011073507` | PASS |
| 23 | `20260909060818_fence_shared_workflow_mutations_after_completion.sql` | `42978f44a1ec7baea663931612ae75974704dfc29e65b75b386509aeb8093aea` | `20261011073518` | PASS |
| 24 | `20260909123746_add_transport_runtime_patient_command.sql` | `261e83e4de754aac129f54579ccf96188e8307c05397932b85e7a1dc46065e0a` | `20261011073524` | PASS |
| 25 | `20260910090650_large_terminal_checkpoint_timeout.sql` | `a1a516379b85dcc48a155a155a19be2f5d5118939b920cc09dc7cba9ec1f17e9` | `20261011073530` | PASS |
| 26 | `20260912085404_narva_iro_scenario_controls.sql` | `92cc8cd54775eaf5eab80042443fc04940215493ad81c5a2a9d1fe05025532ea` | `20261011073535` | PASS |
| 27 | `20260913125501_persisted_canonical_checkpoint.sql` | `598ac8c8118725e1da19bcef31f1ad2c96fc9430aa873ba558f8bec2c7d5f3d0` | `20261011073540` | PASS |
| 28 | `20260913125805_legacy_canonical_checkpoint_derivation.sql` | `960bda078c63331b9c1ed9906236e6de94832e960a765edc99866ff575151e98` | `20261011073546` | PASS |
| 29 | `20260913130247_preserve_json_numeric_lexemes_in_legacy_derivation.sql` | `f62f87f95397891f8bffd39a8755b7661c1934dfc71d88b2393e5adcb552f352` | `20261011073559` | PASS |
| 30 | `20260913135054_decouple_canonical_checkpoint_publication.sql` | `0fcc20b6678bf8322b1b05e4473730b60351f2d6fcf327f2cab1a89b67e76c83` | `20261011073605` | PASS |
| 31 | `20260915102524_trusted_admin_exercise_role_provisioning.sql` | `59865b9d0510746babae66618eff7215d16a69f79e09976399e3b74578e1a0eb` | `20261011073612` | PASS |
| 32 | `20260915111642_initialize_shared_workflow_patient_heads.sql` | `d67a85f9914f49803fab929d21b97890b4bf8715fcb736ae9cef89218c09dedc` | `20261011073618` | PASS |
| 33 | `20260915165109_narva_laboratory_runtime_commands.sql` | `bb46b40e2734114d80a494435b4b3ae057636806a8c9fbd65d76e8119ad61dd5` | `20261011073625` | PASS |
| 34 | `20260916054932_fresh_exercise_bootstrap_authorization.sql` | `fcc1fd83d380a64e31d7632fd0fe9c5cf980dfd42bfbe1e3d49c8623c7e5749e` | `20261011073704` | PASS |
| 35 | `20260916055132_harden_fresh_exercise_bootstrap_authorization.sql` | `9fdfd99775c0adf0e8f362513f07dfff92423a8542215b248936b9f75ba48189` | `20261011073750` | PASS |
| 36 | `20260916080629_allow_bootstrap_insert_claim.sql` | `72acb6419d7953eaffc4d8cad59c1b14440f1a08c7a47229230038178893473d` | `20261011073757` | PASS |
| 37 | `20260916080939_separate_bootstrap_insert_authority.sql` | `b1d5c9254bc384d034ad7b93f207736d64a0eabb7edd169f0c419d1321c8d338` | `20261011073807` | PASS |
| 38 | `20260916084829_fix_bootstrap_insert_authorization_helper.sql` | `a234427d123100741fb3b177302a06de8dd866b29f4f527a8680a703b094262f` | `20261011073814` | PASS |
| 39 | `20260918145252_large_canonical_checkpoint_publication_timeout.sql` | `9a4b8a9213bd0464d7ca8b404088fcf0fd4fe19aaf575fd644ed0b88378c2888` | `20261011073824` | PASS |
| 40 | `20260928043420_add_imaging_runtime_patient_command.sql` | `53998d103eff56f36b6826fe3ede9a40298dd2c81def8dd07de299aa585a7bfd` | `20261011073831` | PASS |
| 41 | `20260928043446_add_endotracheal_intubation_runtime_patient_command.sql` | `b1b411031e5bd3903ad3e5bbc71cdaf14b776cef5236bb02320395d609acdf39` | `20261011073851` | PASS |
| 42 | `20260928043507_add_patient_complete_runtime_patient_command.sql` | `48553387691c2a3884375b29a7345ab20e8c66baa0d55fbb74b77780f416c371` | `20261011073858` | PASS |
| 43 | `20260928043528_add_patient_location_transfer_runtime_patient_command.sql` | `5bfc19e82927c8208cc2d9d21fb662acfb933ca260d9c3f00d3c6fb494a260a4` | `20261011073906` | PASS |
| 44 | `20261004111720_user_exercise_admin_v1.sql` | `252c1c2f258fb5e8398a2d42534e04bf52d5f80da8c2040843ff0f00e370c089` | `20261011073917` | PASS |
| 45 | `20261004111830_user_exercise_admin_v1_hardening.sql` | `1c16ae51bba0f114028b9ed111165a02b290bd3e99970ac4d18f3928e4a56af0` | `20261011073922` | PASS |
| 46 | `20261006103300_recover_pending_completion_takeover.sql` | `f989593262f5f3ce88dc5fe970593d13b5e7024ddad70e4867e2a5fd7de93912` | `20261011073929` | PASS |
| 47 | `20261007174526_refuse_consumed_bootstrap_revocation.sql` | `31bf3812d5c4f904114a0cda8aa75249e71bcb0a65bf3a5e80cd2b58d30ff2bd` | `20261011073941` | PASS |
| 48 | `20261007191214_allow_bootstrap_revocation_audit.sql` | `b400e1f795c87a5ed0f34f941e5607845a2ad6b3b542cbed3e9c3040204b6021` | `20261011073951` | PASS |
| 49 | `20261010051206_platform_admin_break_glass_recovery.sql` | `2cb0b00f137514dd72366e37bda1cc49fa613fadc9cb95fbf08055b2b4423c7a` | `20261011074000` | PASS |
| 50 | `20261010110021_builder_lab_package_binding.sql` | `1789bdb706d0cb4f2fb84d962c00a5dbf3e7caf59f148ef9f4f37e98d651ed50` | `20261011074008` | PASS |

Final scratch ledger count: **50**; committed migration count: **50**; order/name match: **50/50**. Successful migration SQL executions: **50**; skipped: **0**; modified SQL: **0**. The scratch ledger's timestamp IDs intentionally differ from canonical file versions because of the MCP application mechanism, while names encode and verify canonical order. Production ledger remains **42**; no production repair was attempted.

### Read-only scratch/production schema comparison

The same read-only catalog queries were run on both projects. Row sets were compared exactly after sorting by object identity (not by physical column position). These FNV-1a-64 fingerprints are compact evidence; the equality finding also used full row comparison. Function records included `md5(pg_get_functiondef)`, signature, volatility, SECURITY DEFINER flag, `proconfig`/search_path and ACL. Relation records included RLS flags and ACL. PostgreSQL patch versions differ (scratch 17.11, production 17.6), but no compared application-object definition differs.

| Category | Count each | Scratch fingerprint | Production fingerprint | Full row sets equal |
| --- | ---: | --- | --- | --- |
| Relations and relation ACLs | 35 | `cf91e3dbea000b08` | `cf91e3dbea000b08` | YES |
| Columns/defaults/nullability | 262 | `ef7a277b68e3820b` | `ef7a277b68e3820b` | YES |
| Constraints | 168 | `837d911bbd8a45c7` | `837d911bbd8a45c7` | YES |
| Indexes | 63 | `982eec9a3980f1fc` | `982eec9a3980f1fc` | YES |
| Triggers | 12 | `45a00ad7f10a3d8e` | `45a00ad7f10a3d8e` | YES |
| RLS policies | 35 | `0a0e73af096252da` | `0a0e73af096252da` | YES |
| Functions, definitions, security and ACLs | 61 | `f2e732d2b1fc1f5e` | `f2e732d2b1fc1f5e` | YES |
| Realtime public-table membership | 5 | `3ecbf6fc7593937d` | `3ecbf6fc7593937d` | YES |
| Public schema ACL | 1 | `7d2af1497a29e375` | `7d2af1497a29e375` | YES |
| Public default ACLs | 6 | `484d53a85cabf964` | `484d53a85cabf964` | YES |

Physical column order differs only in `module_versions`: scratch places `created_by_import_run_id` before `registered_at`/`registered_by`; production appends it after them. Names, types, defaults, nullability, constraints and function definitions match. The migration's `SELECT * INTO` uses that table's own rowtype on either project. This is a harmless physical-order/provenance difference, not a material application-schema difference; it does not prove that the eight pre-ledger files historically ran verbatim. There are zero material table, function, RLS, grant or security-object differences in the compared final public schema.

### Gate and next action

`SCRATCH_PROJECT_IDENTITY`, `SCRATCH_SCHEMA_BASELINE`, `SCRATCH_FIRST_MIGRATION_IDENTITY`, `SCRATCH_FIRST_MIGRATION_APPLY`, `SCRATCH_50_MIGRATION_CHAIN`, `SCRATCH_MIGRATION_ORDER`, `SCRATCH_SCHEMA_FINGERPRINT`, `SCRATCH_PRODUCTION_SCHEMA_EQUIVALENCE`, `MIGRATION_FRESH_DB_BOOTSTRAP` and `MIGRATION_FRESH_LIVE_SCHEMA_EQUIVALENCE` are **PASS**. `MIGRATION_HISTORY_ALIGNMENT = READY_FOR_PRODUCTION_HISTORY_REPAIR`; C7 is **BLOCKED_PENDING_PRODUCTION_HISTORY_REPAIR**. No production ledger/schema/data/RLS/grant/function/Edge Function mutation, production migration repair, writer-fence migration, or branch push occurred. The next separately authorized action is a supported production history repair for the eight pre-ledger canonical versions, with immediate pre/post schema fingerprints and 50/50 version-set readback; this document does not authorize that action.
