import type { Principal, PrincipalState } from "@/models/authorization/Authorization";
import { deepFreeze } from "@/utils/immutable";
import type { AuthorizationCache } from "./AuthorizationCache";
import type { SupabaseAuthenticationAdapter } from "./SupabaseAuthenticationAdapter";
import { resolvePrincipalPermissions } from "./PermissionResolver";
import type { SupabaseRoleAuthority } from "./SupabaseRoleAuthority";

export class PrincipalService {
  constructor(private readonly authentication: SupabaseAuthenticationAdapter, private readonly roles: SupabaseRoleAuthority, private readonly cache?: AuthorizationCache) {}
  async resolve(): Promise<PrincipalState> {
    const auth = await this.authentication.currentIdentity();
    if (auth.state !== "AUTHENTICATED") { if (auth.state === "UNAUTHENTICATED") await this.cache?.clear(); return Object.freeze({ state: auth.state }); }
    const result = await this.roles.assignmentsFor(auth.identity.userId);
    if (result.state === "VERIFIED") {
      const currentAssignments = result.assignments.filter(item => !item.expiresAt || item.expiresAt > result.verifiedAt);
      const principal: Principal = deepFreeze({ userId: auth.identity.userId, authenticationState: "AUTHENTICATED", roleAssignments: result.assignments, permissions: resolvePrincipalPermissions(currentAssignments), authorizationFreshness: "VERIFIED_ONLINE", authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: result.verifiedAt, expiresAt: result.expiresAt } });
      await this.cache?.store(principal); return Object.freeze({ state: "AUTHENTICATED", principal });
    }
    const cached = await this.cache?.load(auth.identity.userId);
    return cached ? Object.freeze({ state: "AUTHENTICATED", principal: cached }) : Object.freeze({ state: "UNAVAILABLE", userId: auth.identity.userId });
  }
}
