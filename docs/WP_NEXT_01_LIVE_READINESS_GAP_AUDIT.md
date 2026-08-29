# WP-NEXT-01 — Live Readiness Functional Gap Audit

Date: 2026-08-29

Scope: repository state after WP-EGRESS-01…07

Method: static repository inspection, existing automated/physical acceptance evidence, configuration and CI review. No product code or schema was changed.

## Executive summary

RussiCaptor has a strong deterministic clinical Runtime, durable checkpoint/recovery model, extensive service-level regression coverage, and working CM/EXCON workflows. It is not yet safe to classify as ready for a serious multi-operator live exercise.

The principal blocker is not clinical physiology. The running application still uses anonymous Supabase sessions, a hard-coded demo CM identity selector, and unguarded EXCON routes. The authorization foundation covers a narrow set of EXCON permissions but is explicitly not wired to general route/action enforcement or supported role provisioning. Consequently operator identity, attribution, and least-privilege access are not trustworthy.

A second blocker is concurrent shared-workflow persistence. Canonical Runtime checkpoint publication is lease/CAS protected, but the broader shared exercise projection is published as a full-row revisioned upsert without backend compare-and-swap. Multiple CMs can therefore overwrite independent workflow edits made from the same base revision.

The next serious exercise should also not depend on today’s developer-assisted release process: Android release uses the debug signing configuration, CI does not build a release artifact or run the complete quality gate, and there is no operator deployment/recovery runbook. Repeated physical acceptance sessions additionally show tap-loss/latency and safe-area problems that can encourage duplicate clinical actions.

Overall assessment: **FUNCTIONALLY ADVANCED, BUT NOT LIVE-READY**.

## Current capability matrix

