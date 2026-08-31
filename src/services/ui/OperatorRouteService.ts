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

export function resolveOperatorLandingNavigationTarget(
  operator: OperatorSessionState,
  exerciseId: string,
  currentRoute = "/",
): "/dashboard" | "/excon" | "/" | undefined {
  const target = resolveOperatorLandingRoute(operator, exerciseId);
  return target === currentRoute ? undefined : target;
}
