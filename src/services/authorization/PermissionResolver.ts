import type { AuthorizationContext, AuthorizationPermission, RoleAssignment } from "@/models/authorization/Authorization";

const rolePermissions = Object.freeze({
  CM: Object.freeze(["EXERCISE_JOIN", "CM_WORKFLOW_WRITE"] as const),
  EXCON: Object.freeze(["EXCON_EXERCISE_CONTROL", "EXERCISE_JOIN", "EXERCISE_RUNTIME_RECOVERY", "INSTRUCTOR_EVALUATION_READ", "INSTRUCTOR_EVALUATION_WRITE"] as const),
}) satisfies Readonly<Record<RoleAssignment["role"], readonly AuthorizationPermission[]>>;

export function assignmentMatchesContext(assignment: RoleAssignment, context: AuthorizationContext): boolean {
  if (assignment.scope.scopeType === "GLOBAL") return true;
  return Boolean(context.exerciseId && assignment.scope.scopeId === context.exerciseId);
}

export function assignmentIsEffective(assignment: RoleAssignment, verifiedAt?: string): boolean {
  return assignment.status === "ACTIVE" && (!assignment.expiresAt || !verifiedAt || assignment.expiresAt > verifiedAt);
}

export function resolvePermissions(assignments: readonly RoleAssignment[], context: AuthorizationContext = {}): readonly AuthorizationPermission[] {
  const active = assignments
    .filter(item => assignmentIsEffective(item) && assignmentMatchesContext(item, context))
    .sort((a, b) => `${a.role}:${a.scope.scopeType}:${a.scope.scopeType === "EXERCISE" ? a.scope.scopeId : ""}:${a.assignmentId}`
      .localeCompare(`${b.role}:${b.scope.scopeType}:${b.scope.scopeType === "EXERCISE" ? b.scope.scopeId : ""}:${b.assignmentId}`));
  return Object.freeze([...new Set(active.flatMap(item => rolePermissions[item.role] ?? []))].sort());
}

/** Principal capabilities are scope-independent; AuthorizationService applies target scope per operation. */
export function resolvePrincipalPermissions(assignments: readonly RoleAssignment[]): readonly AuthorizationPermission[] {
  const active = assignments.filter(item => assignmentIsEffective(item));
  return Object.freeze([...new Set(active.flatMap(item => rolePermissions[item.role] ?? []))].sort());
}

export function permissionsForRole(role: RoleAssignment["role"]): readonly AuthorizationPermission[] {
  return rolePermissions[role] ?? Object.freeze([]);
}
