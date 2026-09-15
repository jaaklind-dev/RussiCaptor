# RussiCaptor Runtime Regression Guardrails

All RussiCaptor Runtime Regression Guardrails are mandatory acceptance gates. No feature may weaken, bypass, delete, relax, or silently redefine them. If a feature conflicts with a guardrail, the conflict must be explicitly reported and resolved as an architecture change before release.

This document is the normative index for Runtime, checkpoint, multi-device, clinical-command, workflow, package, and terminal-lifecycle invariants. The executable catalog is `test/runtime-regression-guardrails.manifest.json`; it deliberately points to the canonical regression tests instead of copying their logic.

## Authority hierarchy

The shared rules are:

1. One active Runtime writer at most: only a valid writer lease may heartbeat and publish authoritative checkpoints.
2. Validated durable remote checkpoint state outranks reader-local/cache state, which outranks discovery metadata only when no validated Runtime checkpoint exists.
3. A checkpoint is one coherent snapshot. Patient state, session, simulation time, command cursor, fault state, resources, and medications must share one accepted lineage.
4. `shared_workflow_patient_states` is authoritative for CM ownership. Runtime readiness and ownership readiness are independent gates.
5. A durable clinical or scenario-control command records decision/intent time. Writer advancement alone does not make a valid intent stale; lineage, lifecycle, ownership, threshold, and patient-revision/CAS protection remain fail-closed.
6. Canonical-v1 is the full-restore integrity authority: verify the canonical representation, parse that same representation, then restore it.

Feature code must use the shared authority, intent-time, ownership-classification, checkpoint-selection, idempotency, and completion-fence infrastructure. Feature-specific bypasses or competing implementations are forbidden.

## Guardrail catalog

