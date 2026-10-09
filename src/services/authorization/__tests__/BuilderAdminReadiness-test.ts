import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const mockGetSession = jest.fn();
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockProfile = jest.fn();
const mockRoleQuery = jest.fn();
let mockAuthCallback: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
const mockSession = { user: { id: "ADMIN-1", is_anonymous: false }, expires_at: 2_000_000_000 } as Session;
const mockSupabase = {
  auth: {
    getSession: mockGetSession, getUser: mockGetUser,
    onAuthStateChange: (callback: typeof mockAuthCallback) => { mockAuthCallback = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } }; },
  },
  rpc: mockRpc,
  from: (table: string) => ({ select: () => ({ eq: () => table === "operator_profiles"
    ? { maybeSingle: mockProfile } : mockRoleQuery(table) }) }),
};
jest.mock("@/services/SupabaseService", () => ({ get supabase() { return mockSupabase; } }));
jest.mock("@/services/CurrentUserService", () => ({ setAuthenticatedCaseManager: jest.fn() }));

// The service import follows the initialized mock client so its module-level
// Supabase reference cannot read an uninitialized test binding.
// eslint-disable-next-line import/first
import { getOperatorSession, refreshOperatorSession, resetOperatorSessionForTests,
  startOperatorSession } from "../OperatorSessionService";

const confirmed = async () => {
  await refreshOperatorSession();
  expect({ session: mockGetSession.mock.calls.length, user: mockGetUser.mock.calls.length,
    roles: mockRoleQuery.mock.calls.length, rpc: mockRpc.mock.calls.length,
    profile: mockProfile.mock.calls.length }).toEqual({ session: 1, user: 1, roles: 2, rpc: 1, profile: 1 });
  expect(getOperatorSession()).toMatchObject({ state: "AUTHENTICATED", isPlatformAdmin: true });
};

describe("BUILDER-AUTHREADY platform-admin refresh", () => {
  beforeEach(() => {
    jest.useRealTimers(); resetOperatorSessionForTests(); mockAuthCallback = undefined;
    mockGetSession.mockReset().mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetUser.mockReset().mockResolvedValue({ data: { user: mockSession.user }, error: null });
    mockRpc.mockReset().mockResolvedValue({ data: true, error: null, status: 200 });
    mockProfile.mockReset().mockResolvedValue({ data: { user_id: "ADMIN-1", display_name: "Admin" },
      error: null, status: 200 });
    mockRoleQuery.mockReset().mockImplementation(() => Promise.resolve({ data: [], error: null, status: 200 }));
  });
  afterEach(() => { jest.useRealTimers(); resetOperatorSessionForTests(); });

  test("01 confirmed admin enters Builder through the canonical session", async () => {
    await confirmed();
  });

  test("02/08/09 confirmed authority stays usable during a stalled refresh", async () => {
    await confirmed();
    let release!: (value: unknown) => void;
    mockGetSession.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = refreshOperatorSession();
    expect(getOperatorSession()).toMatchObject({ state: "AUTHENTICATED", isPlatformAdmin: true,
      authorityRefresh: "REFRESHING" });
    // The Builder owns its draft state; a session refresh does not replace that component.
    release({ data: { session: mockSession }, error: null });
    await expect(pending).resolves.toMatchObject({ state: "AUTHENTICATED", isPlatformAdmin: true });
  });

  test("03/12 stalled refresh reaches bounded transient error, not endless loading", async () => {
    await confirmed();
    jest.useFakeTimers();
    mockGetSession.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = refreshOperatorSession();
    await jest.advanceTimersByTimeAsync(8_001);
    await expect(pending).resolves.toMatchObject({ state: "AUTHENTICATED", authorityRefresh: "TRANSIENT_ERROR" });
  });

  test("04 one transient service failure retries automatically without dropping prior authority", async () => {
    await confirmed();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "unavailable" }, status: 503 });
    await expect(refreshOperatorSession()).resolves.toMatchObject({ state: "AUTHENTICATED", isPlatformAdmin: true });
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });

  test("05 definitive 403 revokes Builder authority", async () => {
    await confirmed();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden" }, status: 403 });
    await expect(refreshOperatorSession()).resolves.toMatchObject({ state: "UNAUTHORIZED", userId: "ADMIN-1" });
  });

  test("06 a different authenticated identity invalidates the prior admin", async () => {
    await confirmed();
    mockGetSession.mockResolvedValue({ data: { session: { ...mockSession, user: { id: "USER-2" } } }, error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "USER-2", is_anonymous: false } }, error: null });
    const pending = refreshOperatorSession("USER-2");
    expect(getOperatorSession().state).toBe("LOADING");
    mockRpc.mockResolvedValueOnce({ data: false, error: null, status: 200 });
    await expect(pending).resolves.toMatchObject({ state: "UNAUTHORIZED", userId: "USER-2" });
  });

  test("07 older completion cannot replace a newer identity generation", async () => {
    await confirmed();
    let releaseOld!: (value: unknown) => void;
    mockGetSession.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }));
    const older = refreshOperatorSession();
    const newer = refreshOperatorSession("USER-2");
    await newer;
    releaseOld({ data: { session: mockSession }, error: null });
    await older;
    expect(getOperatorSession().state).not.toBe("AUTHENTICATED");
  });

  test("10 auth callback defers Supabase calls until its lock is released", async () => {
    const stop = startOperatorSession();
    await refreshOperatorSession();
    mockGetSession.mockClear();
    let insideCallback = true;
    mockGetSession.mockImplementation(() => insideCallback
      ? new Promise(() => undefined) : Promise.resolve({ data: { session: mockSession }, error: null }));
    mockAuthCallback?.("TOKEN_REFRESHED", mockSession);
    insideCallback = false;
    expect(mockGetSession).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mockGetSession).toHaveBeenCalled();
    expect(getOperatorSession()).toMatchObject({ state: "AUTHENTICATED", isPlatformAdmin: true });
    stop();
  });

  test("11 logout clears confirmed authority immediately", async () => {
    const stop = startOperatorSession();
    await refreshOperatorSession();
    mockAuthCallback?.("SIGNED_OUT", null);
    expect(getOperatorSession().state).toBe("UNAUTHENTICATED");
    stop();
  });

  test("12 initial stalled authority check becomes a retryable error", async () => {
    jest.useFakeTimers();
    mockGetSession.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = refreshOperatorSession();
    expect(getOperatorSession().state).toBe("LOADING");
    await jest.advanceTimersByTimeAsync(8_001);
    await expect(pending).resolves.toMatchObject({ state: "UNAVAILABLE" });
  });
});
