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

Exact paths and group membership are maintained in the executable manifest. A missing referenced test or incomplete A–Z/H01–H20/CHK-G01–CHK-G12/WF-CAN-G01–WF-CAN-G12/CM-HEAD-G01–CM-HEAD-G12/READINESS-G01–READINESS-G12/TRANS-G01–TRANS-G24/PATCOMP-G01–PATCOMP-G24/PROC-G01–PROC-G42/Q-G01–Q-G10/SRC-G01–SRC-G30/IMG-G01–IMG-G45/IMG-ASSET-G01–IMG-ASSET-G16/IMG-AUTH-G01–IMG-AUTH-G16/LAB-G01–LAB-G46 catalog fails `RuntimeRegressionGuardrailsManifest-test.ts`.

## Scoped CM reader workflow-head guardrails

Canonical workflow-head creation remains writer-owned. An ordinary exercise-scoped CM consumes validated reader state and may submit durable intent, but never acquires writer authority as an implicit readiness side effect.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| CM-HEAD-G01 | Scoped reader head resolution | A CM resolves writer-created canonical workflow heads without initializing them. |
| CM-HEAD-G02 | Reader command readiness | A converged scoped CM becomes command-ready. |
| CM-HEAD-G03 | Reader durable submit | A ready scoped CM may submit durable patient intent. |
| CM-HEAD-G04 | Reader no materialization | A CM reader cannot acquire writer authority or materialize canonical state locally. |
| CM-HEAD-G05 | Writer exactly once | The writer consumes each accepted reader command once. |
| CM-HEAD-G06 | No EXCON workaround | Normal CM submission needs no temporary EXCON role. |
| CM-HEAD-G07 | Wrong exercise denied | Role authority remains bound to its exercise. |
| CM-HEAD-G08 | Late head readiness | Readers fail closed until canonical state arrives, then become ready. |
| CM-HEAD-G09 | Late role readiness | A late scoped assignment retriggers startup evaluation. |
| CM-HEAD-G10 | Takeover/reconnect convergence | Foreground, reconnect and authority changes retrigger canonical reader convergence. |
| CM-HEAD-G11 | Stale denial cleared | A historical initialization denial cannot survive successful reader convergence. |
| CM-HEAD-G12 | No GLOBAL role | Exercise-scoped readiness and submission require no GLOBAL assignment. |

## CM reader command-readiness reconciliation guardrails

Reader readiness combines authoritative checkpoint convergence with scoped workflow ownership. Restoring the same immutable package binding is not a semantic package change and must not tear down a healthy reader generation. Genuine disconnection, scope mismatch, stale authority, or terminal state remains fail-closed.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| READINESS-G01 | Hydrated reader allowed | A valid hydrated exercise-scoped CM reader becomes command-ready. |
| READINESS-G02 | Stale reconnect clears | Authoritative hydration clears a historical reconnect reason. |
| READINESS-G03 | Claim recompute | Successful patient claim projection updates cannot strand command readiness. |
| READINESS-G04 | Checkpoint/head recompute | Canonical revision updates re-evaluate readiness without restarting a healthy reader. |
| READINESS-G05 | Late role recompute | A late scoped role retries incomplete bootstrap without disturbing a healthy reader. |
| READINESS-G06 | Reconnect/foreground refresh | Reconnect and foreground refresh metadata without permanently latching reconnect state. |
| READINESS-G07 | Takeover generation refresh | Writer-generation changes fence temporarily and restore readiness after convergence. |
| READINESS-G08 | Disconnected reader blocked | A genuinely disconnected reader remains fail-closed. |
| READINESS-G09 | Wrong scope denied | Exercise scope remains mandatory for reader command authority. |
| READINESS-G10 | Terminal state blocked | Terminal patients and exercises reject new durable commands. |
| READINESS-G11 | Reader no local mutation | Reader submission cannot materialize clinical state or publish writer state locally. |
| READINESS-G12 | Imaging writer exactly once | One ready-reader Imaging intent is materialized once by the canonical writer. |

## Equal-revision takeover checkpoint guardrails

