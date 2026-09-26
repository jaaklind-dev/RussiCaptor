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
| U | Heartbeat/lease lifecycle | Heartbeat starts only with authority and stops on completion, authority/session loss, or conflict; transient transport failure keeps bounded recovery alive, confirmed expiry fails closed, and healthy foreground/background preserves authority when designed to. | `RuntimeCheckpointStartup-test.ts`, `RuntimeLeaseLifecycleTrace-test.ts`, `RuntimeWriterLeaseContinuity-test.ts` |
| V | Package immutability | Published package versions are immutable; material changes require new versions and frozen hashes. | `IroPackageImmutability-test.ts`, `ExercisePackageFramework-test.ts` |
| W | Package hash freeze | Accepted IRO, trauma, dataset, definition, and historical hashes remain exact. | `IroPackageImmutability-test.ts`, `NarvaIroScenarioControlCommand-test.ts` |
| X | Restart determinism | Supported medications, access/resources, ventilation, faults, HOLD/RESUME, ownership, command cursor, and session time restore without duplicate or phantom state. | `NarvaIroPackage-test.ts`, `RuntimeCheckpointStartup-test.ts`, `ClinicalTreatmentUI-test.tsx` |
| Y | Multi-CM | CM-A ownership is isolated from CM-B; non-writer commands route through the sole writer; supported transfer updates both projections without creating another writer. | `SharedWorkflowConcurrency-test.ts`, `CmOwnershipProjectionRestore-test.ts`, `RuntimePatientCommandConcurrency-test.ts` |
| Z | Physical acceptance policy | Authority, persistence, canonical restore/publication, durable routing, convergence/time, ownership, native control activation, restart, and terminal changes require a scoped physical gate before release. | `MultiDeviceRehearsalPreparation-test.ts`, `SharedWorkflowValidationHarness-test.ts` |

Exact paths and group membership are maintained in the executable manifest. A missing referenced test or incomplete A–Z/H01–H18/PROC-G01–PROC-G22/IMG-G01–IMG-G45/LAB-G01–LAB-G46 catalog fails `RuntimeRegressionGuardrailsManifest-test.ts`.

## Procedure availability regression guardrails

Procedure definitions and physical resources are reusable Runtime capabilities, not clinical authorization. For packages with an explicit availability contract, the bound package and patient identity determine which procedures are offered and accepted; package-wide treatments remain governed by their existing package palette.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| PROC-G01 | Package/patient ownership | Procedure availability derives from the bound package and patient identity. |
| PROC-G02 | Resource is not authorization | A compatible assigned resource does not authorize a procedure omitted by package policy. |
| PROC-G03 | Pelvic denies chest procedure | PT-PELVIC-001 cannot execute chest drainage. |
| PROC-G04 | Chest denies pelvic procedure | PT-CHEST-001 cannot execute pelvic binder application. |
| PROC-G05 | Allowed procedure executable | A source-backed allowed procedure remains executable through the existing Runtime. |
| PROC-G06 | UI/command policy alignment | UI projection and command authorization consume the same package-owned policy. |
| PROC-G07 | Direct bypass rejected | Direct service and durable materializer paths reject unauthorized procedures. |
| PROC-G08 | Restore determinism | Cold restore derives identical availability without persisting redundant mutable state. |
| PROC-G09 | Package isolation | Narva procedure availability cannot leak to or from unrelated packages. |
| PROC-G10 | Reader no local bypass | Readers route through durable authorization and cannot mutate availability locally. |
| PROC-G11 | Terminal fencing | Existing terminal fencing continues to reject patient commands after completion. |
| PROC-G12 | Package-wide treatments preserved | Patient procedure scoping does not narrow intentional treatment or MTP availability. |
| PROC-G13 | ETT durable command path | Production ETT UI submits only through the Runtime patient-command inbox. |
| PROC-G14 | ETT exactly once | One durable command identity creates at most one airway intervention and evidence event. |
| PROC-G15 | Reader no local intubation | Reader acceptance does not mutate airway state; the writer materializes it. |
| PROC-G16 | Stale-reader fence | ETT enablement and submission use shared durable command readiness. |
| PROC-G17 | Takeover recovery | A takeover writer consumes an accepted unmaterialized ETT command exactly once. |
| PROC-G18 | Restart determinism | Restore preserves ETT state and replay cannot duplicate it. |
| PROC-G19 | Terminal fencing | Completion fencing rejects new ETT commands before acceptance. |
| PROC-G20 | Package/patient enforcement | ETT materialization enforces the package-owned patient allowlist. |
| PROC-G21 | Ventilation prerequisite | Canonical active ETT remains the existing mechanical-ventilation prerequisite. |
| PROC-G22 | No direct production bypass | Production ETT UI has no direct Runtime-owner mutation path. |

