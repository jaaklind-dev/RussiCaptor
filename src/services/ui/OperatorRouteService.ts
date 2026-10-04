import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { hasActiveRole, hasPlatformAdminAuthority } from "@/services/authorization/OperatorSessionService";

export type OperatorLandingRoute = "/dashboard" | "/excon" | "/admin" | "/";

export function resolveOperatorLandingRoute(
  operator: OperatorSessionState,
  exerciseId?: string,
): OperatorLandingRoute {
  if (hasPlatformAdminAuthority(operator)) return "/admin";
  if (hasActiveRole(operator, "CM", exerciseId)) return "/dashboard";
  if (hasActiveRole(operator, "EXCON", exerciseId)) return "/excon";
  if (hasActiveRole(operator, "EXERCISE_BOOTSTRAP")) return "/excon";
  return "/";
}

export function resolveOperatorLandingNavigationTarget(
  operator: OperatorSessionState,
  exerciseId: string,
  currentRoute = "/",
): "/dashboard" | "/excon" | "/admin" | "/" | undefined {
  const target = resolveOperatorLandingRoute(operator, exerciseId);
  return target === currentRoute ? undefined : target;
}
