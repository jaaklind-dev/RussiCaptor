import type { PatientSharedWorkflowState } from "./PatientSharedWorkflowState";
import type { SharedWorkflowMutationRequest, SharedWorkflowMutationResult, SharedWorkflowRpcObserver, SharedWorkflowSubmissionGuard } from "./SharedWorkflowMutationService";

export type ValidationContext = Readonly<{
  enabled: boolean; exerciseId: string; operatorId: string; sessionGeneration: number;
  testPackage: boolean; running: boolean; scopedCmOnly: boolean; online: boolean; patientId: string;
}>;
export type PreparedPhysicalValidationMutation = Readonly<{
  exerciseId: string; patientId: string; operatorId: string; sessionGeneration: number;
  contextId: string; commandId: string; kind: "CLAIM" | "APPEND" | "MUTABLE";
  expectedRevision: number; expectedOwnerUserId?: string;
}>;
export type ValidationEvidence = Readonly<{
  clientRef: string; exerciseId: string; patientId: string; operatorRef: string;
  commandId: string; contextId: string; kind: string; baseRevision: number;
  timestamp: string; phase: string; attempt: number; rpcSubmitted: boolean;
  httpStatus: number | null; requestCorrelationId: null; serverErrorCode: string | null;
  status: string | null; resultingRevision: number | null; ownerRef: string | null; route: "NORMAL" | "NEGATIVE_TEST";
}>;
export type PhysicalValidationOutcome = Readonly<{ result: SharedWorkflowMutationResult; message: string; acceptanceViolation?: boolean }>;
type Entry = { request: SharedWorkflowMutationRequest; inFlight?: Promise<PhysicalValidationOutcome>; completed?: PhysicalValidationOutcome; submissions: number };
type Dependencies = {
  context(): ValidationContext; id(prefix: string): string; now(): string;
  head(patientId: string): Readonly<{ revision: number; ownerUserId?: string }>;
  patientActive(patientId: string): boolean;
  submit(request: SharedWorkflowMutationRequest, observer: SharedWorkflowRpcObserver, guard: SharedWorkflowSubmissionGuard): Promise<SharedWorkflowMutationResult>;
  apply(prepared: PreparedPhysicalValidationMutation, result: SharedWorkflowMutationResult): void;
};