| ID | Guardrail | Required invariant | Canonical executable coverage |
| --- | --- | --- | --- |
| A | Single writer authority | Writer owns the lease, heartbeats, and publishes; readers remain lease-free and can submit authorized durable commands. Takeover establishes only one authority. | `RuntimeWriterAuthorityState-test.ts`, `RuntimeCheckpointStartup-test.ts` |
| B | Reader convergence | A reader stays command-fenced while a newer known authoritative checkpoint is pending. Remote durable state wins monotonically across restart, reconnect, foreground, and racing callbacks. | `RuntimeReaderConvergence-test.ts`, `RuntimeCheckpointAuthority-test.ts` |
| C | Coherent snapshot hydration | A reader never exposes state from revision N with session/time from revision M. Hydration exposes one coherent accepted checkpoint. | `RuntimeCheckpointCanonicalArtifact-test.ts`, `CanonicalRuntimePersistence-test.ts` |
| D | Durable intent time | Command time is authoritative decision time. Valid intents remain valid when writer materializes at T+1, +5, +10, +30, +60, or +120. | `ClinicalTreatmentRuntimePatientCommandMaterializer-test.ts` |
| E | True stale commands fail closed | Mismatched times, wrong exercise/lineage, malformed or invalid-future time, changed ownership, CAS conflict, and completion fence reject canonically. | `ClinicalTreatmentRuntimePatientCommandMaterializer-test.ts`, `RuntimePatientCommandConcurrency-test.ts` |
| F | No-writer future intent | A valid intent queued ahead of a recovered older writer is preserved, deferred until canonical time catches up, and then materialized once. | `ClinicalTreatmentRuntimePatientCommandMaterializer-test.ts`, `RuntimePatientCommandConcurrency-test.ts` |
| G | Exactly-once command effect | Duplicate submission, retry, lost response, takeover, restart, reconnect, and replay yield one durable row, one materialization, and one clinical mutation. | `RuntimePatientCommandConcurrency-test.ts`, `ClinicalTreatmentRuntimePatientCommandMaterializer-test.ts` |
| H | Patient revision/CAS | Checkpoint advancement without patient mutation may remain valid; conflicting patient mutation cannot overwrite newer clinical state. | `RuntimePatientCommandConcurrency-test.ts`, `SharedWorkflowConcurrency-test.ts` |
| I | Ownership authority | Owner matching current CM is SELF, another CM is OTHER_CM, and absent owner is UNOWNED. Rehydrate is read-only and never double-claims. | `CmOwnershipProjectionRestore-test.ts`, `SharedWorkflowConcurrency-test.ts` |
| J | Ownership and Runtime readiness | Treatment access requiring ownership needs Runtime ready and ownership reconciled; empty or stale local projection cannot produce false OTHER_CM. | `CmOwnershipProjectionRestore-test.ts`, `CmOwnershipProjectionPresentation-test.ts` |
| K | Authoritative UI projection | Patient-scoped UI follows authoritative selected-patient state through live updates, controls, timers, rehydrate, and patient/exercise switches. | `NarvaIroScenarioControlsCard-test.tsx`, `ResourceRuntimeDebugService-test.ts` |
| L | Stable interaction handlers | A rendered React Native control crosses the real responder/accessibility activation path to the durable gateway; rerenders, double press, and disabled states stay safe. | `NarvaIroScenarioControlsCard-test.tsx`, `InteractionSafety-test.ts` |
| M | Canonical checkpoint trust | Verify canonical representation and execute the same verified representation. Tampering, provenance mismatch, and alternate structured payloads fail closed. | `RuntimeCheckpointCanonicalArtifact-test.ts`, `PersistedCanonicalCheckpointMigration-test.ts` |
| N | No reader object recanonicalization | Canonical-v1 reader integrity verification performs zero full JS-object recanonicalizations. | `PersistedCanonicalCheckpointPerformance-test.ts`, `RuntimeCheckpointCanonicalArtifact-test.ts` |
| O | Legacy checkpoint compatibility | Derived legacy artifacts are additive, source/hash/revision-bound, idempotent, auditable, and non-destructive. | `PersistedCanonicalCheckpointMigration-test.ts`, `RuntimeCheckpointStartup-test.ts` |
| P | No duplicated full publication | A writer never transports full structured state plus full canonical state in one publication request. | `RuntimeCheckpointRepository-test.ts`, `DecoupledCanonicalPublicationMigration-test.ts` |
| Q | Large-payload publication | The unchanged 1.8/3/4/8/12/15–16 MB matrix records largest request, total bytes, and success without threshold inflation. | `RuntimeTerminalCheckpointRepository-test.ts`, `RuntimeLargeCheckpointRestore-test.ts` |
| R | Terminal completion | COMPLETED request, terminal checkpoint/artifact, COMPLETED exercise projection, no later RUNNING state, stopped heartbeat, and explicit released lease are one required outcome. | `RuntimeTerminalConvergenceIntegration-test.ts`, `RuntimeCompletionService-test.ts`, `narva_terminal_completion_test.sql` |
| S | Completion fence | Ordinary mutation rejects after fencing; routine publication cannot starve terminal publication; terminal work is single-flight and idempotent. | `RuntimePatientCommandConcurrency-test.ts`, `TerminalSharedWorkflowFence-test.ts`, `RuntimeCheckpointStartup-test.ts` |
| T | Pending completion recovery | A supported takeover recovers a pending completion with no writer, publishes terminal state once, completes the request, and explicitly releases authority, including lost-response recovery. | `RuntimeTerminalConvergenceIntegration-test.ts`, `RuntimeCheckpointStartup-test.ts` |
| U | Heartbeat/lease lifecycle | Heartbeat starts only with authority and stops on completion, authority/session loss, or conflict; healthy foreground/background preserves authority when designed to. | `RuntimeCheckpointStartup-test.ts`, `RuntimeLeaseLifecycleTrace-test.ts` |
| V | Package immutability | Published package versions are immutable; material changes require new versions and frozen hashes. | `IroPackageImmutability-test.ts`, `ExercisePackageFramework-test.ts` |
| W | Package hash freeze | Accepted IRO, trauma, dataset, definition, and historical hashes remain exact. | `IroPackageImmutability-test.ts`, `NarvaIroScenarioControlCommand-test.ts` |
| X | Restart determinism | Supported medications, access/resources, ventilation, faults, HOLD/RESUME, ownership, command cursor, and session time restore without duplicate or phantom state. | `NarvaIroPackage-test.ts`, `RuntimeCheckpointStartup-test.ts`, `ClinicalTreatmentUI-test.tsx` |
| Y | Multi-CM | CM-A ownership is isolated from CM-B; non-writer commands route through the sole writer; supported transfer updates both projections without creating another writer. | `SharedWorkflowConcurrency-test.ts`, `CmOwnershipProjectionRestore-test.ts`, `RuntimePatientCommandConcurrency-test.ts` |
| Z | Physical acceptance policy | Authority, persistence, canonical restore/publication, durable routing, convergence/time, ownership, native control activation, restart, and terminal changes require a scoped physical gate before release. | `MultiDeviceRehearsalPreparation-test.ts`, `SharedWorkflowValidationHarness-test.ts` |

