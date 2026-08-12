# WP-41 — Instructor Evaluation Foundation

## Resume Architecture Gate

WP-41 resumes on committed WP-41A (`584b710`) and accepted ADR-018. The gate
found WP-40 input, exercise identity, Principal, READ/WRITE authorization,
persistence/RLS, Debrief and audit extension points **SUFFICIENT**. Canonical
Runtime, replay, authorization architecture, dependency direction and ADR
changes are all **NO**.

```text
WP-38 factual assessment → WP-39 neutral metrics → WP-40 classification
                                                    ↓ immutable source
WP-41A Principal/AuthorizationService → WP-41 human interpretation → Debrief
```

## Machine and human authority

WP-38 owns `MET`, `NOT_MET`, `NOT_APPLICABLE`, `UNAVAILABLE`; WP-40 owns
`CRITICAL`, `CORE`, `INFORMATIVE`. WP-41 stores neither as mutable copies and
cannot rewrite them. Human judgement is explicitly authored as
`SATISFACTORY`, `NEEDS_REVIEW` or `NOT_ASSESSED`. Empty evaluations contain no
machine-generated judgement. Disagreement with machine output is valid.

WP-41 contains no score, grade, pass/fail, competence, ranking or AI-generated
content. Structured expectation/dimension judgement is primary; Unicode
comments supplement it at expectation, dimension and overall level (trimmed,
maximum 4000 characters).

## Identity, provenance and source change

One stable `evaluationId` exists per exercise. Every revision preserves the
exercise, stable WP-41A Principal `userId`, exact WP-40 profile ID/version/hash,
exact `evaluationHash`, revision and human audit timestamps. Timestamps are
ordinary persistence metadata and enter no deterministic hash.

If the current WP-40 `evaluationHash` differs, read returns `SOURCE_CHANGED`.
The historical revision remains visible and immutable; save fails closed.
Missing/wrong dimensions, expectations, exercise or source are typed failures;
display labels are never used to remap identity.

## Revision, concurrency and persistence

V1 has one current Instructor Evaluation per exercise plus append-only
revisions. Every edit creates revision N+1. The Supabase RPC locks the current
row and atomically compares `expectedRevision`; mismatch returns
`REVISION_CONFLICT`, never silent overwrite. Revision rows preserve the exact
authored JSON, evaluator and source hash.

Persistence is independent of mutable exercise working state, so preparing a
new exercise cannot erase a completed exercise's evaluation. V1 intentionally
omits parallel evaluations, consensus, signatures, approval workflow and
DRAFT/FINAL state.

## Authorization and backend enforcement

UI calls `InstructorEvaluationService`, which calls WP-41A capability checks;
it never inspects routes, local ExCon mode, JWTs or role tables.

- READ requires `INSTRUCTOR_EVALUATION_READ` under ADR-018.
- Every create/comment/judgement/revision requires
  `INSTRUCTOR_EVALUATION_WRITE` and a matching `COMPLETED` exercise.
- WRITE requires `VERIFIED_ONLINE`; `VERIFIED_CACHED`, `STALE`, unavailable,
  unauthenticated, ordinary and forged/local ExCon states fail closed.
- RLS protects reads using authoritative assignments. No direct table write
  policy exists; the security-definer RPC rechecks `auth.uid()` and permission.

Authorization audit stays in WP-41A `authorization_audit`; domain revision
history stays in WP-41 revision rows. Neither enters clinical Timeline. Tokens,
JWTs and credentials are never stored.

## UI, evidence and Debrief

The existing Exercise Evaluation view keeps machine classification/status
visible, then presents a visually separate Instructor Evaluation card. Edit is
explicit and appears only after a service authorization decision. Save waits
for backend confirmation, blocks duplicates, preserves draft text on failure,
and reports typed authorization, source, revision or persistence failures.

Debrief shows the Instructor Evaluation separately with evaluator, revision,
comments and source provenance. The existing WP-40 → WP-38 → canonical evidence
drill-down remains authoritative; WP-41 does not duplicate evidence.

## Performance and isolation

WP-41 performs no per-tick work, Runtime polling or Timeline rescans. It loads
only on Instructor Evaluation presentation and writes only on explicit save.
Runtime, ScenarioEngine, WP-38, WP-39 and WP-40 import no WP-41 code. Package,
Definition, Clinical Module, Protocol, Assessment, Metrics, Evaluation,
Analytics and replay hashes exclude WP-41 data.

## Verification

Automated coverage includes immutable/canonical model data, no automatic
mapping, machine/human disagreement, validation, exact source binding,
source-change detection, revision 1→2 history, optimistic conflict, completed
exercise policy, persistence across service restart, cached/stale/unauthorized
denial, architecture import guards and migration/RLS invariants. The SQL smoke
test verifies an authorized atomic revision, conflict and audit in a rolled-back
transaction.

Manual verification used the normal product lifecycle and a completed ALS
Generic Protocol Reference exercise. On the Android emulator the WP-40 result
remained `CRITICAL · NOT MET` while the instructor deliberately recorded
`SATISFACTORY`, proving that human interpretation cannot overwrite the machine
fact. A second save produced revision 2 and immutable history `1, 2`; the
backend-confirmed result retained the evaluator UUID and exact source hash.
Debrief and Exercise Evaluation rendered the same evaluation separately from
WP-38/WP-40 evidence, with no score, grade, pass/fail, competency or AI wording.

The live Supabase migration and transactional smoke test verified atomic save,
optimistic revision conflict, authorization audit and rollback without residue.
The physical Android development build connected to the same Metro bundle and
opened successfully. Its practical authenticated evaluation flow was not
repeated because the device had a separate signed-out application principal;
no authorization bypass or private-storage manipulation was used.

## Known limitations and future boundaries

- V1 writes are online-only; there is no offline queue.
- Role provisioning remains trusted-admin infrastructure.
- One current evaluation exists per exercise; collaborative/parallel review is
  future work.
- DRAFT/FINAL was omitted because no accepted sign-off workflow exists.
- Patient-level manual judgement, rubrics, scoring, certification, educational
  analytics and AI assistance require separate reviewed work packages.
