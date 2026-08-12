import type { AuthorizationAuditEntry, AuthorizationDecision, AuthorizationPermission } from "@/models/authorization/Authorization";
import { deepFreeze } from "@/utils/immutable";

export type AuthorizationAuditSink = { append(entry: AuthorizationAuditEntry): Promise<void> };
const entries: AuthorizationAuditEntry[] = [];
let sequence = 0;

export function createAuthorizationAuditEntry(input: Readonly<{
  decision: AuthorizationDecision;
  permission: AuthorizationPermission;
  occurredAt: string;
}>): AuthorizationAuditEntry {
  sequence += 1;
  return deepFreeze({
    auditId: `AUTH-AUDIT-${sequence}`,
    userId: input.decision.userId,
    permission: input.permission,
    exerciseId: input.decision.context.exerciseId,
    decision: input.decision.status,
    reason: input.decision.status === "DENIED" ? input.decision.reason : undefined,
    freshness: input.decision.status === "AUTHORIZED" ? input.decision.freshness : undefined,
    assignmentIds: input.decision.status === "AUTHORIZED" ? input.decision.assignmentIds : [],
    occurredAt: input.occurredAt,
  });
}

export const inMemoryAuthorizationAuditSink: AuthorizationAuditSink = {
  async append(entry) { entries.push(deepFreeze(structuredClone(entry))); },
};
export function getAuthorizationAudit(): readonly AuthorizationAuditEntry[] { return deepFreeze(structuredClone(entries)); }
export function resetAuthorizationAudit(): void { entries.length = 0; sequence = 0; }