Exact paths and group membership are maintained in the executable manifest. A missing referenced test or incomplete A–Z/H01–H16 catalog fails `RuntimeRegressionGuardrailsManifest-test.ts`.

## Performance and physical acceptance

Existing persistence thresholds are release constraints and must not be raised to make a feature pass. Changes to a threshold require explicit architecture evidence and review. Canonical restore, publication request size, large terminal payload behavior, and event-loop responsiveness remain guarded.

Physical acceptance is mandatory before release when a change affects Runtime authority, checkpoint persistence, canonical restore/publication, durable command routing, reader convergence, simulation-time semantics, CM ownership projection, live React Native control activation, restart, or terminal completion. A physical Samsung plus emulator may prove an explicitly narrow gate. Two physical Samsungs remain required wherever the release plan designates final two-device acceptance.

## Mandatory feature checklist

- [ ] Classify the feature impact before implementation.
- [ ] Preserve the single-writer invariant and reader lease/heartbeat prohibition.
- [ ] Preserve reader convergence and coherent snapshot hydration.
- [ ] Preserve durable intent time and run true-stale negative tests.
- [ ] Preserve ownership authority/readiness and multi-CM isolation.
- [ ] Preserve exactly-once effects and patient revision/CAS.
- [ ] Prove cold-restart, reconnect, and foreground behavior where state persists.
- [ ] Prove mounted/live UI projection and native interaction paths where UI changes.
- [ ] Preserve canonical trust, zero reader recanonicalization, and legacy compatibility.
- [ ] Preserve canonical-primary publication sizes and large-payload thresholds.
- [ ] Preserve completion fencing, terminal finalization, heartbeat stop, and explicit lease release.
- [ ] Preserve package immutability and exact configured hashes.
- [ ] Run impacted guardrail groups, required cross-regressions, Runtime Hardening, and the full release checks.
- [ ] Decide and document the required physical acceptance scope.

## Feature impact classification

| Feature touches | Mandatory guardrail groups / focused invariants |
| --- | --- |
| UI only | Runtime group; K/L; restart/projection tests if the UI is hydrated or live; physical control activation for native live controls |
| Clinical engine | Runtime group; C–H, K, X; clinical/package cross-regressions and Runtime Hardening |
| Durable commands | Runtime + multi-device groups; A–H, S, Y; no-writer, lag, replay, retry, and exactly-once physical decision |
| Persistence | Persistence + multi-device groups; A–C, M–U, X; unchanged performance gate and physical restore/publication decision |
| Multi-device | Runtime + multi-device groups; A–J, U, Y; narrow or full physical topology acceptance |
| Package content | Runtime group plus package suites; V/W/X; new immutable version and frozen hashes; clinical physical acceptance as applicable |
| Terminal lifecycle | Persistence + multi-device groups; A, M–U; pending/lost-response recovery and physical terminal acceptance |

When a feature spans rows, use the union; do not select the least expensive row.

## Executing guardrails

```text
npm run test:runtime-guardrails
npm run test:multi-device-guardrails
npm run test:persistence-guardrails
npm run test:guardrails
```

`test:guardrails` runs the deduplicated union. The manifest-backed runner validates every selected path before starting Jest, so moving or deleting a canonical regression cannot silently reduce coverage.

Required release checks remain the unchanged persistence-performance test, Runtime Hardening, the complete Jest suite, TypeScript, ESLint, and `git diff --check`.

## Historical blocker mapping