| Area | Status | Repository evidence and qualification |
|---|---|---|
| Authentication and role handling | **RISKY** | `src/app/index.tsx` enters the dashboard through a link; `CloudSyncService.startCloudSync()` and module import use anonymous sign-in. `ProviderFactory.ts` fixes `USE_DEMO_DATA = true`; `CurrentUserService.ts` exposes hard-coded CM identities. Authorization services exist, but `docs/WP41A_AUTHORIZATION_FOUNDATION.md` states existing EXCON routes/controls are not protected and role provisioning lacks a supported production UI. |
| CM workflow | **PARTIAL** | Dashboard, patient acquisition, workspace, treatments and transfer exist. Identity is device-local/demo-selectable and therefore attribution is not authoritative. |
| EXCON workflow | **PARTIAL** | Catalog, import, dashboard, inspector, conflict recovery, timeline, debrief, evaluation and analytics routes exist. Route entry and most actions are not bound to authenticated EXCON authorization. |
| Exercise creation/import | **READY** | Legacy import remains compatible; generic versioned package/dataset/action/fixture import, validation, staging, rollback, idempotency and package-specific validator registry are covered by importer tests. Operational access control remains external to the importer. |
| Exercise lifecycle | **READY** | Prepare/start/pause/resume/speed/complete, immutable Complete intent, terminal convergence and lifecycle-critical projection flushes are implemented and tested. |
| Patient scanning/assignment | **PARTIAL** | QR/national-ID scan, assignment conflict, takeover request and transfer workflow exist. Ownership is weakened by demo identity and shared-projection lost-update risk. |
| Patient workspace | **PARTIAL** | Overview, vitals, actions, history, labs, imaging, questions, notes and orders are present. Long, dense action surfaces and inconsistent pending feedback create field-use risk. |
| Questions/orders/labs/imaging | **PARTIAL** | Functional repositories and workspace tabs exist; data is included in the shared projection, whose concurrent mutation safety is insufficient. |
| Interventions/treatment recording | **READY** | Generic intervention Runtime plus pelvic, pleural, vascular access, transfusion/MTP, calcium and transport extensions have focused and physical evidence. UI mis-taps/repeated intents remain an operational concern. |
| Ownership and transfer | **PARTIAL** | Assignment/transfer history, read-only ownership state and acceptance/rejection exist. Authoritative user identity and conflict-safe multi-writer persistence are missing. |
| Clinical Runtime engine | **READY** | Deterministic clock, patient processes, intervention lifecycle, physiology, idempotency and historical-hash gates have broad regression coverage. |
| Scenario events | **READY** | Canonical events, Timeline/History/Debrief evidence and lifecycle-aware presentation are implemented. |
| Checkpoint persistence | **READY** | Durable local envelopes, Supabase checkpoint CAS/lease, cache/delta hydration, byte budget, archive separation and hash stability are tested. |
| Restart/recovery | **READY** | Rehydration, reader convergence, takeover, stale-writer rejection, conflict/recovery cards and terminal convergence are implemented. Recovery authorization administration is not operationally ready. |
| Multi-device synchronization | **RISKY** | Runtime writer ownership is strong. General shared exercise projection uses client revision plus blind full-row upsert in `CloudSyncService.publishCloudProjection()`, allowing last-writer loss across independent CM edits. |
| Offline/reconnect | **PARTIAL** | Runtime fails closed after lease loss and supports reader reconciliation. Offline branches are intentionally not merged; shared CM edits lack a clear conflict/queue policy and user-facing resolution. |
| Instructor evaluation | **PARTIAL** | Assessment/evaluation services and EXCON views exist with read/write permissions. General EXCON access and evaluator identity are not consistently enforced. |
| Analytics/debrief | **READY** | Canonical debrief/evidence and analytics providers are extensive. Export/distribution for field stakeholders is not demonstrated. |
| Audit/history | **PARTIAL** | Runtime/clinical history and recovery audit evidence exist. Reliable human attribution is blocked by anonymous/demo identity. |
| Admin/recovery tools | **PARTIAL** | Supported recovery/takeover UI exists. Production role provisioning/diagnostics requires trusted administration outside a complete app workflow. |
| Release/deployment | **RISKY** | Android release selects `signingConfigs.debug`; CI only runs hash/hardening jobs, not the full suite/static checks/release build. README is the Expo template; no controlled field distribution/update/rollback runbook exists. |
| Physical-device usability | **RISKY** | Extensive Samsung acceptance exists, but repeated sessions recorded first-touch loss, 1–8 s response/navigation delay, and controls behind Android system UI. Safe-area/accessibility use is sparse and the app is portrait-only. |

## Live critical paths

### A. EXCON setup

The package and lifecycle mechanics are functional. The path fails at its first trust boundary: sign-in is anonymous, `/excon` has no production authorization guard, and supported role provisioning is incomplete. A legitimate EXCON can start, monitor, recover and complete an exercise, but the application cannot reliably prove that the actor is an EXCON. Recovery may also depend on administrator intervention to create a role assignment.

**Blockers:** real identity, route/action authorization, supported role administration, production deployment.

**Friction:** conflict/recovery state is powerful but operationally complex; no concise runbook.

**Unsafe ambiguity:** a visible EXCON route is not evidence of permission; device-local identity can be mistaken for authoritative identity.

### B. Case Manager

The functional journey from scan to clinical treatment and transfer exists. Ownership labels and read-only transfer behavior are useful. It is nevertheless unsafe for live attribution because a user can switch between hard-coded CMs locally, while CloudSync can create an anonymous session automatically.

**Blockers:** authentication-to-CM binding; conflict-safe shared data mutation.

**Friction:** dense patient Actions tab, delayed response, uneven feedback for commands in progress.

**Unsafe ambiguity:** repeated taps during latency can look like an ignored action and create an unintended new clinical intent where unique intent IDs correctly make each tap independent.

### C. Multi-device operation

The canonical Runtime has a clear single-writer lease, stale-client rejection, takeover and reader convergence. Ownership/workflow data does not have the same server-side concurrency boundary. A whole shared projection can be overwritten by another device.

**Blocker:** server-enforced conflict safety for shared mutable domains.