Revision equality is not canonical equality. A lease-free writer candidate must compare the stable canonical payload hash and adopt durable remote authority before requesting a lease whenever an equal revision carries different content.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| CHK-G01 | Equal revision and hash | Equal revision plus equal canonical hash is safe equivalence. |
| CHK-G02 | Equal-revision divergence | Equal revision plus different canonical hash is an explicit conflict. |
| CHK-G03 | No divergent publication | A divergent local candidate cannot acquire publication authority before reconciliation. |
| CHK-G04 | Remote canonical wins | Durable remote state owns equal-revision conflict recovery. |
| CHK-G05 | Timeline preservation | Remote rebase retains canonical timeline evidence exactly once. |
| CHK-G06 | Lifecycle preservation | Remote rebase cannot regress PAUSED or terminal lifecycle to RUNNING. |
| CHK-G07 | Patient-state preservation | Remote rebase retains canonical patient location and clinical state. |
| CHK-G08 | Durable-command preservation | Remote rebase retains the canonical durable command cursor and effects. |
| CHK-G09 | Rebase failure fence | Failed or incomplete rebase blocks lease acquisition and publication. |
| CHK-G10 | Restart before takeover | Restart reconciles remote canonical state before writer candidacy. |
| CHK-G11 | Concurrent takeover | Repository CAS permits at most one writer and preserves one canonical lineage. |
| CHK-G12 | Stale writer rejection | A stale client cannot restore or publish its divergent equal-revision payload. |

## Shared-workflow/canonical checkpoint reconciliation guardrails

The validated Runtime checkpoint owns clinical patient state. Shared workflow owns patient assignment and ownership coordination; its patient projection may advance Runtime fields only through an accepted local mutation proposal and may never regress checkpoint-restored content during hydration.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| WF-CAN-G01 | Checkpoint outranks stale head | Checkpoint-restored Runtime state outranks a conflicting workflow payload. |
| WF-CAN-G02 | Divergent head detected | Semantic divergence is detected in protected patient fields and collection identities. |
| WF-CAN-G03 | Evidence cannot disappear | Workflow hydration cannot remove canonical timeline evidence. |
| WF-CAN-G04 | Lifecycle cannot regress | Workflow hydration cannot regress canonical lifecycle ownership. |
| WF-CAN-G05 | Location cannot regress | Workflow hydration cannot replace canonical patient location with a stale value. |
| WF-CAN-G06 | Durable effects preserved | Workflow hydration cannot erase durable command effects or cursor lineage. |
| WF-CAN-G07 | Ownership still converges | Valid owner, assignment and transfer metadata remain workflow-owned. |
| WF-CAN-G08 | Field authority matrix | Conflicting Runtime fields select ownership-only reconciliation, never broad replacement. |
| WF-CAN-G09 | Reconcile before publication | Accepted durable materialization reflects through the workflow head before publication. |
| WF-CAN-G10 | Restart preserves checkpoint | Cold restart with a stale workflow head preserves checkpoint-restored Runtime content. |
| WF-CAN-G11 | Reconciliation idempotent | Repeating the same reconciliation cannot duplicate or remove state. |
| WF-CAN-G12 | Competing takeover safety | Repository authority remains single-writer while takeover preserves canonical lineage. |

## Transport lifecycle regression guardrails

Transport start is a durable patient command. Only the authoritative writer materializes it, accepted simulation time anchors every phase, and checkpoint restore/takeover must preserve each active phase without duplicate evidence.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| TRANS-G01 | Durable production path | Production transport submission uses the Runtime patient-command inbox. |
| TRANS-G02 | No direct client fallback | Missing durable command authority fails closed without local transport mutation. |
| TRANS-G03 | Accepted intent time | Start timestamps and deadlines use accepted durable simulation time. |
| TRANS-G04 | Same-command exactly once | One command identity creates at most one transport and evidence sequence. |
| TRANS-G05 | Stale readiness fence | Stale or reconciling clients cannot offer or submit transport. |
| TRANS-G06 | Stable destination intent | Rehydration cannot substitute IVKH, PERH, or another destination after intent begins. |
| TRANS-G07 | Single in-flight intent | Repeated activation while submitting creates no second durable command. |
| TRANS-G08 | Restart in transit | Outbound identity, location and deadline survive restart. |
| TRANS-G09 | Restart in handover | Arrival and handover resume deterministically and emit once. |
| TRANS-G10 | Restart return/turnaround | Vehicle availability retains its original return and turnaround thresholds. |
| TRANS-G11 | Active takeover | A takeover restores the active phase without reset or duplicate transport. |
| TRANS-G12 | Takeover threshold exactly once | Arrival, handover and availability threshold evidence emits once after takeover. |
| TRANS-G13 | Reader no local mutation | Readers submit durably and receive canonical transport only through publication. |
| TRANS-G14 | Terminal fence | Completion fencing rejects later starts and deterministically drains prior accepted commands. |
| TRANS-G15 | Cancellation unsupported | Current production exposes no misleading unreachable cancellation action. |
| TRANS-G16 | Completion independence | Transport phases do not complete the patient or exercise. |
| TRANS-G17 | P02 loading equivalence | P02 loading is represented only by durable `TRANSPORT_START`. |
| TRANS-G18 | Single onboard evidence | Replay and restore preserve exactly one `PATIENT_ONBOARD` event. |
| TRANS-G19 | Single monitoring clock | Stationary monitoring uses the outbound phase deadline, not a second timer. |
| TRANS-G20 | Reanimobile location | P02 remains in `REANIMOBILE` until the arrival threshold. |
| TRANS-G21 | Source duration fidelity | The source-defined 30 minutes remains exactly 1800 simulation seconds. |
| TRANS-G22 | Staging restart | Restart preserves transport identity, deadline, location, and evidence cardinality. |
| TRANS-G23 | Staging takeover | Takeover crosses the arrival threshold exactly once. |
| TRANS-G24 | No duplicate staging authority | No separate loading/monitoring command, state, or clock duplicates transport authority. |