| ID | Physical failure class | Guardrail | Permanent regression | Physical gate |
| --- | --- | --- | --- | --- |
| H01 | Queued Fibryga `INVALID_ADMINISTRATION` | F/G | `ClinicalTreatmentRuntimePatientCommandMaterializer-test.ts` | Two-device durable-treatment rehearsal |
| H02 | Queued TXA `STALE_SIMULATION_TIME` | D/F/G | `ClinicalTreatmentRuntimePatientCommandMaterializer-test.ts`, `RuntimePatientCommandConcurrency-test.ts` | Reader-to-writer intent-time gate |
| H03 | Reader stale checkpoint time | B/C | `RuntimeReaderConvergence-test.ts` | Cold-reader convergence gate |
| H04 | `exercise_states` stale echo downgrade | B/K | `RemoteClinicalSync-test.ts`, `RuntimeCheckpointStartup-test.ts` | Reader reconnect/foreground gate |
| H05 | TXA JSONB key-order restore failure | C/X | `TranexamicAcid-test.ts`, `NarvaIroPackage-test.ts` | Restart state-rehydration gate |
| H06 | Post-restart command facade unavailable | B/J/X | `ClinicalTreatmentUI-test.tsx`, `RuntimeCheckpointStartup-test.ts` | Post-restart reader-command gate |
| H07 | IRO fault controls missing durable route | G/K | `NarvaIroScenarioControlCommand-test.ts`, `NarvaIroScenarioControlsCard-test.tsx` | EXCON control-activation gate |
| H08 | IRO EXCON panel stale projection | K | `NarvaIroScenarioControlsCard-test.tsx`, `ResourceRuntimeDebugService-test.ts` | Mounted-card live-convergence gate |
| H09 | Android Pressable activation failure | L | `NarvaIroScenarioControlsCard-test.tsx`, `InteractionSafety-test.ts` | Ordinary physical press-activation gate |
| H10 | Reader local checkpoint outranking durable remote | B/M | `RuntimeCheckpointAuthority-test.ts`, `RuntimeCheckpointStartup-test.ts` | Cold-reader remote-authority gate |
| H11 | Hermes restore canonicalization performance | M/N | `PersistedCanonicalCheckpointPerformance-test.ts`, `RuntimeLargeCheckpointRestore-test.ts`, `RuntimeCheckpointCanonicalArtifact-test.ts` | Retained multi-megabyte checkpoint restore |
| H12 | Duplicated canonical and structured publication | P/Q | `RuntimeCheckpointRepository-test.ts`, `RuntimeTerminalCheckpointRepository-test.ts` | Large terminal-publication recovery |
| H13 | Post-restart CM ownership projection loss | I/J/Y | `CmOwnershipProjectionRestore-test.ts`, `CmOwnershipProjectionPresentation-test.ts` | Self-owned patient restart/open gate |
| H14 | READY reader rejected behind continuously advancing writer | D/E/H | `ClinicalTreatmentRuntimePatientCommandMaterializer-test.ts` | Reader-intent lag gate |
| H15 | HOLD/RESUME near an irreversible threshold lost a timely durable CORRECT intent to materialization latency | D/G/L/X | `NarvaIroScenarioControlCommand-test.ts`, `NarvaIroScenarioRuntime-test.ts`, `NarvaIroScenarioControlsCard-test.tsx` | Two-device near-threshold RESUME/CORRECT gate |
| H16 | Lost publication response followed by a same-lineage CAS conflict manufactured publication authority loss and stranded accepted durable commands | A/G/P/U | `RuntimeCheckpointPublication-test.ts`, `RuntimeCheckpointPublicationValidationHarness-test.ts`, `RuntimeCheckpointStartup-test.ts` | Same-lineage lost-response reconciliation gate |
| H17 | MTP calcium became due after only three qualifying RBC doses | C/G/K/X | `MtpCalciumReplacement-test.ts`, `GlobalTransfusionCalciumCounter-test.ts` | Single-device third-to-fourth MTP-dose boundary gate |

No historical blocker may be removed from the manifest or left without an executable regression and a documented physical acceptance boundary.

## Frozen IRO identity

- Package: `russicaptor.narva-iro-evacuation@1.0.1`
- Package hash: `da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95`
- Definition hash: `6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0`

## Future work-package statement

> All RussiCaptor Runtime Regression Guardrails are mandatory acceptance gates for this work package. Determine impacted guardrail classes before implementation. No guardrail may be weakened, bypassed, deleted, or threshold-relaxed. Run the impacted guardrail suites plus full required release checks before declaring PASS.