## Imaging regression guardrails

Package-owned Imaging uses the existing order, delayed workflow, persistence, and UI paths. Legacy static demo Imaging remains available only to the demo baseline and is deliberately removed from canonical package bootstrap; patient-ID equality never establishes ownership.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| IMG-G01 | Package ownership | Predefined Imaging definitions come only from the authoritative exercise package/dataset binding. |
| IMG-G02 | No patient-ID leakage | Equal patient IDs across packages cannot implicitly share predefined Imaging. |
| IMG-G03 | Botulism installation | The canonical Botulism package installs the authored P09, P11, and P12 chest X-rays and orders. |
| IMG-G04 | Botulism exclusion | Other Botulism patients receive no unrelated predefined Imaging. |
| IMG-G05 | Narva isolation | Narva packages remain Imaging-empty unless explicitly configured by authoritative package-owned source content. |
| IMG-G06 | Workbook compatibility | Established workbook Imaging and order mapping remains functional. |
| IMG-G07 | Package/workbook equivalence | Overlapping Botulism package and workbook definitions remain semantically equivalent. |
| IMG-G08 | Checkpoint isolation | Cold restore retains only the exercise package's persisted Imaging collection. |
| IMG-G09 | Deterministic installation | Repeated package installation or hydration cannot duplicate Imaging studies or orders. |
| IMG-G10 | Stable identifiers | Package-owned study and order IDs remain deterministic across installation and restore. |
| IMG-G11 | Durable instance identity | Every execution has stable command-derived identity separate from its definition. |
| IMG-G12 | Exactly-once order | Replaying a command cannot duplicate an instance. |
| IMG-G13 | Writer-only mutation | Readers cannot mutate the authoritative lifecycle. |
| IMG-G14 | Simulation threshold | Release uses authoritative simulation time and configured delay. |
| IMG-G15 | No early release | No released result exists before `availableAt`. |
| IMG-G16 | Jump-safe release | A time jump across the threshold releases exactly once. |
| IMG-G17 | Immutable result | Released payload and timestamp never change. |
| IMG-G18 | Restart determinism | Cold restore preserves lifecycle state exactly. |
| IMG-G19 | Takeover determinism | A takeover releases overdue work once. |
| IMG-G20 | Repeat separation | Repeat orders create distinct instances. |
| IMG-G21 | Same-command idempotency | Replaying a repeat command creates no extra instance. |
| IMG-G22 | Reader no generation | Readers do not generate orders or results. |
| IMG-G23 | Terminal fencing | Terminal state blocks new and prohibited late mutations. |
| IMG-G24 | Provenance stability | Package/definition identity and captured source remain stable. |
| IMG-G25 | Checkpoint no duplication | Restore preserves every instance without duplication. |
| IMG-G26 | Narva package ownership | The approved Narva study belongs only to `russicaptor.narva-trauma@1.0.1`. |
| IMG-G27 | Approved chest content only | PT-CHEST-001 receives exactly the approved P02 chest X-ray and no additional study. |
| IMG-G28 | Pelvic patient remains empty | PT-PELVIC-001 has no source-defined Imaging. |
| IMG-G29 | No Botulism leakage | Narva bootstrap cannot install Botulism Imaging content. |
| IMG-G30 | No demo leakage | Narva bootstrap cannot install legacy demo Imaging content. |
| IMG-G31 | Narva source fidelity | Modality, title, report and seven-minute delay equal the approved canonical workbook source. |
| IMG-G32 | Narva deterministic identity | Bootstrap and restore retain the same P02 study/order definition identity exactly once. |
| IMG-G33 | IRO isolation | The Narva IRO package remains Imaging-empty. |
| IMG-G34 | No speculative Narva content | No asset, extra study or unauthored report field is invented for Narva. |
| IMG-G35 | Released report provenance | Every result identifies its durable instance, definition, patient and exact package source. |
| IMG-G36 | Immutable released asset | A RESULTED asset reference cannot change after release. |
| IMG-G37 | Bundled asset identity | Every bundled asset has stable semantic identity distinct from its resolver path. |
| IMG-G38 | Bundled asset integrity | Registered bundled bytes match the frozen SHA-256, media type and optional byte length. |
| IMG-G39 | No checkpoint binary | Checkpoints persist only asset metadata/reference identity, never image bytes. |
| IMG-G40 | Report-only validity | A released report without an asset is a complete valid result. |
| IMG-G41 | No pre-release exposure | Authored report source and asset are not exposed as a released result before RESULTED. |
| IMG-G42 | Package asset isolation | Asset provenance must match its package and study definition. |
| IMG-G43 | Asset restore determinism | Restart and takeover preserve the exact released asset reference. |
| IMG-G44 | Reader asset convergence | Readers restore asset metadata without local generation or mutation. |
| IMG-G45 | Unsupported attachment safety | Unregistered workbook paths and URLs remain explicitly unresolved and never become trusted assets. |

