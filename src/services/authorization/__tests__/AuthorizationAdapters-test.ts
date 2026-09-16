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
    const query = { select: () => query, eq: async () => ({ data: rows, error: null }) };
    const bootstrapQuery = { select: () => bootstrapQuery, eq: async () => ({ data: [], error: null }) };
    const client = { from: (table: string) => table === "authorization_role_assignments" ? query : bootstrapQuery };
    const result = await new SupabaseRoleAuthority(client as never, () => new Date("2026-08-12T01:00:00Z")).assignmentsFor("AUTH-USER");
    expect(result).toMatchObject({ state: "VERIFIED", assignments: [{ assignmentId: "A" }, { assignmentId: "B" }] });
  });
  it("rejects mismatched, unsupported or unavailable role data", async () => {
    const query = { select: () => query, eq: async () => ({ data: [{ id: "A", user_id: "OTHER", role: "EXCON", scope_type: "GLOBAL", scope_id: null, status: "ACTIVE", issued_at: "x", expires_at: null, issued_by: "ADMIN" }], error: null }) };
    const bootstrapQuery = { select: () => bootstrapQuery, eq: async () => ({ data: [], error: null }) };
    await expect(new SupabaseRoleAuthority({ from: (table: string) => table === "authorization_role_assignments" ? query : bootstrapQuery } as never).assignmentsFor("AUTH-USER")).resolves.toEqual({ state: "UNAVAILABLE" });
  });

  it("maps a short-lived bootstrap authorization to only the bootstrap role", async () => {
    const assignmentQuery = { select: () => assignmentQuery, eq: async () => ({ data: [], error: null }) };
    const bootstrapQuery = { select: () => bootstrapQuery, eq: async () => ({ data: [{ id: "BOOT-1", user_id: "AUTH-USER", status: "ACTIVE", issued_at: "2026-09-16T10:00:00Z", expires_at: "2026-09-16T10:15:00Z", issued_by: "ADMIN", consumed_exercise_id: null }], error: null }) };
    const client = { from: (table: string) => table === "authorization_role_assignments" ? assignmentQuery : bootstrapQuery };
    await expect(new SupabaseRoleAuthority(client as never, () => new Date("2026-09-16T10:01:00Z")).assignmentsFor("AUTH-USER"))
      .resolves.toMatchObject({ state: "VERIFIED", assignments: [{ role: "EXERCISE_BOOTSTRAP", scope: { scopeType: "GLOBAL" } }] });
  });
});
