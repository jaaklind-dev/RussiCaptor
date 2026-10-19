import { PhysicalValidationHarnessCore, type ValidationContext } from "../PhysicalValidationHarnessCore";
import { InMemorySharedWorkflowGateway } from "../InMemorySharedWorkflowGateway";
import type { PatientSharedWorkflowState } from "../PatientSharedWorkflowState";
import type { SharedWorkflowMutationRequest, SharedWorkflowRpcObserver } from "../SharedWorkflowMutationService";

const patientId = "PT-PELVIC-001";
const state: PatientSharedWorkflowState = { patient: { id: patientId, status: "Active" }, assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [], timelineEvents: [], interventions: [], medicationAdministrations: [], vitalSigns: [] };
let instanceSequence = 0;
function setup(owner: string | null = "CM-A") {
  const instance = ++instanceSequence;
  let context: ValidationContext = { enabled: true, exerciseId: "EX-TEST-1", operatorId: "CM-A", sessionGeneration: 1, testPackage: true, running: true, scopedCmOnly: true, online: true, patientId };
  let serverActor = "CM-A";
  const gateway = new InMemorySharedWorkflowGateway(() => ({ userId: serverActor, role: "CM", exerciseIds: ["EX-TEST-1"] }));
  gateway.seed(context.exerciseId, patientId, structuredClone(state), owner ?? undefined, 7);
  let counter = 0;
  const apply = jest.fn();
  const submit = jest.fn(async (r: SharedWorkflowMutationRequest, observer: SharedWorkflowRpcObserver) => {
    observer({ phase: "SUBMITTED", attempt: 1, httpStatus: null, serverErrorCode: null, status: null, revision: null });
    const result = await gateway.submit(r);
    observer({ phase: "RESPONSE", attempt: 1, httpStatus: 200, serverErrorCode: null, status: result.status, revision: result.revision, ownerUserId: result.ownerUserId });
    return result;
  });
  const head = () => gateway.read("EX-TEST-1", patientId)!;
  const harness = new PhysicalValidationHarnessCore({ context: () => context, head, patientActive: () => true, id: p => `${p}-${instance}-${++counter}`, now: () => "2026-10-19T12:00:00.000Z", submit, apply });
  return { harness, submit, apply, gateway, head, serverActor: (id: string) => { serverActor = id; }, change: (patch: Partial<ValidationContext>) => { context = { ...context, ...patch }; } };
}
describe("bounded physical validation command core", () => {
  test("same-base APPEND pair is distinct, inert and retained exactly once by normal gateway", async () => {
    const { harness, head, submit, gateway } = setup(); expect(harness.arm("Samsung-A")).toBe(true);
    const before = structuredClone(state), pair = harness.prepareAppendPair(patientId, head(), state)!;
    expect(pair.map(p => p.expectedRevision)).toEqual([7, 7]); expect(pair[0].commandId).not.toBe(pair[1].commandId);
    expect(submit).not.toHaveBeenCalled(); expect(state).toEqual(before); expect(head().state.notes).toEqual([]);
    expect((await Promise.all(pair.map(p => harness.submit(p)))).map(x => x.result.status)).toEqual(["APPLIED", "APPLIED"]);
    expect(head().state.notes).toHaveLength(2); expect(head().state.timelineEvents).toHaveLength(2);
    await harness.submit(pair[0]); expect(gateway.acceptedCount("EX-TEST-1")).toBe(2); expect(submit).toHaveBeenCalledTimes(2);
  });
  test("two physical-core clients prepare a shared base independently", async () => {
    const s = setup(); s.harness.arm("Samsung-A"); const pairA = s.harness.prepareAppendPair(patientId, s.head(), state)!;
    const other = setup(); other.harness.arm("Samsung-B"); const pairB = other.harness.prepareAppendPair(patientId, other.head(), state)!;
    expect(pairA[0].expectedRevision).toBe(pairB[0].expectedRevision);
    expect(pairA[0].commandId).not.toBe(pairB[0].commandId);
    other.submit.mockImplementation((r, observer) => s.submit(r, observer));
    await Promise.all([s.harness.submit(pairA[0]), other.harness.submit(pairB[0])]);
    expect(s.head().state.notes).toHaveLength(2); expect(s.submit.mock.calls.map(c => c[0].expectedRevision)).toEqual([7, 7]);
  });
  test("MUTABLE same base yields one commit, one real gateway stale conflict", async () => {
    const s = setup(), { harness, head } = s; harness.arm("Samsung-A");
    const real = s.submit.getMockImplementation()!;
    s.submit.mockImplementation(async (...args) => { await Promise.resolve(); return real(...args); });
    const a = harness.prepare("MUTABLE", patientId, head(), state)!, b = harness.prepare("MUTABLE", patientId, head(), state)!;
    expect((await Promise.all([harness.submit(a), harness.submit(b)])).map(x => x.result.status).sort()).toEqual(["APPLIED", "STALE_VERSION"]);
  });
  test("normal claim is disabled if ownership has already changed", async () => {
    const s = setup(null); s.harness.arm("Samsung-A");
    const claim = s.harness.prepare("CLAIM", patientId, { revision: 7 }, state)!;
    s.serverActor("CM-B");
    await s.gateway.submit({ exerciseId: "EX-TEST-1", patientId, commandId: "OTHER-CLAIM", kind: "CLAIM", expectedRevision: 7, nextOwnerUserId: "CM-B", state });
    s.serverActor("CM-A");
    expect(s.harness.availability(claim)).toEqual({ normal: false, negative: false });
    expect((await s.harness.submit(claim)).result.status).toBe("STALE_VERSION");
    expect(s.submit).not.toHaveBeenCalled();
  });
  test("former owner sends captured proposal after normal transfer, server rejects", async () => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("MUTABLE", patientId, s.head(), state)!;
    await s.gateway.submit({ exerciseId: "EX-TEST-1", patientId, commandId: "TRANSFER", kind: "TRANSFER", expectedRevision: 7, expectedOwnerUserId: "CM-A", nextOwnerUserId: "CM-B", state });
    expect(s.harness.availability(p)).toEqual({ normal: false, negative: true });
    expect((await s.harness.submit(p)).result.status).toBe("STALE_VERSION"); expect(s.submit).not.toHaveBeenCalled();
    expect((await s.harness.submit(p, true)).result.status).toBe("STALE_VERSION"); expect(s.head().ownerUserId).toBe("CM-B"); expect(s.head().state.notes).toHaveLength(0);
    expect(s.harness.getEvidence().at(-1)).toMatchObject({ route: "NEGATIVE_TEST", status: "STALE_VERSION" });
    expect(s.apply).not.toHaveBeenCalled();
  });
  test.each([{ patientId: "PT-PLEURAL-001" }, { exerciseId: "EX-OTHER" }, { operatorId: "CM-B" }, { sessionGeneration: 2 }, { enabled: false }, { running: false }, { testPackage: false }, { scopedCmOnly: false }])("changed binding rejects both routes without submission: %j", async patch => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("APPEND", patientId, s.head(), state)!;
    s.change(patch); expect((await s.harness.submit(p)).result.status).toBe("AUTHORIZATION_DENIED"); expect(s.submit).not.toHaveBeenCalled();
    expect((await s.harness.submit(p, true)).result.status).toBe("AUTHORIZATION_DENIED");
    expect(s.harness.availability(p)).toEqual({ normal: false, negative: false });
  });
  test("leave-and-return cannot resurrect a command; forged descriptor rejected", async () => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("MUTABLE", patientId, s.head(), state)!;
    s.change({ exerciseId: "EX-OTHER" }); expect(s.harness.valid()).toBe(false); s.change({ exerciseId: "EX-TEST-1" });
    expect((await s.harness.submit(p)).result.status).toBe("AUTHORIZATION_DENIED");
    s.harness.arm("Samsung-A"); const fresh = s.harness.prepare("MUTABLE", patientId, s.head(), state)!;
    expect((await s.harness.submit({ ...fresh, expectedRevision: 0 })).result.status).toBe("AUTHORIZATION_DENIED"); expect(s.submit).not.toHaveBeenCalled();
  });
  test("duplicate concurrent activation is single flight", async () => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("APPEND", patientId, s.head(), state)!;
    await Promise.all([s.harness.submit(p), s.harness.submit(p)]); expect(s.submit).toHaveBeenCalledTimes(1); expect(s.head().state.notes).toHaveLength(1);
  });
  test("unknown response consumes preparation; no manual resend or duplicate effect", async () => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("APPEND", patientId, s.head(), state)!;
    s.submit.mockImplementationOnce(async r => { await s.gateway.submit(r); throw Error("lost response"); });
    expect((await s.harness.submit(p)).result.status).toBe("UNAVAILABLE");
    expect((await s.harness.submit(p)).result.status).toBe("UNAVAILABLE"); expect(s.head().state.notes).toHaveLength(1);
    expect(s.submit.mock.calls.map(c => c[0].commandId)).toEqual([p.commandId]);
    expect(s.harness.availability(p)).toEqual({ normal: false, negative: false });
  });
  test("offline retains prepared command but submits nothing; reconnect uses same identity", async () => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("APPEND", patientId, s.head(), state)!;
    s.change({ online: false }); expect((await s.harness.submit(p)).result.status).toBe("RECONNECT_REQUIRED"); expect(s.submit).not.toHaveBeenCalled();
    s.change({ online: true }); expect((await s.harness.submit(p)).result.status).toBe("APPLIED");
  });
  test("late response after session change never applies to replacement context", async () => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("APPEND", patientId, s.head(), state)!;
    s.submit.mockImplementationOnce(async r => { s.change({ sessionGeneration: 9 }); return s.gateway.submit(r); });
    await s.harness.submit(p); expect(s.apply).not.toHaveBeenCalled();
  });
  test("evidence contains no patient payload and is bounded to 64 transport events", async () => {
    const s = setup(); s.harness.arm("Samsung-A");
    const sensitive = { ...state, patient: { ...state.patient, privateValue: "DO_NOT_EXPORT" } };
    for (let i = 0; i < 16; i++) { const p = s.harness.prepare("APPEND", patientId, s.head(), sensitive)!; await s.harness.submit(p); }
    const text = JSON.stringify(s.harness.getEvidence()); expect(text).not.toContain("DO_NOT_EXPORT"); expect(text).not.toMatch(/patientState|access_token|refresh_token|password/);
    expect(s.harness.getEvidence().length).toBeLessThanOrEqual(64); expect(s.harness.getEvidence().every(x => x.requestCorrelationId === null)).toBe(true);
    expect(s.harness.prepare("APPEND", patientId, s.head(), state)).toBeUndefined();
  });
  test("disabled/nontechnical context, wrong patient, unknown owner or absent base fails closed", () => {
    const s = setup(); s.change({ enabled: false }); expect(s.harness.arm("Samsung-A")).toBe(false);
    s.change({ enabled: true, testPackage: false }); expect(s.harness.arm("Samsung-A")).toBe(false);
    s.change({ testPackage: true }); s.harness.arm("Samsung-A");
    expect(s.harness.prepare("APPEND", "PT-OTHER", s.head(), state)).toBeUndefined();
    expect(s.harness.prepare("APPEND", patientId, { revision: 7, ownerUserId: "CM-B" }, state)).toBeUndefined();
    expect(s.harness.prepare("APPEND", patientId, { revision: 0, ownerUserId: "CM-A" }, state)).toBeUndefined();
  });
  test("negative route requires strictly newer MUTABLE base, is one-shot, and cannot append", async () => {
    const s = setup(); s.harness.arm("Samsung-A");
    const p = s.harness.prepare("MUTABLE", patientId, s.head(), state)!;
    expect((await s.harness.submit(p, true)).result.status).toBe("STALE_VERSION"); expect(s.submit).not.toHaveBeenCalled();
    await s.gateway.submit({ exerciseId: "EX-TEST-1", patientId, commandId: "ADVANCE", kind: "MUTABLE", expectedRevision: 7, expectedOwnerUserId: "CM-A", nextOwnerUserId: "CM-A", state });
    await Promise.all([s.harness.submit(p, true), s.harness.submit(p, true)]);
    await s.harness.submit(p, true); expect(s.submit).toHaveBeenCalledTimes(1);
    expect(s.head().revision).toBe(8); expect(s.gateway.acceptedCount("EX-TEST-1")).toBe(1);
    const append = s.harness.prepare("APPEND", patientId, s.head(), state)!;
    expect(s.harness.availability(append).negative).toBe(false); await s.harness.submit(append, true);
    expect(s.submit).toHaveBeenCalledTimes(1);
  });
  test.each(["APPLIED", "IDEMPOTENT", "UNAVAILABLE", "AUTHORIZATION_DENIED"] as const)("unexpected negative response %s latches STOP without local apply/retry", async status => {
    const s = setup(); s.harness.arm("Samsung-A"); const p = s.harness.prepare("MUTABLE", patientId, s.head(), state)!;
    await s.gateway.submit({ exerciseId: "EX-TEST-1", patientId, commandId: "ADVANCE", kind: "MUTABLE", expectedRevision: 7, expectedOwnerUserId: "CM-A", nextOwnerUserId: "CM-A", state });
    s.submit.mockImplementationOnce(async (_r, observer) => { observer({ phase: "RESPONSE", attempt: 1, httpStatus: 200, status, revision: 9, serverErrorCode: null }); return { status, revision: 9 }; });
    expect(await s.harness.submit(p, true)).toMatchObject({ acceptanceViolation: true, result: { status } });
    expect(s.harness.getEvidence().at(-1)?.status).toBe(status); expect(s.harness.evidenceVisible()).toBe(true);
    expect(s.apply).not.toHaveBeenCalled(); expect(s.harness.arm("Samsung-A")).toBe(false);
    await s.harness.submit(p, true); expect(s.submit).toHaveBeenCalledTimes(1);
  });
});
