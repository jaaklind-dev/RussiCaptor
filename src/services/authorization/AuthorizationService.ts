import type {
  AuthorizationContext, AuthorizationDecision, AuthorizationPermission, PrincipalState,
} from "@/models/authorization/Authorization";
import { deepFreeze } from "@/utils/immutable";
import { assignmentIsEffective, assignmentMatchesContext, permissionsForRole } from "./PermissionResolver";
import { createAuthorizationAuditEntry, inMemoryAuthorizationAuditSink, type AuthorizationAuditSink } from "./AuthorizationAuditService";

export class AuthorizationService {
  constructor(private readonly audit: AuthorizationAuditSink = inMemoryAuthorizationAuditSink, private readonly now = () => new Date().toISOString()) {}

  async authorize(state: PrincipalState, permission: AuthorizationPermission, context: AuthorizationContext = {}): Promise<AuthorizationDecision> {
    let decision: AuthorizationDecision;
    if (state.state === "UNAUTHENTICATED") decision = { status: "DENIED", permission, context, reason: "UNAUTHENTICATED" };
    else if (state.state === "UNAVAILABLE") decision = { status: "DENIED", userId: state.userId, permission, context, reason: "AUTHORIZATION_UNAVAILABLE" };
    else {
      const principal = state.principal;
      if (principal.authorizationFreshness === "STALE" || principal.authorizationFreshness === "VERIFIED_CACHED") {
        decision = { status: "DENIED", userId: principal.userId, permission, context, reason: "AUTHORIZATION_STALE" };
      } else if (principal.authorizationFreshness !== "VERIFIED_ONLINE") {
        decision = { status: "DENIED", userId: principal.userId, permission, context, reason: "AUTHORIZATION_UNAVAILABLE" };
      } else {
        const active = principal.roleAssignments.filter(item => assignmentIsEffective(item, principal.authorizationProvenance.verifiedAt));
        const matching = active.filter(item => assignmentMatchesContext(item, context));
        const granting = matching.filter(item => permissionsForRole(item.role).includes(permission));
        if (!active.length) decision = { status: "DENIED", userId: principal.userId, permission, context, reason: "ROLE_NOT_ASSIGNED" };
        else if (!matching.length) decision = { status: "DENIED", userId: principal.userId, permission, context, reason: "SCOPE_MISMATCH" };
        else if (!granting.length || !principal.permissions.includes(permission)) decision = { status: "DENIED", userId: principal.userId, permission, context, reason: "PERMISSION_DENIED" };
        else decision = { status: "AUTHORIZED", userId: principal.userId, permission, context, freshness: "VERIFIED_ONLINE", assignmentIds: Object.freeze(granting.map(item => item.assignmentId).sort()) };
      }
    }
    const immutable = deepFreeze(decision);
    try {
      await this.audit.append(createAuthorizationAuditEntry({ decision: immutable, permission, occurredAt: this.now() }));
      return immutable;
    } catch {
      return deepFreeze({ status: "DENIED", userId: immutable.userId, permission, context, reason: "AUTHORIZATION_UNAVAILABLE" });
    }
  }

  async can(state: PrincipalState, permission: AuthorizationPermission, context: AuthorizationContext = {}): Promise<boolean> {
    return (await this.authorize(state, permission, context)).status === "AUTHORIZED";
  }
}

export const authorizationService = new AuthorizationService();
