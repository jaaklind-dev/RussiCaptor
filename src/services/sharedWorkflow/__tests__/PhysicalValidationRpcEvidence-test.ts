import { supabase } from "@/services/SupabaseService";
import { supabaseSharedWorkflowGateway, type SharedWorkflowMutationRequest, type SharedWorkflowRpcObserver } from "../SharedWorkflowMutationService";
jest.mock("@/services/SupabaseService", () => ({ supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn() } }));
const actor = "11111111-1111-1111-1111-111111111111";
const request: SharedWorkflowMutationRequest = { exerciseId: "EX-TEST-1", patientId: "PT-PELVIC-001", commandId: "SW-VALIDATION-1", kind: "APPEND", expectedRevision: 7, expectedOwnerUserId: actor, nextOwnerUserId: actor, state: { patient: { private: "NEVER_EXPORT" } } };
describe("real Supabase gateway evidence projection (mock transport, no production I/O)", () => {
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(supabase!.auth.getSession).mockResolvedValue({ data: { session: { user: { id: actor, is_anonymous: false } } }, error: null } as never); });
  test("captures actual typed stale response, HTTP status and no invented correlation", async () => {
    jest.mocked(supabase!.rpc).mockResolvedValue({ data: [{ status: "STALE_VERSION", revision: 8, owner_user_id: actor, state: request.state }], status: 200, error: null } as never);
    const observer = jest.fn() as jest.MockedFunction<SharedWorkflowRpcObserver>;
    const result = await supabaseSharedWorkflowGateway.submit(request, observer, { operatorId: actor, valid: () => true });
    expect(result.status).toBe("STALE_VERSION"); expect(observer.mock.calls.map(([e]) => e.phase)).toEqual(["SUBMITTED", "RESPONSE"]);
    expect(observer.mock.calls[1][0]).toMatchObject({ status: "STALE_VERSION", httpStatus: 200, revision: 8, serverErrorCode: null });
    expect(JSON.stringify(observer.mock.calls)).not.toContain("NEVER_EXPORT");
  });
  test("structured server error code retained, raw error/credentials never exported", async () => {
    jest.mocked(supabase!.rpc).mockResolvedValue({ data: null, status: 403, error: { code: "42501", message: "AUTHORIZATION_DENIED password=PRIVATE access_token=PRIVATE refresh_token=PRIVATE" } } as never);
    const observer = jest.fn(); await supabaseSharedWorkflowGateway.submit(request, observer);
    expect(observer.mock.calls[1][0]).toMatchObject({ httpStatus: 403, status: "AUTHORIZATION_DENIED", serverErrorCode: "42501" });
    expect(JSON.stringify(observer.mock.calls)).not.toMatch(/PRIVATE|password|access_token|refresh_token|patient/);
  });
  test("lost-response retry uses identical parameters and records both real calls", async () => {
    jest.mocked(supabase!.rpc).mockResolvedValueOnce({ data: null, status: 0, error: { code: "", message: "network response lost" } } as never)
      .mockResolvedValueOnce({ data: [{ status: "IDEMPOTENT", revision: 8, owner_user_id: actor }], status: 200, error: null } as never);
    const observer = jest.fn(); expect((await supabaseSharedWorkflowGateway.submit(request, observer)).status).toBe("IDEMPOTENT");
    expect(supabase!.rpc).toHaveBeenCalledTimes(2); expect(jest.mocked(supabase!.rpc).mock.calls[0]).toEqual(jest.mocked(supabase!.rpc).mock.calls[1]);
    expect(observer.mock.calls.map(([e]) => [e.phase, e.attempt])).toEqual([["SUBMITTED",1],["TRANSPORT_UNKNOWN",1],["SUBMITTED",2],["RESPONSE",2]]);
    expect(observer.mock.calls[1][0].httpStatus).toBeNull();
  });
  test("Auth identity mismatch rejects before any RPC", async () => {
    const observer = jest.fn(); const outcome = await supabaseSharedWorkflowGateway.submit(request, observer, { operatorId: "OTHER", valid: () => true });
    expect(outcome.status).toBe("AUTHORIZATION_DENIED"); expect(supabase!.rpc).not.toHaveBeenCalled(); expect(observer.mock.calls[0][0].phase).toBe("LOCAL");
  });
  test("changed session during asynchronous Auth lookup rejects before send", async () => {
    let valid = true;
    jest.mocked(supabase!.auth.getSession).mockImplementationOnce(async () => { valid = false; return { data: { session: { user: { id: actor } } }, error: null } as never; });
    await supabaseSharedWorkflowGateway.submit(request, jest.fn(), { operatorId: actor, valid: () => valid }); expect(supabase!.rpc).not.toHaveBeenCalled();
  });
  test("lost-response retry cannot cross a changed session", async () => {
    let valid = true;
    jest.mocked(supabase!.rpc).mockImplementationOnce((() => { valid = false;
      return Promise.resolve({ data: null, error: { code: "", message: "lost" }, status: 0 }); }) as never);
    await expect(supabaseSharedWorkflowGateway.submit(request, jest.fn(), { operatorId: actor, valid: () => valid })).rejects.toThrow("VALIDATION_BINDING_CHANGED");
    expect(supabase!.rpc).toHaveBeenCalledTimes(1);
  });
  test("transport exceptions have unknown HTTP status and no raw error logging", async () => {
    jest.mocked(supabase!.rpc).mockRejectedValueOnce(new Error("PRIVATE")); const observer = jest.fn();
    await expect(supabaseSharedWorkflowGateway.submit(request, observer)).rejects.toThrow();
    expect(observer.mock.calls.at(-1)![0]).toMatchObject({ phase: "TRANSPORT_UNKNOWN", httpStatus: null, revision: null }); expect(JSON.stringify(observer.mock.calls)).not.toContain("PRIVATE");
  });
  test("diagnostic observer exceptions do not change production command semantics", async () => {
    jest.mocked(supabase!.rpc).mockResolvedValue({ data: [{ status: "APPLIED", revision: 8 }], status: 200, error: null } as never);
    expect((await supabaseSharedWorkflowGateway.submit(request, () => { throw Error("observer"); })).status).toBe("APPLIED");
  });
  test("negative TEST disables SDK and gateway retries, preserving the actual response", async () => {
    const retry = jest.fn().mockResolvedValue({ data: null, status: 0, error: { code: "", message: "lost" } });
    jest.mocked(supabase!.rpc).mockReturnValue({ retry } as never);
    const observer = jest.fn();
    expect((await supabaseSharedWorkflowGateway.submit(request, observer, { operatorId: actor, valid: () => true, negativeTest: true })).status).toBe("UNAVAILABLE");
    expect(supabase!.rpc).toHaveBeenCalledTimes(1); expect(retry).toHaveBeenCalledWith(false);
    expect(observer.mock.calls.map(([e]) => e.phase)).toEqual(["SUBMITTED", "TRANSPORT_UNKNOWN"]);
  });
});
