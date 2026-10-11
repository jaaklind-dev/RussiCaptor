import fs from "node:fs";
import path from "node:path";

import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { canOperatorPublishCloudProjection } from "@/services/CloudSyncService";

const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");

function operator(role: "CM" | "EXCON" | "EXERCISE_BOOTSTRAP", scopeId = "EX-A"): OperatorSessionState {
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
        scope: role === "EXERCISE_BOOTSTRAP" ? { scopeType: "GLOBAL" } : { scopeType: "EXERCISE", scopeId },
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

  test("bootstrap cannot use the active projection publisher", () => {
    expect(canOperatorPublishCloudProjection(operator("EXERCISE_BOOTSTRAP"), "EX-A")).toBe(false);
    expect(source).toContain('if (lifecycleState === "READY"');
  });

  test("READY and active publications use distinct server contracts", () => {
    expect(source).toContain('client.rpc("create_initial_exercise_state"');
    expect(source).toContain('client.rpc("publish_exercise_state_current_writer"');
  });
});
