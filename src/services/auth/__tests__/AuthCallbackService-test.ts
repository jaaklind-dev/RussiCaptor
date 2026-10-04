import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AUTH_CALLBACK_URI,
  consumeAuthCallbackUrl,
  isAuthCallbackUrl,
  updateAuthenticatedPassword,
  validateNewPassword,
} from "../AuthCallbackService";

type AuthClient = Pick<SupabaseClient, "auth">;

function client(overrides: Partial<SupabaseClient["auth"]> = {}): AuthClient {
  return { auth: {
    setSession: jest.fn(async () => ({ data: { session: { user: { id: "USER" } } }, error: null })),
    getSession: jest.fn(async () => ({ data: { session: { user: { id: "USER" } } }, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: { id: "USER" } }, error: null })),
    ...overrides,
  } as unknown as SupabaseClient["auth"] };
}

describe("secure native Auth callback", () => {
  test("AUTH-CB-01: accepts only the canonical deep-link route", () => {
    expect(AUTH_CALLBACK_URI).toBe("russicaptor://auth/callback");
    expect(isAuthCallbackUrl(`${AUTH_CALLBACK_URI}#type=recovery`)).toBe(true);
    expect(isAuthCallbackUrl("https://example.test/auth/callback")).toBe(false);
    expect(isAuthCallbackUrl("russicaptor://auth/other")).toBe(false);
  });

  test.each(["invite", "recovery"] as const)("AUTH-CB-04/05: %s establishes a session then requests password setup", async flow => {
    const target = client();
    const result = await consumeAuthCallbackUrl(
      `${AUTH_CALLBACK_URI}#access_token=access-value&refresh_token=refresh-value&type=${flow}`,
      target,
    );
    expect(result).toEqual({ ok: true, flow });
    expect(target.auth.setSession).toHaveBeenCalledWith({ access_token: "access-value", refresh_token: "refresh-value" });
  });

  test("AUTH-CB-08: expired and missing sessions fail closed with bounded outcomes", async () => {
    const target = client();
    await expect(consumeAuthCallbackUrl(`${AUTH_CALLBACK_URI}#error=access_denied&type=recovery`, target))
      .resolves.toEqual({ ok: false, reason: "EXPIRED_OR_INVALID" });
    await expect(consumeAuthCallbackUrl(`${AUTH_CALLBACK_URI}#type=recovery`, target))
      .resolves.toEqual({ ok: false, reason: "MISSING_SESSION" });
    expect(target.auth.setSession).not.toHaveBeenCalled();
  });

  test("AUTH-CB-09: token-bearing callbacks are never written to console", async () => {
    const spies = [jest.spyOn(console, "log"), jest.spyOn(console, "warn"), jest.spyOn(console, "error")]
      .map(spy => spy.mockImplementation(() => undefined));
    await consumeAuthCallbackUrl(`${AUTH_CALLBACK_URI}#access_token=never-log&refresh_token=never-log&type=recovery`, client());
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    spies.forEach(spy => spy.mockRestore());
  });

  test("AUTH-CB-06: mismatch and short passwords are rejected locally", () => {
    expect(validateNewPassword("short", "short")).toContain("8");
    expect(validateNewPassword("sufficient-one", "sufficient-two")).toBe("Paroolid ei ühti.");
    expect(validateNewPassword("sufficient-one", "sufficient-one")).toBeUndefined();
  });

  test("AUTH-CB-07/10: password update requires an authenticated session and uses updateUser only", async () => {
    const target = client();
    await updateAuthenticatedPassword("private-password", target);
    expect(target.auth.getSession).toHaveBeenCalledTimes(1);
    expect(target.auth.updateUser).toHaveBeenCalledWith({ password: "private-password" });
    expect(JSON.stringify(target)).not.toContain("private-password");

    const missing = client({ getSession: jest.fn(async () => ({ data: { session: null }, error: null })) });
    await expect(updateAuthenticatedPassword("private-password", missing)).rejects.toThrow("seanss puudub");
    expect(missing.auth.updateUser).not.toHaveBeenCalled();
  });
});