## Patient completion regression guardrails

Patient completion is a durable patient command. EXCON submits through the shared readiness-gated inbox; only the authoritative writer applies the canonical completion effects. Replay, restart, and takeover must preserve one completed state, one assignment removal, one pending-event cancellation outcome, and one evidence event. Transport and whole-exercise completion remain independent.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| PATCOMP-G01 | Durable production path | Production patient completion enters the Runtime patient-command inbox. |
| PATCOMP-G02 | No direct EXCON mutation | EXCON UI cannot directly mutate patient, assignment, scenario-event, or timeline state. |
| PATCOMP-G03 | Writer-only materialization | Only the authoritative writer materializes accepted patient completion. |
| PATCOMP-G04 | Same-command exactly once | One completion command identity completes the patient at most once. |
| PATCOMP-G05 | Single completion evidence | Replay, restart, and takeover cannot duplicate completion evidence. |
| PATCOMP-G06 | Scenario cancellation exactly once | Pending scenario events are cancelled once and historical resolved events remain intact. |
| PATCOMP-G07 | Assignment removal exactly once | Assignment removal remains canonical and idempotent after restore. |
| PATCOMP-G08 | Accepted-command recovery | Accepted completion survives writer absence and is consumed once after recovery. |
| PATCOMP-G09 | Takeover recovery | A takeover writer consumes accepted completion once. |
| PATCOMP-G10 | Already-completed idempotency | A later completion request has no duplicate effects. |
| PATCOMP-G11 | Exercise terminal fence | The exercise fence rejects later intents and drains accepted earlier work deterministically. |
| PATCOMP-G12 | Transport independence | Transport phases never complete the patient. |
| PATCOMP-G13 | Exercise independence | Patient completion never completes the exercise. |
| PATCOMP-G14 | Reader no local completion | Readers submit durably and never apply completion effects locally. |
| PATCOMP-G15 | Readiness fails closed | UI and tap-time submission reject while durable command readiness is unsafe. |
| PATCOMP-G16 | Completion clears canonical owner | Successful durable completion publishes an unowned canonical shared-workflow head. |
| PATCOMP-G17 | Completion closes assignment | Completion closes the canonical assignment with the completed reason exactly once. |
| PATCOMP-G18 | Release replay idempotency | Replay neither advances the released head nor duplicates assignment or evidence state. |
| PATCOMP-G19 | Reader cannot release locally | Reader submission changes neither patient lifecycle nor ownership before writer materialization. |
| PATCOMP-G20 | Takeover releases once | A takeover writer completes the accepted patient and deterministic ownership release once. |
| PATCOMP-G21 | Completed-unowned restore | Restart and reconciliation preserve Completed plus unowned state and repair the defined partial state. |
| PATCOMP-G22 | Stale owner cannot return | Older ownership projections cannot reclaim a completed unowned patient. |
| PATCOMP-G23 | Completion-release transport isolation | Ownership release does not mutate transport or resource lifecycle state. |
| PATCOMP-G24 | No stale-ownership completion fence | Fully materialized patient completion leaves no active owner or assignment to fence exercise finalization. |

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
| PROC-G23 | Shared readiness | Every durable intervention control consumes the shared command-readiness contract. |
| PROC-G24 | Stale projection disables | A stale or reconciling projection disables durable intervention actions. |
| PROC-G25 | Tap-time precheck | Durable submission rechecks readiness after render and before inbox acceptance. |
| PROC-G26 | No readiness bypass | Production controls cannot fall through to direct owner mutation. |
| PROC-G27 | Availability preserved | Shared readiness cannot re-enable a package/patient-forbidden procedure. |
| PROC-G28 | Stable action identity | Rehydration does not substitute one intervention intent for another. |
| PROC-G29 | In-flight single intent | Committing state suppresses duplicate durable submissions. |
| PROC-G30 | Reader/writer consistency | Reader and writer controls expose the same readiness semantics. |
| PROC-G31 | Terminal readiness fence | Terminal exercises are disabled in UI and rejected by submission. |
| PROC-G32 | Convergence recovery | Controls re-enable automatically after authoritative convergence. |
| PROC-G33 | Narva P02 oxygen availability | Only the source-backed P02 chest patient receives generic oxygen therapy. |
| PROC-G34 | Narva P01 no oxygen inheritance | P01 remains unauthorized for P02 oxygen therapy. |
| PROC-G35 | Oxygen resource is not authorization | Resource presence cannot bypass package/patient authorization. |
| PROC-G36 | Oxygen durable command path | Oxygen start and stop use durable `RESOURCE_APPLY` / `RESOURCE_STOP`. |
| PROC-G37 | Oxygen writer-only mutation | A reader cannot mutate oxygen physiology locally. |
| PROC-G38 | Oxygen stale-readiness fence | Shared command readiness fails closed while convergence is pending. |
| PROC-G39 | Oxygen exactly once | One durable command identity creates at most one oxygen intervention. |
| PROC-G40 | Oxygen restart determinism | Restore preserves active oxygen state and effect. |
| PROC-G41 | Oxygen takeover determinism | A takeover writer consumes accepted oxygen intent once. |
| PROC-G42 | Oxygen stop semantics | Existing stop semantics deterministically remove the oxygen effect. |

