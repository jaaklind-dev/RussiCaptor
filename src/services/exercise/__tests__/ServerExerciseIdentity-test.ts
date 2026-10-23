import { supabase } from "@/services/SupabaseService";
import { allocateServerExerciseIdentity, exerciseAllocationRequestId } from "../ServerExerciseIdentity";
jest.mock("@/services/SupabaseService", () => ({ supabase: { rpc: jest.fn() } }));
const requestId = "10000000-0000-4000-8000-000000000001";
const bootstrapId = "20000000-0000-4000-8000-000000000002";
const id = "EX-30000000-0000-4000-8000-000000000003";
const rpc = supabase!.rpc as jest.Mock;
beforeEach(() => { rpc.mockReset(); });
test("same actor and operation keep the request identity across cache loss", () => {
  expect(exerciseAllocationRequestId("A", "OP")).toBe(exerciseAllocationRequestId("A", "OP"));
  expect(exerciseAllocationRequestId("A", "OP")).not.toBe(exerciseAllocationRequestId("B", "OP"));
  expect(exerciseAllocationRequestId("A", "OP")).not.toBe(exerciseAllocationRequestId("A", "NEXT"));
});
test("uses only server allocation and exact immutable request/token/purpose", async () => {
  rpc.mockResolvedValue({ data: id, error: null });
  await expect(allocateServerExerciseIdentity({ requestId, bootstrapId, purpose: "ADMIN" })).resolves.toBe(id);
  expect(rpc).toHaveBeenCalledWith("allocate_exercise_identity", {
    p_request_id: requestId, p_bootstrap_id: bootstrapId, p_purpose: "ADMIN",
  });
});
test.each(["CREATE", "ADMIN", "BUILDER", "PACKAGE", "CLONE", "RESTORE_AS_NEW"] as const)("%s uses the same allocator", async purpose => {
  rpc.mockResolvedValue({ data: id, error: null });
  await expect(allocateServerExerciseIdentity({ requestId, bootstrapId, purpose })).resolves.toBe(id);
});
test.each([null, "", "historical-id", "EX-123", {}, [id]])("invalid server identity fails closed: %p", async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(allocateServerExerciseIdentity({ requestId, bootstrapId, purpose: "CREATE" })).rejects.toThrow("INVALID_RESPONSE");
});
test("backend errors never become a local ID or leak backend text", async () => {
  rpc.mockResolvedValue({ data: id, error: { message: "SYNTHETIC_PRIVATE_ERROR" } });
  await expect(allocateServerExerciseIdentity({ requestId, bootstrapId, purpose: "CREATE" })).rejects.toThrow("EXERCISE_ALLOCATION_REJECTED");
  expect(rpc).toHaveBeenCalledTimes(1);
});
test("malformed request never reaches RPC", async () => {
  await expect(allocateServerExerciseIdentity({ requestId: "caller-selected-id", bootstrapId, purpose: "CREATE" })).rejects.toThrow("INVALID_REQUEST");
  expect(rpc).not.toHaveBeenCalled();
});