**Technical dependency:** define per-domain commands/CAS or another deterministic merge boundary without weakening Runtime lease/CAS.

**Friction:** no operator-friendly conflict resolution for offline non-Runtime edits.

### D. Post-exercise

Completion, terminal archive, Timeline, debrief, assessment, evaluation and analytics exist and are well tested. The archive/checkpoint path is durable. Gaps are trustworthy evaluator attribution, repeatable export/distribution, and a documented exercise-close operational procedure.

## Unfinished work and platform coupling

### Live-relevant unfinished work

- `OneDriveProvider.ts` is intentionally unimplemented while `ProviderFactory.ts` selects demo data. This is not a blocker if Supabase/local package delivery is the chosen production path, but the unused provider and stale roadmap obscure the supported architecture.
- `README.md` remains the create-expo-app template and `ROADMAP.md` describes already-superseded sync plans. This is an operational risk, not merely documentation polish.
- Deprecated session/reset/intervention/resource compatibility paths remain. Current tests show compatibility; they are not priority refactor targets before a live exercise.
- No skipped/disabled critical test was found in the inspected test tree.

### Scenario coupling classification

| Finding | Classification | Assessment |
|---|---|---|
| Botulism patient data, fixtures and historical outputs | Harmless fixture content | Correctly scoped as exercise content. |
| `BotulismPackageValidator` selected by exact module dependency | Acceptable module specialization | Generic validation no longer requires Botulism IDs/triggers. |
| Pelvic, pleural, MTP and transport processes | Acceptable plugin/module specialization | Dedicated Runtime modules with opt-in package bindings and reference packages. |
| Tourniquet behavior | Acceptable clinical specialization | Current `HemorrhagePatientProcess` applies `REDUCE_EXTERNAL_BLEEDING`; tests cover it. Older documents saying it was not active are stale. |
| Dashboard location/triage/status filter seed lists | Problematic platform coupling, moderate | Fixed operational categories may not fit arbitrary packages and should eventually derive from package/current data. |
| Final Narva exercise | Missing scenario content, not importer coupling | Only Narva-representative configuration tests/references were found; no final versioned Narva package. Transport-order consequences, final inventory and scenario assessment remain content work if Narva is the next exercise. |

No hard-coded patient ID or Botulism rule was found in the current generic package validation path.

## Physical-device usability risks

1. **Touch reliability and delayed acknowledgement:** repeated Samsung/Huawei acceptance sessions observed controls opening only after multiple touches or 1–8 second delays. Independent user intents are deliberately unique, so retrying a treatment can administer a second dose.
2. **System-bar/safe-area collision:** back/bottom controls have been reported behind Android navigation/settings UI. Actual routes make little use of safe-area insets.
3. **Weak pending-state consistency:** some commands disable while executing, but high-consequence treatment, binder, transport and access controls do not share one unmistakable “accepted/pending/completed” interaction contract.
4. **Dense patient action surface:** many different clinical/resource workflows share a long Actions tab, increasing search time and wrong-control risk.
5. **Accessibility:** accessibility roles/labels, hit slop and explicit minimum touch sizes are inconsistent.
6. **Portrait-only tablet workflow:** `app.json` locks portrait; no evidence demonstrates landscape/rugged mount usability.
7. **Startup/reconnect presentation:** remote discovery starts asynchronously after local load; the user can briefly see stale/local content without a dedicated startup resolution state.

## Release readiness

The application can be built and manually installed for acceptance, but this is not a controlled field release process.

- Android release uses the debug keystore configuration in `android/app/build.gradle`.
- There is no repository runbook for provisioning devices, selecting environment, distributing an artifact, rollback, or post-install validation.
- The login UI reports version `0.2` while application/package versioning is `1.0.0`.
- GitHub Actions runs the Node 20/22/24/26 Runtime/hash matrix, but does not enforce the full suite, TypeScript, ESLint, Android release build/signing or artifact smoke test.
- No crash-reporting/field diagnostics integration was found.
- No over-the-air update policy was found.
- Supabase endpoint configuration exists, but a documented staging/production separation and release approval process were not found.
- iOS identifiers exist, but no iOS signing, distribution or physical acceptance evidence was found. Treat iOS as unsupported unless it is explicitly required.
- Supabase’s current platform guidance notes that its JavaScript client libraries drop Node 20 support on 2026-06-30. The CI matrix should retain backward coverage only intentionally while build tooling moves to a supported Node line.