## Question regression guardrails

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| Q-G01 | Package ownership | Narva question definitions belong to an exact immutable package version. |
| Q-G02 | P01 mapping | Only PT-PELVIC-001 receives the two P01 questions. |
| Q-G03 | P02 mapping | Only PT-CHEST-001 receives the four P02 questions. |
| Q-G04 | No demo or cross-patient leakage | Narva patients receive no global demo or other-patient questions. |
| Q-G05 | Stable IDs | Workbook question IDs remain stable across bootstrap and restore. |
| Q-G06 | Deterministic ordering | Patient question order is stable and independent of installation order. |
| Q-G07 | Restore no duplication | Repeated installation and restore cannot duplicate questions. |
| Q-G08 | Interaction-state restore | Question visibility state survives shared-workflow restoration. |
| Q-G09 | Package isolation | Unrelated packages retain their established question behavior. |
| Q-G10 | Source wording fidelity | Prompt, answer, category, order and initial visibility match the workbook exactly. |

## Narva source-fidelity guardrails

| ID | Invariant | Required behavior |
| --- | --- | --- |
| SRC-G01 | Canonical workbook hash | Both workbook byte hashes and the approved semantic checksum remain exact. |
| SRC-G02 | Stable patient mapping | P01/P02 retain their neutral production patient mappings. |
| SRC-G03 | P02 oxygen fidelity | Oxygen remains source-mapped to P02 only. |
| SRC-G04 | Imaging fidelity | P02 CXR identity, title, report, and delay remain exact. |
| SRC-G05 | Question fidelity | Six questions retain exact patient scope and identity. |
| SRC-G06 | Pelvic binder mapping | P01 stabilization remains the canonical binder action. |
| SRC-G07 | Pleural drain mapping | P02 decompression remains the canonical chest-drain action. |
| SRC-G08 | P02 bleeding authority chain | Historical workbook 400 ml/h remains explicitly superseded by the current 200 ml/h user decision; production follows `currentAuthorityId`. |
| SRC-G09 | Unresolved items stay unresolved | Verified partial metadata cannot silently promote unresolved reportability, component mapping, or result semantics to `MATCH`. |
| SRC-G10 | No demo substitution | Demo/global content cannot satisfy a Narva mapping. |
| SRC-G11 | Historical versions immutable | Narva 1.0.1 through 1.0.4 remain preserved beside current 1.0.5. |
| SRC-G12 | Explicit drift report | Drift fails deterministically without exposing personal identifiers. |
| SRC-G13 | P02 loading equivalence | `P02-LOAD-REANIMOBILE` maps to the existing durable transport lifecycle. |
| SRC-G14 | P02 monitoring equivalence | `P02-TRANSPORT-MONITOR` maps to the single 1800-second outbound phase. |
| SRC-G15 | P02 priority assessment content | Exact P02-Q4 and P01-Q2 content satisfies the first-transport teaching intent. |
| SRC-G16 | No unauthorized hard priority | No priority, queue, precedence, or P01-first rejection exists without explicit authority. |
| SRC-G17 | Learner choice with consequence | Either patient may choose first; one exclusive vehicle blocks the concurrent second transport. |
| SRC-G18 | Transport semantics unchanged | Fidelity metadata introduces no assessment-specific transport branch. |
| SRC-G19 | P01 starting-location authority | P01 starts outdoors and package-owned `P01-MOVE-ED` implements the current source authority. |
| SRC-G20 | P01 durable internal transfer | The move to ED is durable, exactly once, and isolated from vehicle transport. |
| SRC-G21 | Scripted vital row inventory | All 11 approved Narva workbook vital IDs remain mapped exactly once. |
| SRC-G22 | T+0 baseline fidelity | P01-V0 and P02-V0 remain exact production baseline inputs. |
| SRC-G23 | Expected observation semantics | Five generic later rows remain descriptive `EXPECTED_OBSERVATION` metadata. |
| SRC-G24 | Source checkpoint semantics | Four phase-tagged rows remain `SOURCE_CHECKPOINT` metadata with identity-derived hints only. |
| SRC-G25 | Scripted vital value fidelity | Minute, HR, BP, RR, SpO2, temperature, GCS, and pain remain exact to the approved workbook. |
| SRC-G26 | No implicit later target | No later workbook row becomes an exact Runtime target. |
| SRC-G27 | No scripted override path | Production contains no clock-triggered playback or direct vital replacement for these rows. |
| SRC-G28 | No unauthorized tolerance | No numeric comparison tolerance exists without a new authority decision. |
| SRC-G29 | Dynamic physiology authority | Canonical Runtime physiology remains owned by deterministic patient processes and intervention effects. |
| SRC-G30 | Privacy-safe deterministic mapping | Vital fidelity metadata uses only P01/P02 and neutral production patient IDs and reports deterministically. |

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
| IMG-G26 | Narva package ownership | The approved Narva study belongs only to immutable `russicaptor.narva-trauma` package versions. |
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

