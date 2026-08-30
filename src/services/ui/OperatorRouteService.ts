import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { hasActiveRole } from "@/services/authorization/OperatorSessionService";

export type OperatorLandingRoute = "/dashboard" | "/excon" | "/";

export function resolveOperatorLandingRoute(
  operator: OperatorSessionState,
  exerciseId?: string,
): OperatorLandingRoute {
  if (hasActiveRole(operator, "CM", exerciseId)) return "/dashboard";
  if (hasActiveRole(operator, "EXCON", exerciseId)) return "/excon";
  return "/";
}
