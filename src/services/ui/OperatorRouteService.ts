import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { hasActiveRole, hasPlatformAdminAuthority } from "@/services/authorization/OperatorSessionService";
import type { OperatorMode } from "./OperatorModeService";

export type OperatorLandingRoute = "/dashboard" | "/excon" | "/admin" | "/mode" | "/";

export function resolveSelectedModeRoute(
  operator: OperatorSessionState,
  selectedMode: OperatorMode | undefined,
  exerciseId?: string,
): OperatorLandingRoute {
  if (selectedMode === "ADMIN") return hasPlatformAdminAuthority(operator) ? "/admin" : "/mode";
  if (selectedMode === "CM") return hasActiveRole(operator, "CM", exerciseId) ? "/dashboard" : "/mode";
  if (selectedMode === "EXCON") {
    return hasActiveRole(operator, "EXCON", exerciseId) || hasActiveRole(operator, "EXERCISE_BOOTSTRAP")
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
): OperatorLandingRoute | undefined {
  const target = resolveSelectedModeRoute(operator, selectedMode, exerciseId);
  return target === currentRoute ? undefined : target;
}