## Laboratory regression guardrails

The durable laboratory lifecycle, the versioned Narva trauma/Astrup physiology-v1 generator, deterministic static/scenario results, and canonical result presentation are executable and mapped in the guardrail manifest. The tests below protect catalog scope, sample-time snapshots, timing, physiology directionality, presentation fidelity, persistence, authority, exactly-once behavior, and terminal fencing.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| LAB-G01 | Sample snapshot immutability | A collected sample retains an immutable authoritative physiological source snapshot. Later transfusion, calcium, fluids, ventilation, hemorrhage, restart, or takeover cannot alter it retroactively. |
| LAB-G02 | Result uses sample time | Results reflect physiology at `sampledAt`, never physiology at `resultAvailableAt`. |
| LAB-G03 | Exactly-once order/sample/result | Retry, reconnect, rerender, restart, and takeover cannot duplicate an order, sample, result, or result-group release. |
| LAB-G04 | Single writer authority | Only authoritative Runtime authority advances laboratory state. Readers use supported durable commands and never generate authoritative results locally. |
| LAB-G05 | Reader convergence | Readers converge on identical order, sample time, availability time, result payload, and status without local result generation. |
| LAB-G06 | Restart/takeover determinism | A persisted sample produces the same result after app, writer, or reader restart and writer takeover, without rerandomization or later-state recomputation. |
| LAB-G07 | Timing persistence | Result countdowns are fixed relative to sample time and do not reset during restart or takeover. |
| LAB-G08 | No early release | No result group becomes `RESULTED` before its configured availability time. |
| LAB-G09 | Independent result groups | Releasing one group cannot release another early or modify any group's sample snapshot. |
| LAB-G10 | Terminal fencing | Established terminal semantics prevent new laboratory progression, new results, prohibited pending release, and workflow resurrection. |
| LAB-G11 | Package scope | Laboratory exposure remains within the frozen EMO trauma and IRO scopes below. |
| LAB-G12 | AB0 identity stability | Patient AB0/RhD identity cannot change through repeated sampling, restart, or takeover. |
| LAB-G13 | Dynamic physiology source of truth | Astrup, lactate, iCa, glucose, Hb/Hct, platelets, INR/APTT/fibrinogen, and Na/K derive from authoritative physiology/state, not UI-local calculations. |
| LAB-G14 | MTP/iCa coherence | Dynamic iCa and the MTP calcium recommendation are separate mechanisms: neither the fourth-RBC protocol trigger nor low iCa may substitute for the other state variable. |
| LAB-G15 | No local recalculation of resulted sample | A `RESULTED` sample and result payload are immutable and cannot be regenerated from current physiology. |
| LAB-G16 | Canonical persistence | Laboratory persistence creates no reader-local revisions, restores deterministically, accepts authoritative persisted state, and introduces no semantic drift through recanonicalization. |
| LAB-G17 | Stable lab action identity under rehydration | Reader/writer checkpoint rehydration, rerender, reconnect, or projection replacement cannot change the semantic meaning of an in-progress laboratory action gesture or create duplicate or cross-action durable commands. |
| LAB-G18 | Latched lab action intent | Once a laboratory gesture begins, its ORDER or COLLECT intent is immutable for that gesture. Rehydration may invalidate and abort it, but can never substitute the other semantic action. |
| LAB-G19 | Valid lab gesture reaches durable submit | An action valid at gesture start attempts exactly one durable submission despite stale checkpoint or projection rehydration; only a provably newer incompatible authoritative state may abort it. |
| LAB-G20 | Physical lab press delivery survives rehydration | A visible enabled laboratory action retains one mounted native touch target across ordinary rehydration. Its gesture reaches press-in and exactly one latched durable submission or an explicit newer-authority invalidation; silent gesture loss is forbidden. |
| LAB-G21 | Lab action enablement requires command-ready reader state | Laboratory ORDER and COLLECT controls are enabled only when the shared durable patient-command path is ready. Authoritative checkpoint reconciliation keeps the stable semantic control disabled until readiness returns automatically. |
| LAB-G22 | Result release after available-at threshold crossing | Once authoritative simulation time reaches or exceeds a valid non-terminal result group's `availableAtSimulationTimeSec`, the writer releases it exactly once. Large jumps, restart, takeover, or later supported clinical steps cannot strand it in processing. |
| LAB-G23 | Complete POLÜTRAUMA package | Every source-supported reportable POLÜTRAUMA component is represented and explicit Narva exclusions remain absent. |
| LAB-G24 | Deterministic static generation | Static baseline analytes are deterministic for the same patient and immutable sample snapshot without random, wall-clock, device, or reader-local inputs. |
| LAB-G25 | Scenario-derived result stability | An explicit authoritative sample-time scenario override wins only for supported static analytes and remains stable after later scenario change. |
| LAB-G26 | Blood-bank identity persistence | AB0, RhD, and antibody-screen identity is patient-stable across samples, restart, takeover, and rehydration. |
| LAB-G27 | hCG applicability | hCG is reported only when an authoritative patient applicability fact exists; missing demographic evidence is represented as not applicable, never an invented positive. |
| LAB-G28 | Narva exclusions | SARS-CoV-2, influenza, urine analyses, and U-Narco remain absent from the Narva POLÜTRAUMA result. |
| LAB-G29 | Complete CBC coverage | The hematology group contains all CBC/5-diff/NRBC components derived from the authoritative IVKH reference export while Hb, Hct, and platelets remain physiology-driven. |
| LAB-G30 | Source unit/reference fidelity | Source codes, units, references, conditionality, and explicit ambiguities are preserved exactly where authoritative source metadata exists; gaps are not invented. |
| LAB-G31 | Static/scenario sample immutability | Static, demographic, blood-bank, and scenario-derived results use only the immutable collection snapshot and cannot change after later treatment or scenario progression. |
| LAB-G32 | Static restart/takeover determinism | Pending and released B31 results survive restart and produce identical payloads through writer takeover without regeneration drift. |
| LAB-G33 | Reader restriction for B31 results | Readers may display persisted B31 payloads but cannot generate, revise, or release them locally. |
| LAB-G34 | Independent complete result groups | Astrup, hematology, blood bank, clinical chemistry, and coagulation retain independent sampledAt-anchored release boundaries after complete package generation. |
| LAB-G35 | Complete result UI reachability | Every canonical reportable result remains reachable in the laboratory presentation without silent omission. |
| LAB-G36 | Deterministic result-group order | Laboratory result groups render in canonical package order across rerender, rehydration, and restart. |
| LAB-G37 | Deterministic analyte order | Analytes render in canonical catalog order within their result group, independent of payload transport order. |
| LAB-G38 | Valid-reference abnormal flags | Numeric LOW, HIGH, and normal flags derive only from one valid authoritative numeric range and include non-color semantics. |
| LAB-G39 | No invented abnormal flag | Missing, qualitative, demographic-ambiguous, or source-ambiguous reference metadata cannot produce an invented abnormal flag. |
| LAB-G40 | Qualitative result presentation | AB0, RhD, antibody screen, and other canonical qualitative values render as qualitative results rather than malformed numbers. |
| LAB-G41 | hCG presentation applicability | Canonical hCG results render only when applicable; not-applicable state never displays a fabricated numeric value. |
| LAB-G42 | SOURCE_AMBIGUOUS presentation | Source-ambiguous components remain explicitly unresolved and cannot be mistaken for completed measurements. |
| LAB-G43 | Pending result-group presentation | Processing groups remain visibly pending without fake values and transition once to their canonical released result. |
| LAB-G44 | Stable result-row identity | Group and analyte keys derive from canonical identities rather than revisions, indexes, or render order. |
| LAB-G45 | Presentation rehydration consistency | The same canonical result renders identically after rerender and checkpoint rehydration without duplicates or ordering drift. |
| LAB-G46 | Presentation canonical immutability | Grouping, ordering, expansion, and abnormal classification never mutate the canonical laboratory payload. |

