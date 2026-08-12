import type { AuthorizationContext, AuthorizationDecision, AuthorizationPermission, PrincipalState } from "@/models/authorization/Authorization";
import { supabase } from "@/services/SupabaseService";
import { FileAuthorizationCache } from "./authorization/AuthorizationCache";
import { AuthorizationService, authorizationService } from "./authorization/AuthorizationService";
import { PrincipalService } from "./authorization/PrincipalService";
import { SupabaseAuthenticationAdapter } from "./authorization/SupabaseAuthenticationAdapter";
import { SupabaseRoleAuthority } from "./authorization/SupabaseRoleAuthority";
import { SupabaseAuthorizationAuditSink } from "./authorization/SupabaseAuthorizationAuditSink";

let current: PrincipalState = Object.freeze({ state: "UNAVAILABLE" });
const resolver = supabase ? new PrincipalService(new SupabaseAuthenticationAdapter(supabase), new SupabaseRoleAuthority(supabase), new FileAuthorizationCache()) : undefined;
const productionAuthorizationService = supabase ? new AuthorizationService(new SupabaseAuthorizationAuditSink(supabase)) : authorizationService;

export async function refreshAuthorizationPrincipal(): Promise<PrincipalState> {
  current = resolver ? await resolver.resolve() : Object.freeze({ state: "UNAVAILABLE" });
  return current;
}
export function getAuthorizationPrincipal(): PrincipalState { return current; }
export function authorizeCurrentPrincipal(permission: AuthorizationPermission, context: AuthorizationContext = {}): Promise<AuthorizationDecision> {
  return productionAuthorizationService.authorize(current, permission, context);
}
