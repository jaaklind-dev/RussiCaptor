import {
  grantExerciseBootstrap, grantExerciseRole, inviteAdminUser, listAdminExercises,
  listAdminUsers, requestAdminPasswordReset, revokeExerciseRole, revokeUnusedExerciseBootstrap,
  setAdminUserActive,
} from "../PlatformAdminService";

const mockInvoke = jest.fn();
jest.mock("@/services/SupabaseService", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));

describe("platform administration client", () => {
  beforeEach(() => mockInvoke.mockReset());

  test("AUTH-ADMIN-04/USER-01: invitation sends identity metadata, never a password", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await inviteAdminUser("cm@example.com", "CM Test");
    expect(mockInvoke).toHaveBeenCalledWith("platform-admin-users", { body: {
      operation: "invite", email: "cm@example.com", displayName: "CM Test",
    } });
    expect(JSON.stringify(mockInvoke.mock.calls)).not.toMatch(/password/i);
  });

  test("USER-03/04/05: lifecycle requests are bounded operations", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await requestAdminPasswordReset("cm@example.com");
    await setAdminUserActive("USER-1", false);
    await setAdminUserActive("USER-1", true);
    expect(mockInvoke.mock.calls.map(call => call[1].body.operation)).toEqual(["resetPassword", "deactivate", "reactivate"]);
  });

  test("EX-ADMIN/ROLE: list, bootstrap, scoped grant and exact revoke use separate calls", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, exercises: [] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, users: [] }, error: null })
      .mockResolvedValue({ data: { ok: true, authorization: { id: "BOOT-1", user_id: "USER-1",
        status: "ACTIVE", consumed_exercise_id: null, expires_at: "2026-10-07T00:10:00Z" } }, error: null });
    await listAdminExercises(); await listAdminUsers(); await grantExerciseBootstrap("USER-1");
    await revokeUnusedExerciseBootstrap("BOOT-1", "USER-1");
    await grantExerciseRole("USER-2", "EX-1", "CM");
    await revokeExerciseRole({ id: "ROLE-1", user_id: "USER-2", role: "CM", scope_id: "EX-1", status: "ACTIVE", issued_at: "2026-10-04T00:00:00Z" });
    expect(mockInvoke.mock.calls.map(call => [call[0], call[1].body.operation])).toEqual([
      ["platform-admin-exercises", "list"], ["platform-admin-users", "list"],
      ["platform-admin-exercises", "grantBootstrap"], ["platform-admin-exercises", "revokeBootstrap"],
      ["platform-admin-exercises", "grantRole"],
      ["platform-admin-exercises", "revokeRole"],
    ]);
  });

  test("fails closed on Edge Function error", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "FunctionsHttpError" } });
    await expect(listAdminUsers()).rejects.toThrow("FunctionsHttpError");
  });
});
