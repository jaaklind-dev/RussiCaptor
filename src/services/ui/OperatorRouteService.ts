import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { hasActiveRole, hasPlatformAdminAuthority } from "@/services/authorization/OperatorSessionService";
import type { OperatorMode } from "./OperatorModeService";
import type { ExconRouteReadiness } from "./ExconRouteReadinessService";

export type OperatorLandingRoute = "/dashboard" | "/excon" | "/admin" | "/mode" | "/";

export function resolveSelectedModeRoute(
  operator: OperatorSessionState,
  selectedMode: OperatorMode | undefined,
  exerciseId?: string,
  exconReadiness?: ExconRouteReadiness,
): OperatorLandingRoute {
  if (selectedMode === "ADMIN") return hasPlatformAdminAuthority(operator) ? "/admin" : "/mode";
  if (selectedMode === "CM") return hasActiveRole(operator, "CM", exerciseId) ? "/dashboard" : "/mode";
  if (selectedMode === "EXCON") {
    // Use the same readiness decision as the protected EXCON route. A scoped
    // role alone must not bounce mode selection back into a denied route.
    return exconReadiness?.state === "AUTHORIZED" && exconReadiness.exerciseId === exerciseId &&
      (hasActiveRole(operator, "EXCON", exerciseId) || hasActiveRole(operator, "EXERCISE_BOOTSTRAP"))
      ? "/excon" : "/mode";
  }
  return operator.state === "AUTHENTICATED" ? "/mode" : "/";
}

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
): OperatorLandingRoute | undefined {
  const target = resolveOperatorLandingRoute(operator, exerciseId);
  return target === currentRoute ? undefined : target;
}


export function resolveSelectedModeNavigationTarget(
  operator: OperatorSessionState,
  selectedMode: OperatorMode | undefined,
  exerciseId: string,
  currentRoute = "/",
  exconReadiness?: ExconRouteReadiness,
): OperatorLandingRoute | undefined {
  const target = resolveSelectedModeRoute(operator, selectedMode, exerciseId, exconReadiness);
  return target === currentRoute ? undefined : target;
}
