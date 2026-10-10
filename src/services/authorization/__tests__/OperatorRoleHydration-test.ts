import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const mockGetSession = jest.fn();
const mockGetUser = jest.fn();
const mockSignIn = jest.fn();
const mockRpc = jest.fn();
const mockProfile = jest.fn();
const mockRoleQuery = jest.fn();
let mockAuthCallback: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
const user = { id: "USER-A", email: "operator@example.test", is_anonymous: false };
const session = { user, expires_at: 2_000_000_000, access_token: "test-token" } as Session;
const assignment = { id: "ASSIGN-1", user_id: user.id, role: "CM", scope_type: "EXERCISE",
  scope_id: "EX-1", status: "ACTIVE", issued_at: "2026-10-10T00:00:00Z", expires_at: null,
  issued_by: "ADMIN-1" };
const mockSupabase = {
  auth: {
    getSession: mockGetSession, getUser: mockGetUser, signInWithPassword: mockSignIn,
    onAuthStateChange: (callback: typeof mockAuthCallback) => { mockAuthCallback = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } }; },
  },
  rpc: mockRpc,
  from: (table: string) => ({ select: () => ({ eq: () => table === "operator_profiles"
    ? { maybeSingle: mockProfile } : mockRoleQuery(table) }) }),
};
jest.mock("@/services/SupabaseService", () => ({ get supabase() { return mockSupabase; } }));
jest.mock("@/services/CurrentUserService", () => ({ setAuthenticatedCaseManager: jest.fn() }));

// eslint-disable-next-line import/first
import { getOperatorSession, resetOperatorSessionForTests, signInOperator, startOperatorSession }
  from "../OperatorSessionService";
// eslint-disable-next-line import/first
import { resolveSelectedModeNavigationTarget } from "@/services/ui/OperatorRouteService";

const ok = (table: string) => ({ data: table === "authorization_role_assignments" ? [assignment] : [],
  error: null, status: 200 });
const denied = { data: null, error: { message: "Unauthorized" }, status: 401 };

