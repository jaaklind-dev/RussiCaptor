import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { canOperatorPublishCloudProjection } from "@/services/CloudSyncService";

function operator(role: "CM" | "EXCON", scopeId = "EX-A"): OperatorSessionState {
  return {
    state: "AUTHENTICATED",
    profile: { userId: "operator-1", displayName: "Test Operator" },
    principal: {
      userId: "operator-1",
      authenticationState: "AUTHENTICATED",
      roleAssignments: [{
        assignmentId: "assignment-1",
        userId: "operator-1",
        role,
        status: "ACTIVE",
        scope: { scopeType: "EXERCISE", scopeId },
        issuedAt: "2026-08-29T00:00:00.000Z",
        issuedBy: "trusted-admin",
      }],
      permissions: [],
      authorizationFreshness: "VERIFIED_ONLINE",
      authorizationProvenance: {
        authority: "SUPABASE_ROLE_ASSIGNMENTS",
        verifiedAt: "2026-08-29T00:00:00.000Z",
        expiresAt: "2026-08-29T01:00:00.000Z",
      },
    },
  };
}

describe("CM shared-workflow projection ownership", () => {
  test("scoped CM never publishes the EXCON-owned whole exercise projection", () => {
    expect(canOperatorPublishCloudProjection(operator("CM"), "EX-A")).toBe(false);
  });

  test("scoped EXCON may publish only its assigned exercise projection", () => {
    expect(canOperatorPublishCloudProjection(operator("EXCON"), "EX-A")).toBe(true);
    expect(canOperatorPublishCloudProjection(operator("EXCON"), "EX-B")).toBe(false);
  });
});