### Imaging asset-ingest guardrails

The local authoring pipeline validates image bytes, freezes exact integrity and package provenance, and generates Metro-compatible static resolvers. It does not fetch remote content or change runtime clinical behavior.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| IMG-ASSET-G01 | JPEG ingest | Valid JPEG bytes produce exact deterministic metadata and registration. |
| IMG-ASSET-G02 | PNG ingest | Valid PNG bytes produce exact deterministic metadata and registration. |
| IMG-ASSET-G03 | Invalid image fail-closed | Unsupported, corrupt, empty, and extension-mismatched input is rejected. |
| IMG-ASSET-G04 | Exact integrity metadata | Byte length, SHA-256, media type, and dimensions derive from exact bundled bytes. |
| IMG-ASSET-G05 | Package provenance | Package ID and immutable package version are recorded. |
| IMG-ASSET-G06 | Patient provenance | The package-owned patient identity is recorded. |
| IMG-ASSET-G07 | Definition provenance | The package-owned Imaging definition identity is recorded. |
| IMG-ASSET-G08 | Static Metro resolver | Generated resolver code uses a compile-time static `require(...)`. |
| IMG-ASSET-G09 | Path traversal rejection | Identity fields cannot escape the deterministic package asset destination. |
| IMG-ASSET-G10 | Immutable collision rejection | Different bytes or metadata cannot replace an existing semantic identity. |
| IMG-ASSET-G11 | Idempotent re-ingest | Identical bytes and metadata are a no-op. |
| IMG-ASSET-G12 | Published package immutability | An already-published package ID/version cannot gain a new asset. |
| IMG-ASSET-G13 | Dry-run no write | Dry-run validates the complete plan without writing repository state. |
| IMG-ASSET-G14 | License provenance | Optional source, attribution, and license metadata is preserved. |
| IMG-ASSET-G15 | No checkpoint binary | Generated metadata and canonical checkpoints contain no image bytes or data URLs. |
| IMG-ASSET-G16 | Bundled local resolution | Generated registration resolves through the existing `BUNDLED_LOCAL` runtime contract. |