/** Acceptance-only, memory bounded. Payloads never enter the evidence projection. */
export class PhysicalValidationHarnessCore {
  private armed?: { context: ValidationContext; id: string; clientRef: string };
  private entries = new Map<PreparedPhysicalValidationMutation, Entry>();
  private evidence: ValidationEvidence[] = [];
  private faulted = false;
  constructor(private readonly deps: Dependencies) {}
  invalidate(): void { this.armed = undefined; this.entries.clear(); }
  private eligible(c: ValidationContext): boolean {
    return !this.faulted && c.enabled && c.testPackage && c.running && c.scopedCmOnly &&
      /^EX-[A-Za-z0-9-]{1,150}$/.test(c.exerciseId) && Boolean(c.operatorId);
  }
  arm(clientRef: "Samsung-A" | "Samsung-B"): boolean {
    if (this.faulted) return false;
    this.invalidate(); const context = this.deps.context();
    if (!this.eligible(context) || !context.online || !["Samsung-A", "Samsung-B"].includes(clientRef)) return false;
    this.evidence = []; this.armed = { context, id: this.deps.id("SW-CONTEXT"), clientRef }; return true;
  }
  canArm(): boolean { const c = this.deps.context(); return this.eligible(c) && c.online; }
  valid(): boolean {
    if (this.faulted) return false;
    const c = this.deps.context(), a = this.armed?.context;
    const valid = Boolean(a && this.eligible(c) && a.exerciseId === c.exerciseId &&
      a.operatorId === c.operatorId && a.sessionGeneration === c.sessionGeneration && a.patientId === c.patientId);
    if (!valid) this.invalidate(); return valid;
  }
  getEvidence(): readonly ValidationEvidence[] { return this.evidence.map(e => Object.freeze({ ...e })); }
  evidenceVisible(): boolean {
    const c = this.deps.context(), a = this.armed?.context;
    return Boolean(a && c.operatorId === a.operatorId && c.sessionGeneration === a.sessionGeneration &&
      c.exerciseId === a.exerciseId && c.patientId === a.patientId);
  }
  prepare(kind: PreparedPhysicalValidationMutation["kind"], patientId: string,
    head: Readonly<{ revision: number; ownerUserId?: string }>, source: PatientSharedWorkflowState): PreparedPhysicalValidationMutation | undefined {
    if (!["CLAIM", "APPEND", "MUTABLE"].includes(kind) || !this.valid() || !this.deps.context().online || this.entries.size >= 16 ||
      !["PT-PELVIC-001", "PT-PLEURAL-001"].includes(patientId) || patientId !== this.deps.context().patientId ||
      !Number.isSafeInteger(head.revision) || head.revision < 1 || source.patient?.id !== patientId ||
      !["Active", "Incoming"].includes(String(source.patient?.status))) return undefined;
    const a = this.armed!, actor = a.context.operatorId;
    if (kind === "CLAIM" ? head.ownerUserId !== undefined : head.ownerUserId !== actor) return undefined;
    const commandId = this.deps.id(`SW-VALIDATION-${kind}`), timestamp = this.deps.now();
    const state = structuredClone(source);
    const event = { id: this.deps.id("TL-VALIDATION"), exerciseId: a.context.exerciseId, patientId,
      timestamp, type: kind === "CLAIM" ? "assignment" : "note", title: "TEST valideerimissündmus",
      description: `VALIDATION_${kind}`, author: "TEST CM", authorId: actor, visibility: "revealed" };
    const proposed: PatientSharedWorkflowState = kind === "CLAIM" ? {
      ...state, patient: { ...state.patient, status: "Active" },
      assignments: [...state.assignments, { patientId, caseManagerId: actor, caseManagerName: "TEST CM", assignedAt: timestamp }],
      timelineEvents: [...state.timelineEvents, event],
    } : { ...state, notes: [...state.notes, { id: this.deps.id("NOTE-VALIDATION"), exerciseId: a.context.exerciseId,
      patientId, text: `VALIDATION_${kind}`, author: "TEST CM", authorId: actor, createdAt: timestamp }],
      timelineEvents: [...state.timelineEvents, event] };
    const prepared = Object.freeze({ exerciseId: a.context.exerciseId, patientId, operatorId: actor,
      sessionGeneration: a.context.sessionGeneration, contextId: a.id, commandId, kind,
      expectedRevision: head.revision, expectedOwnerUserId: head.ownerUserId });
    this.entries.set(prepared, { request: { exerciseId: prepared.exerciseId, patientId, commandId, kind,
      expectedRevision: head.revision, expectedOwnerUserId: head.ownerUserId,
      nextOwnerUserId: kind === "CLAIM" ? actor : head.ownerUserId, state: proposed }, submissions: 0 });
    return prepared;
  }
  prepareAppendPair(patientId: string, head: Readonly<{ revision: number; ownerUserId?: string }>, state: PatientSharedWorkflowState) {
    if (this.entries.size > 14) return undefined;
    const first = this.prepare("APPEND", patientId, head, state);
    const second = first && this.prepare("APPEND", patientId, head, state);
    return first && second ? Object.freeze([first, second] as const) : undefined;
  }
  private bound(prepared: PreparedPhysicalValidationMutation): boolean {
    return this.valid() && this.entries.has(prepared) && prepared.contextId === this.armed?.id &&
      prepared.patientId === this.deps.context().patientId && this.deps.patientActive(prepared.patientId) &&
      Number.isSafeInteger(prepared.expectedRevision) && prepared.expectedRevision >= 1;
  }
  private fresh(prepared: PreparedPhysicalValidationMutation, negative: boolean): boolean {
    const head = this.deps.head(prepared.patientId);
    if (!Number.isSafeInteger(head.revision) || head.revision < prepared.expectedRevision) return false;
    // Only a monotonic, strictly newer head proves a MUTABLE CAS rejection.
    // APPEND deliberately accepts an older base and must never use this route.
    if (negative) return prepared.kind === "MUTABLE" && head.revision > prepared.expectedRevision;
    const owner = prepared.kind === "CLAIM" ? head.ownerUserId === undefined :
      head.ownerUserId === prepared.operatorId && prepared.expectedOwnerUserId === prepared.operatorId;
    return owner && (prepared.kind === "APPEND" || head.revision === prepared.expectedRevision);
  }
  availability(prepared: PreparedPhysicalValidationMutation): Readonly<{ normal: boolean; negative: boolean }> {
    const entry = this.entries.get(prepared);
    const ready = this.bound(prepared) && this.deps.context().online && Boolean(entry && !entry.inFlight && !entry.submissions);
    return { normal: ready && this.fresh(prepared, false), negative: ready && this.fresh(prepared, true) };
  }
  submit(prepared: PreparedPhysicalValidationMutation, negativeConfirmed = false): Promise<PhysicalValidationOutcome> {
    const entry = this.entries.get(prepared);
    if (!this.bound(prepared) || !entry) return Promise.resolve({
      result: { status: "AUTHORIZATION_DENIED", revision: prepared.expectedRevision }, message: "Valmiskäsu seanss või õppus muutus. Armeeri TEST uuesti." });
    if (entry.inFlight) return entry.inFlight;
    if (entry.completed) return Promise.resolve(entry.completed);
    if (!this.deps.context().online || entry.submissions > 0) return Promise.resolve({
      result: { status: "RECONNECT_REQUIRED", revision: prepared.expectedRevision }, message: "Ühendus või lubatud kordus puudub. Säilita tõendid." });
    if (!this.fresh(prepared, negativeConfirmed)) return Promise.resolve({ result: {
      status: "STALE_VERSION", revision: prepared.expectedRevision }, message: "Kohalik värskuskontroll blokeeris saatmise; serveripäringut ei tehtud." });
    entry.submissions++;
    const record: SharedWorkflowRpcObserver = event => {
      if (!this.valid() || this.armed?.id !== prepared.contextId) return;
      const evidence: ValidationEvidence = Object.freeze({ clientRef: this.armed.clientRef,
        exerciseId: prepared.exerciseId, patientId: prepared.patientId, operatorRef: prepared.operatorId.slice(0, 8),
        commandId: prepared.commandId, contextId: prepared.contextId, kind: prepared.kind, baseRevision: prepared.expectedRevision,
        timestamp: this.deps.now(), phase: event.phase, attempt: event.attempt, rpcSubmitted: event.phase !== "LOCAL",
        httpStatus: event.httpStatus, requestCorrelationId: null, serverErrorCode: event.serverErrorCode,
        status: event.status, resultingRevision: event.revision, ownerRef: event.ownerUserId?.slice(0, 8) ?? null,
        route: negativeConfirmed ? "NEGATIVE_TEST" : "NORMAL" });
      this.evidence = [...this.evidence.slice(-63), evidence];
    };
    entry.inFlight = (async () => {
      let result: SharedWorkflowMutationResult;
      try { result = await this.deps.submit(structuredClone(entry.request), record, { operatorId: prepared.operatorId,
        valid: () => this.bound(prepared) && this.fresh(prepared, negativeConfirmed),
        ...(negativeConfirmed ? { negativeTest: true as const } : {}) }); }
      catch { result = { status: "UNAVAILABLE", revision: prepared.expectedRevision }; }
      // An old asynchronous response cannot restore a different actor/exercise.
      const violation = negativeConfirmed && !["STALE_VERSION", "NOT_OWNER", "OWNERSHIP_CHANGED"].includes(result.status);
      if (!negativeConfirmed && this.bound(prepared)) this.deps.apply(prepared, result);
      const outcome = Object.freeze({ result, acceptanceViolation: violation,
        message: `${violation ? "STOP: negatiivse katse ootamatu vastus. " : ""}RPC tulemus: ${result.status} · revisjon ${result.revision}` });
      entry.completed = outcome;
      if (violation) this.faulted = true;
      return outcome;
    })().finally(() => { entry.inFlight = undefined; });
    return entry.inFlight;
  }
}