### Frozen Narva laboratory timing contract

Availability is measured from sample collection time: Astrup 25 minutes; Hematology 30 minutes; AB0/RhD plus antibody screen 30 minutes; Clinical chemistry 40 minutes; Coagulation 40 minutes. Result release time never changes the frozen sample-time physiological source.

### Frozen laboratory package scope

- EMO/trauma includes the POLÜTRAUMA laboratory package and excludes SARS-CoV-2, influenza, all urine analyses, and U-Narco.
- IRO exposes Astrup only.

### Mandatory statement for every future laboratory WP

> All RussiCaptor Runtime Regression Guardrails, including Laboratory Regression Guardrails LAB-G01 through LAB-G46, are mandatory acceptance gates for this work package. Determine impacted guardrail classes before implementation. No guardrail may be weakened, bypassed, deleted, or threshold-relaxed.

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
| H18 | EXCON-only Runtime patient lacked a durable shared-workflow head and patient commands failed closed | A/G/H/I/S/U/Y | `SharedWorkflowHeadInitialization-test.ts`, `RuntimeCheckpointStartup-test.ts` | Existing-fixture workflow-head initialization and one-command smoke gate |

No historical blocker may be removed from the manifest or left without an executable regression and a documented physical acceptance boundary.

## Frozen IRO identity

- Package: `russicaptor.narva-iro-evacuation@1.0.1`
- Package hash: `da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95`
- Definition hash: `6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0`

## Future work-package statement

> All RussiCaptor Runtime Regression Guardrails are mandatory acceptance gates for this work package. Determine impacted guardrail classes before implementation. No guardrail may be weakened, bypassed, deleted, or threshold-relaxed. Run the impacted guardrail suites plus full required release checks before declaring PASS.