### Imaging package-authoring guardrails

The authoring command binds one validated local asset by generating a later immutable package version. Exact IDs are required; historical package content is never rewritten, and a failed multi-file operation rolls back its complete write set.

| ID | Guardrail | Frozen invariant |
| --- | --- | --- |
| IMG-AUTH-G01 | New package version | A valid operation creates one new immutable package version with the requested binding. |
| IMG-AUTH-G02 | Published base unchanged | The base package and hash remain byte/semantically unchanged. |
| IMG-AUTH-G03 | Dry-run no write | Dry-run reports every intended output without writing. |
| IMG-AUTH-G04 | Wrong package rejected | Unknown package identity fails before ingest. |
| IMG-AUTH-G05 | Wrong patient rejected | Patient mismatch fails; fuzzy matching is forbidden. |
| IMG-AUTH-G06 | Wrong definition rejected | Unknown Imaging definition fails before writing. |
| IMG-AUTH-G07 | Version collision rejected | An existing package version cannot be reused. |
| IMG-AUTH-G08 | Replacement identity | Replacement requires a later package and distinct immutable asset identity. |
| IMG-AUTH-G09 | Transaction rollback | Partial failure restores manifests/registries and removes new asset residue. |
| IMG-AUTH-G10 | Package hash valid | Canonical package hashing produces and validates the new hash. |
| IMG-AUTH-G11 | Asset registry valid | The bound asset remains exact in the generated static registry. |
| IMG-AUTH-G12 | Historical hashes unchanged | Frozen historical package hashes remain unchanged. |
| IMG-AUTH-G13 | Clinical semantics unchanged | Title, report, delay, modality, order and patient binding are preserved. |
| IMG-AUTH-G14 | Provenance preserved | Supplied source/license/attribution metadata is preserved exactly. |
| IMG-AUTH-G15 | Bounded JSON output | Machine output contains metadata only, never image bytes. |
| IMG-AUTH-G16 | Normal package loader | Generated versions load through the canonical package loader. |

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
| LAB-G26 | Blood-bank identity persistence | AB0 and RhD remain patient identity while the authored antibody-screen result belongs to each immutable sample across restart, takeover, and rehydration. |
| LAB-G27 | hCG applicability | hCG is reported only when an authoritative patient applicability fact exists; missing demographic evidence is represented as not applicable, never an invented positive. |
| LAB-G28 | Narva exclusions | SARS-CoV-2, influenza, urine analyses, and U-Narco remain absent from the Narva POLÜTRAUMA result. |
| LAB-G29 | Complete CBC coverage | The hematology group contains all CBC/5-diff/NRBC components derived from the authoritative IVKH reference export while Hb, Hct, and platelets remain physiology-driven. |
| LAB-G30 | Source unit/reference fidelity | Verified source codes, including `aB-Hb-Fr` and `B1-RBC Ab screen I, II, III`, remain exact while absent units, references, component relationships, and result semantics are not invented. |
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
| LAB-G42 | Non-reportable source-token presentation | Non-reportable source/order tokens such as `aB-Hb-Fr` cannot appear as pending or completed patient result rows. |
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
| H19 | A stale device reacquired writer authority from a same-revision divergent local checkpoint and erased canonical evidence/lifecycle state | A/B/C/M/U/X | `EqualRevisionTakeoverConflict-test.ts`, `RuntimeCheckpointStartup-test.ts` | Two-device equal-revision conflict rebase and takeover gate |
| H20 | A stale equal-revision shared-workflow head overwrote checkpoint-restored patient collections and removed durable transfer evidence | A/B/C/I/M/U/X/Y | `SharedWorkflowCanonicalReconciliation-test.ts`, `DurablePatientInternalTransferCommand-test.ts`, `RuntimeCheckpointStartup-test.ts` | Two-device shared-workflow/canonical takeover reconciliation gate |

No historical blocker may be removed from the manifest or left without an executable regression and a documented physical acceptance boundary.

## Frozen IRO identity

- Package: `russicaptor.narva-iro-evacuation@1.0.1`
- Package hash: `da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95`
- Definition hash: `6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0`

## Future work-package statement

> All RussiCaptor Runtime Regression Guardrails are mandatory acceptance gates for this work package. Determine impacted guardrail classes before implementation. No guardrail may be weakened, bypassed, deleted, or threshold-relaxed. Run the impacted guardrail suites plus full required release checks before declaring PASS.