describe("AUTH-HYDRATE post-login role ordering", () => {
  beforeEach(() => {
    jest.useRealTimers(); resetOperatorSessionForTests(); mockAuthCallback = undefined;
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    mockGetUser.mockReset().mockResolvedValue({ data: { user }, error: null });
    mockSignIn.mockReset(); mockRpc.mockReset().mockResolvedValue({ data: false, error: null, status: 200 });
    mockProfile.mockReset().mockResolvedValue({ data: { user_id: user.id, display_name: "Operator" },
      error: null, status: 200 });
    mockRoleQuery.mockReset().mockImplementation((table: string) => Promise.resolve(ok(table)));
  });
  afterEach(() => { resetOperatorSessionForTests(); });

  test("AUTH-HYDRATE-01/02: later 200 for the current login survives an earlier completed 401", async () => {
    const stop = startOperatorSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockImplementation(async () => {
      mockAuthCallback?.("SIGNED_IN", session);
      return { data: { user, session }, error: null };
    });
    let releaseFirst!: () => void;
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    let reads = 0;
    mockRoleQuery.mockImplementation((table: string) => {
      const request = Math.floor(reads++ / 2);
      return request === 0 ? first.then(() => ok(table)) : Promise.resolve(denied);
    });
    const login = signInOperator(user.email, "not-a-real-password");
    await new Promise(resolve => setTimeout(resolve, 20));
    releaseFirst();
    await login;
    expect(getOperatorSession()).toMatchObject({ state: "AUTHENTICATED", profile: { userId: user.id } });
    expect(reads).toBe(2); // SIGNED_IN and submit share the one current-session read.
    stop();
  });

  test("AUTH-HYDRATE-04: a just-verified login retries one role 401 and accepts current roles", async () => {
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockResolvedValue({ data: { user, session }, error: null });
    let reads = 0;
    mockRoleQuery.mockImplementation((table: string) => Promise.resolve(
      Math.floor(reads++ / 2) === 0 ? denied : ok(table)));
    await expect(signInOperator(user.email, "not-a-real-password"))
      .resolves.toMatchObject({ state: "AUTHENTICATED", profile: { userId: user.id } });
    expect(reads).toBe(4);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  test("AUTH-HYDRATE-05: a second role 401 is terminal and never opens a route", async () => {
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockResolvedValue({ data: { user, session }, error: null });
    mockRoleQuery.mockResolvedValue(denied);
    const result = await signInOperator(user.email, "not-a-real-password");
    expect(result).toMatchObject({ state: "UNAUTHORIZED", userId: user.id });
    expect(mockRoleQuery).toHaveBeenCalledTimes(4);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(resolveSelectedModeNavigationTarget(result, undefined, "EX-1")).toBeUndefined();
  });

  test("AUTH-HYDRATE-05b: role 403 is definitive without a post-login retry", async () => {
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockResolvedValue({ data: { user, session }, error: null });
    mockRoleQuery.mockResolvedValue({ ...denied, status: 403 });
    await expect(signInOperator(user.email, "not-a-real-password"))
      .resolves.toMatchObject({ state: "UNAUTHORIZED", userId: user.id });
    expect(mockRoleQuery).toHaveBeenCalledTimes(2);
  });

  test("AUTH-HYDRATE-06/07/11: current roles route away from login; no roles show role denial", async () => {
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockResolvedValue({ data: { user, session }, error: null });
    const authorized = await signInOperator(user.email, "not-a-real-password");
    expect(resolveSelectedModeNavigationTarget(authorized, undefined, "EX-1")).toBe("/mode");
    mockRoleQuery.mockImplementation((table: string) => Promise.resolve({ ...ok(table), data: [] }));
    const withoutRole = await signInOperator(user.email, "not-a-real-password");
    expect(withoutRole).toMatchObject({ state: "UNAUTHORIZED", message: "Operaatorile pole aktiivset rolli määratud." });
    expect(resolveSelectedModeNavigationTarget(withoutRole, undefined, "EX-1")).toBeUndefined();
  });

  test("AUTH-HYDRATE-08: invalid credentials never become a role error or role query", async () => {
    mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: { status: 400 } });
    await expect(signInOperator(user.email, "not-a-real-password"))
      .rejects.toThrow("Kontrolli kasutajatunnust ja parooli");
    expect(mockRoleQuery).not.toHaveBeenCalled();
    expect(getOperatorSession().state).toBe("UNAUTHENTICATED");
  });

  test("AUTH-HYDRATE-09: logout invalidates a pending successful role response", async () => {
    const stop = startOperatorSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockImplementation(async () => {
      mockAuthCallback?.("SIGNED_IN", session);
      return { data: { user, session }, error: null };
    });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    mockRoleQuery.mockImplementation((table: string) => pending.then(() => ok(table)));
    const login = signInOperator(user.email, "not-a-real-password");
    await new Promise(resolve => setTimeout(resolve, 20));
    mockAuthCallback?.("SIGNED_OUT", null);
    release();
    await login;
    expect(getOperatorSession().state).toBe("UNAUTHENTICATED");
    stop();
  });

  test("AUTH-HYDRATE-10: token refresh shares an in-flight current-session read", async () => {
    const stop = startOperatorSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockImplementation(async () => {
      mockAuthCallback?.("SIGNED_IN", session);
      return { data: { user, session }, error: null };
    });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    mockRoleQuery.mockImplementation((table: string) => pending.then(() => ok(table)));
    const login = signInOperator(user.email, "not-a-real-password");
    mockAuthCallback?.("TOKEN_REFRESHED", session);
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    await login;
    expect(getOperatorSession().state).toBe("AUTHENTICATED");
    expect(mockRoleQuery).toHaveBeenCalledTimes(2);
    stop();
  });

  test("AUTH-HYDRATE-03/12: an old-session 200 cannot authorize a newer identity", async () => {
    const stop = startOperatorSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockImplementation(async () => {
      mockAuthCallback?.("SIGNED_IN", session);
      return { data: { user, session }, error: null };
    });
    let releaseOld!: () => void;
    const oldPending = new Promise<void>(resolve => { releaseOld = resolve; });
    let reads = 0;
    mockRoleQuery.mockImplementation((table: string) => {
      const request = Math.floor(reads++ / 2);
      return request === 0 ? oldPending.then(() => ok(table))
        : Promise.resolve({ ...ok(table), data: table === "authorization_role_assignments"
          ? [{ ...assignment, user_id: "USER-B", id: "ASSIGN-B" }] : [] });
    });
    const oldLogin = signInOperator(user.email, "not-a-real-password");
    await new Promise(resolve => setTimeout(resolve, 20));
    mockAuthCallback?.("SIGNED_OUT", null);
    const nextUser = { ...user, id: "USER-B" };
    const nextSession = { ...session, user: nextUser } as Session;
    mockGetSession.mockResolvedValue({ data: { session: nextSession }, error: null });
    mockGetUser.mockResolvedValue({ data: { user: nextUser }, error: null });
    mockProfile.mockResolvedValue({ data: { user_id: nextUser.id, display_name: "Next operator" },
      error: null, status: 200 });
    mockAuthCallback?.("SIGNED_IN", nextSession);
    await new Promise(resolve => setTimeout(resolve, 20));
    releaseOld();
    await oldLogin;
    expect(getOperatorSession()).toMatchObject({ state: "AUTHENTICATED", profile: { userId: "USER-B" } });
    stop();
  });

  test("AUTH-HYDRATE-12b: old same-user success cannot replace a newer refresh denial", async () => {
    const stop = startOperatorSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    mockSignIn.mockImplementation(async () => {
      mockAuthCallback?.("SIGNED_IN", session);
      return { data: { user, session }, error: null };
    });
    let releaseOld!: () => void;
    const oldPending = new Promise<void>(resolve => { releaseOld = resolve; });
    let reads = 0;
    mockRoleQuery.mockImplementation((table: string) => {
      const request = Math.floor(reads++ / 2);
      return request === 0 ? oldPending.then(() => ok(table))
        : Promise.resolve({ ...ok(table), data: [] });
    });
    const login = signInOperator(user.email, "not-a-real-password");
    await new Promise(resolve => setTimeout(resolve, 20));
    mockAuthCallback?.("TOKEN_REFRESHED", session);
    await new Promise(resolve => setTimeout(resolve, 20));
    releaseOld();
    await login;
    expect(getOperatorSession()).toMatchObject({ state: "UNAUTHORIZED", userId: user.id });
    stop();
  });
});
