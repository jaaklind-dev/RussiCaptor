import { SupabaseAuthenticationAdapter } from "../SupabaseAuthenticationAdapter";
import { SupabaseRoleAuthority } from "../SupabaseRoleAuthority";

describe("Supabase authorization adapters", () => {
  it("anchors authentication to getUser instead of display or route state", async () => {
    const client = { auth: { getSession: async () => ({ data: { session: { expires_at: 1786500000 } }, error: null }), getUser: async () => ({ data: { user: { id: "AUTH-USER" } }, error: null }) } };
    await expect(new SupabaseAuthenticationAdapter(client as never).currentIdentity()).resolves.toMatchObject({ state: "AUTHENTICATED", identity: { userId: "AUTH-USER" } });
  });
  it("fails closed when authentication cannot be verified", async () => {
    const unavailable = { auth: { getSession: async () => ({ data: { session: undefined }, error: new Error("offline") }) } };
    await expect(new SupabaseAuthenticationAdapter(unavailable as never).currentIdentity()).resolves.toEqual({ state: "UNAVAILABLE" });
  });
  it("maps only authoritative rows bound to the requested user and canonical order", async () => {
    const rows = [{ id: "B", user_id: "AUTH-USER", role: "EXCON", scope_type: "GLOBAL", scope_id: null, status: "ACTIVE", issued_at: "2026-08-12T00:00:00Z", expires_at: null, issued_by: "ADMIN" }, { id: "A", user_id: "AUTH-USER", role: "EXCON", scope_type: "EXERCISE", scope_id: "EX-1", status: "ACTIVE", issued_at: "2026-08-12T00:00:00Z", expires_at: null, issued_by: "ADMIN" }];
    const query = { select: () => query, eq: async () => ({ data: rows, error: null }) }; const client = { from: () => query };
    const result = await new SupabaseRoleAuthority(client as never, () => new Date("2026-08-12T01:00:00Z")).assignmentsFor("AUTH-USER");
    expect(result).toMatchObject({ state: "VERIFIED", assignments: [{ assignmentId: "A" }, { assignmentId: "B" }] });
  });
  it("rejects mismatched, unsupported or unavailable role data", async () => {
    const query = { select: () => query, eq: async () => ({ data: [{ id: "A", user_id: "OTHER", role: "EXCON", scope_type: "GLOBAL", scope_id: null, status: "ACTIVE", issued_at: "x", expires_at: null, issued_by: "ADMIN" }], error: null }) };
    await expect(new SupabaseRoleAuthority({ from: () => query } as never).assignmentsFor("AUTH-USER")).resolves.toEqual({ state: "UNAVAILABLE" });
  });
});
