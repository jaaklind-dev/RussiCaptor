export const authorizationRoles = ["EXCON"] as const;
export type AuthorizationRole = (typeof authorizationRoles)[number];

export const authorizationPermissions = [
  "INSTRUCTOR_EVALUATION_READ",
  "INSTRUCTOR_EVALUATION_WRITE",
  "EXERCISE_RUNTIME_RECOVERY",
] as const;
export type AuthorizationPermission = (typeof authorizationPermissions)[number];
export type AuthorizationScope = Readonly<
  | { scopeType: "GLOBAL" }
  | { scopeType: "EXERCISE"; scopeId: string }
>;
export type AuthorizationFreshness = "VERIFIED_ONLINE" | "VERIFIED_CACHED" | "STALE" | "UNAVAILABLE";

export type RoleAssignment = Readonly<{
  assignmentId: string;
  userId: string;
  role: AuthorizationRole;
  scope: AuthorizationScope;
  status: "ACTIVE" | "REVOKED";
  issuedAt: string;
  expiresAt?: string;
  issuedBy: string;
}>;

export type AuthenticatedIdentity = Readonly<{ userId: string; sessionExpiresAt?: string }>;
export type AuthorizationProvenance = Readonly<{
  authority: "SUPABASE_ROLE_ASSIGNMENTS";
  verifiedAt: string;
  expiresAt: string;
}>;
export type Principal = Readonly<{
  userId: string;
  authenticationState: "AUTHENTICATED";
  roleAssignments: readonly RoleAssignment[];
  permissions: readonly AuthorizationPermission[];
  authorizationFreshness: AuthorizationFreshness;
  authorizationProvenance: AuthorizationProvenance;
}>;
export type PrincipalState =
  | Readonly<{ state: "AUTHENTICATED"; principal: Principal }>
  | Readonly<{ state: "UNAUTHENTICATED" }>
  | Readonly<{ state: "UNAVAILABLE"; userId?: string }>;

export type AuthorizationContext = Readonly<{ exerciseId?: string }>;
export type AuthorizationDeniedReason =
  | "UNAUTHENTICATED"
  | "ROLE_NOT_ASSIGNED"
  | "PERMISSION_DENIED"
  | "AUTHORIZATION_UNAVAILABLE"
  | "AUTHORIZATION_STALE"
  | "SCOPE_MISMATCH";
export type AuthorizationDecision =
  | Readonly<{
      status: "AUTHORIZED";
      userId: string;
      permission: AuthorizationPermission;
      context: AuthorizationContext;
      freshness: "VERIFIED_ONLINE";
      assignmentIds: readonly string[];
    }>
  | Readonly<{
      status: "DENIED";
      userId?: string;
      permission: AuthorizationPermission;
      context: AuthorizationContext;
      reason: AuthorizationDeniedReason;
    }>;

export type AuthorizationAuditEntry = Readonly<{
  auditId: string;
  userId?: string;
  permission: AuthorizationPermission;
  exerciseId?: string;
  decision: "AUTHORIZED" | "DENIED";
  reason?: AuthorizationDeniedReason;
  freshness?: AuthorizationFreshness;
  assignmentIds: readonly string[];
  occurredAt: string;
}>;