## Recovery and data safety

| Failure | Current behavior | Gap |
|---|---|---|
| Device/app dies | Durable local checkpoint and remote authoritative checkpoint support restart/rehydration. | Operational restore drill/runbook and field diagnostics are missing. |
| Network disappears | Current writer can continue locally within policy; publication stops/fails closed when authority is no longer valid. | General CM workflow edits have no safe offline merge/queue contract. |
| EXCON device dies | Another authorized device can discover/take over according to lease/recovery rules. | Authentic EXCON provisioning and a pre-provisioned backup device are not guaranteed. |
| Conflicting active exercises | Startup discovery fails closed and conflict UI exists. | Resolution is specialized and requires trained/authorized staff; runbook absent. |
| Checkpoint missing/corrupt | Typed recovery paths, validation and recovery card exist. | Recovery role is hard to provision through a supported app/admin flow. |
| Offline operator returns | Runtime reader reconciles to authoritative durable state; stale writer is rejected. | Non-Runtime shared edits may be overwritten or lost; no merge semantics. |
| Exercise completes | Terminal convergence, inactive lease and durable archive are tested. | Human attribution remains unreliable under anonymous/demo identity. |

## Test coverage audit

### Strong coverage

- Deterministic Runtime and clinical process progression.
- Runtime lease, CAS, checkpoint publication, cache/delta hydration, restart, takeover and stale-reader/writer convergence.
- Lifecycle transitions and terminal convergence.
- MTP/transfusion, vascular access, calcium, pelvic/pleural hemorrhage and transport.
- Import validation, rollback, hashing and backward compatibility.
- Historical/hash stability and Runtime Hardening on Node 20/22/24/26.
- Numerous real Samsung two-device and clinical acceptance sessions.

### Material gaps

- No automated end-to-end device journey from real sign-in through EXCON/CM role enforcement, scan, concurrent care, failure, completion and debrief.
- No real production authentication/role journey exists to test.
- Concurrent CM shared-domain lost-update cases are not protected by a backend invariant and therefore cannot be accepted by UI tests alone.
- Physical acceptance is extensive but ad hoc; it is not a repeatable scripted release gate.
- CI does not run the reported full suite/static checks or build/install a signed release artifact.
- Little component-level coverage exists for safe areas, double taps, slow acknowledgements, accessibility, route guards and stale/loading/error states.
- No iOS physical/release coverage.

Latest accepted repository evidence before this audit reports 959/959 full tests, Runtime Hardening 2/2, TypeScript, ESLint and diff checks passing for WP-EGRESS-07. This audit changes documentation only.

## Prioritized Top 10 gaps

| Rank | Gap | Severity | Live impact | Effort | Risk | Timing |
|---:|---|---|---|---|---|---|
| 1 | Real user authentication, CM identity binding, EXCON route/action enforcement and supported role provisioning | CRITICAL | BLOCKER | LARGE | HIGH | BEFORE_NEXT_LIVE_TEST |
| 2 | Conflict-safe server persistence for concurrent CM shared-workflow edits | CRITICAL | BLOCKER | VERY LARGE | HIGH | BEFORE_NEXT_LIVE_TEST |
| 3 | Signed, reproducible field release pipeline, environment/version control and deployment/rollback runbook | CRITICAL | BLOCKER | MEDIUM | MEDIUM | BEFORE_NEXT_LIVE_TEST |
| 4 | Rugged-tablet interaction safety: safe areas, pending feedback, duplicate-intent protection and latency UX | HIGH | MAJOR | MEDIUM | MEDIUM | BEFORE_NEXT_LIVE_TEST |
| 5 | Supported live-operations recovery/admin tooling, diagnostics and backup-EXCON drill | HIGH | MAJOR | MEDIUM | HIGH | BEFORE_NEXT_LIVE_TEST |
| 6 | Repeatable end-to-end multi-device acceptance gate in CI/release process | HIGH | MAJOR | LARGE | MEDIUM | SOON_AFTER |
| 7 | Explicit offline policy for non-Runtime CM edits and clear reconciliation UX | HIGH | MAJOR | LARGE | HIGH | BEFORE_NEXT_LIVE_TEST |
| 8 | Final versioned scenario package and acceptance evidence for the actual next exercise (Narva if selected) | HIGH | MAJOR | LARGE | MEDIUM | BEFORE_NEXT_LIVE_TEST |
| 9 | Field diagnostics/crash reporting and privacy-safe support bundle | MEDIUM | MODERATE | MEDIUM | MEDIUM | SOON_AFTER |
| 10 | Replace stale template/roadmap/version text with authoritative operator/developer documentation | MEDIUM | MODERATE | SMALL | LOW | BEFORE_NEXT_LIVE_TEST |

Ranks 1–3 are independent release gates: passing one does not compensate for either of the others.

## Top 5 next work packages

### 1. WP-NEXT-02 — Production Operator Identity and Authorization

**Problem:** anonymous sessions, device-local demo CM selection and unguarded EXCON routes make identity and privilege untrustworthy.

**Why it matters:** every clinical action, ownership decision, recovery and evaluation depends on knowing who acted and what they were allowed to do.

**Scope:** real Supabase Auth sign-in/session UX; immutable authenticated user-to-operator mapping; CM and EXCON route/action guards; least-privilege permissions; supported audited assignment/revocation flow; remove demo selectors from production; migration/legacy-session behavior; offline/session-expiry UX. Do not alter Runtime lease/CAS.

**Acceptance:** CM cannot access EXCON actions; unassigned users fail closed; authenticated CM identity cannot be switched locally; EXCON recovery permission is scoped and auditable; logout/session expiry is safe; two physical devices prove distinct attribution and denial paths; existing Runtime hashes remain identical.

**Effort:** LARGE. **Risk:** HIGH. **Devices:** two. **Supabase migration:** likely. **Dependencies:** existing authorization foundation and Supabase Auth.

### 2. WP-NEXT-03 — Conflict-Safe Multi-CM Shared Workflow

**Problem:** whole shared projections can overwrite concurrent assignments, transfers, notes, orders, questions, labs or imaging updates.

**Why it matters:** multi-CM care is a defining live workflow; silent lost updates can change care evidence and ownership.

**Scope:** inventory shared mutable domains; server-enforced expected-revision/CAS or domain-command persistence; deterministic conflict responses; idempotency; bounded retry; offline/read-only policy; convergence instrumentation and UI. Preserve canonical Runtime authority.

**Acceptance:** simultaneous independent edits survive or produce an explicit typed conflict; assignment ownership is never silently reverted; stale/offline client cannot overwrite newer state; reconnect converges; two-device fault matrix passes.

**Effort:** VERY LARGE. **Risk:** HIGH. **Devices:** two. **Supabase migration:** likely. **Dependencies:** WP-NEXT-02 identity for trustworthy actor attribution.

### 3. WP-NEXT-04 — Controlled Field Release and Deployment

**Problem:** deployment relies on developer-assisted, debug-signed Android builds with no enforced artifact gate or operator runbook.

**Why it matters:** the same validated binary must be installable on all field devices, recoverable and identifiable without a developer workstation.

**Scope:** production Android signing/secrets; environment profiles; authoritative version display; CI full suite/static/hardening/release build; immutable artifact/checksum; installation/update/rollback and smoke runbook; production/debug feature separation. Explicitly scope iOS only if required.

**Acceptance:** CI produces a signed release artifact from a tagged revision; clean devices install it; app displays correct version/environment; rollback is rehearsed; no demo/admin controls in production; release checklist passes without source workstation intervention.

**Effort:** MEDIUM. **Risk:** MEDIUM. **Devices:** two. **Supabase migration:** no. **Dependencies:** coordinate production configuration with WP-NEXT-02.

### 4. WP-NEXT-05 — Rugged-Tablet Interaction Safety

**Problem:** missed first taps, delayed acknowledgement and system-bar collisions can cause repeated or unintended actions.

**Why it matters:** operators work under pressure; a second tap may be a valid second dose, not a duplicate callback.

**Scope:** safe-area audit; minimum touch targets/accessibility; one common submitted/pending/accepted/completed presentation; action-level tap lock until intent acknowledgement; careful confirmation/undo policy for high-consequence actions; long-list/action grouping; startup/reconnect resolving state; portrait/landscape decision based on field mounts.

**Acceptance:** controls remain reachable with gesture and button navigation; slow-network taps create exactly one intent; status appears immediately; no duplicate medication/blood/intervention from repeated touch; physical Samsung latency/failure matrix passes.

**Effort:** MEDIUM. **Risk:** MEDIUM. **Devices:** one, two for reconnect cases. **Supabase migration:** no. **Dependencies:** stable authenticated build from WP-NEXT-02/04 is desirable, not required for initial UI work.

### 5. WP-NEXT-06 — Live Operations Recovery, Diagnostics and Full Dress Rehearsal

**Problem:** robust low-level recovery exists, but role provisioning, diagnosis and exercise recovery have required developer/Supabase assistance during physical tests.

**Why it matters:** field staff must recover a dead EXCON/device/network session without direct database edits or a developer.

**Scope:** supported diagnostics view; privacy-safe support bundle; pre-provisioned backup EXCON; recovery authorization workflow; stale/missing checkpoint decision guidance; authoritative recovery audit; operator runbook; scripted two-device dress rehearsal covering failure and terminal cleanup.

**Acceptance:** trained operator resolves approved failure fixtures using only supported UI; no manual database mutation; all actions are permission checked/audited; authoritative state converges; exercise can safely complete; repeatable evidence package is generated.

**Effort:** MEDIUM. **Risk:** HIGH. **Devices:** two. **Supabase migration:** possible. **Dependencies:** WP-NEXT-02; benefits from WP-NEXT-04.

## RECOMMENDED_NEXT_WP

`RECOMMENDED_NEXT_WP: WP-NEXT-02 — Production Operator Identity and Authorization`

It ranks first because it is the smallest trust boundary that invalidates almost every otherwise functional live path. Without real identity and enforced role binding, ownership, audit, recovery permission, EXCON control and evaluation attribution cannot be accepted, even if the clinical Runtime and synchronization are perfect. It also supplies the actor identity required to design and verify conflict-safe multi-CM writes in WP-NEXT-03. Release work can proceed in parallel planning, but shipping an anonymously controlled exercise build would not be a safe milestone.

## Explicitly deferred

1. **Further Supabase egress architecture optimization:** WP-EGRESS-07 measured full hydration as the remaining source and concluded no further architecture WP is currently justified.
2. **Broad visual redesign:** address concrete touch/safe-area/feedback hazards, not a speculative redesign before trust and concurrency gates.
3. **Advanced analytics expansion:** existing debrief/analytics are already stronger than identity and shared-write safety.
4. **Compatibility-shim refactoring:** deprecated paths are covered and are lower operational value than live blockers.
5. **iOS enablement:** defer unless the next exercise explicitly requires iOS; Android tablets are the demonstrated field target.

## Audit conclusion

No code, Supabase schema or migration change was required. The recommended sequence is identity/authorization first, then conflict-safe collaboration, controlled release, interaction safety, and supported recovery rehearsal. The actual next scenario package must be completed before its exercise, but it should not be used to postpone platform trust boundaries.

Final status: `AUDIT_COMPLETE`
