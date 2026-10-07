import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import {
  activeScopedExerciseIds,
  hasActiveRole,
} from "@/services/authorization/OperatorSessionService";
import type { OperatorModeSnapshot } from "./OperatorModeService";

export type CurrentExerciseDiscoveryReadiness =
  | "PENDING"
  | "RESOLVED"
  | "CONFLICT"
  | "UNAVAILABLE";

export type ExconRouteReadiness = Readonly<
  | {
    state: "PENDING";
    reason: "AUTHORITY" | "MODE" | "CURRENT_EXERCISE";
    intendedExerciseId?: string;
  }
  | {
    state: "AUTHORIZED";
    exerciseId: string;
    intendedExerciseId: string;
  }
  | {
    state: "DENIED";
    reason: "NOT_AUTHENTICATED" | "MODE_NOT_SELECTED" | "ROLE_MISSING" |
      "EXERCISE_SELECTION_REQUIRED" | "EXERCISE_UNAVAILABLE";
    intendedExerciseId?: string;
  }
>;

function soleExerciseId(exerciseIds: readonly string[]): string | undefined {
  return exerciseIds.length === 1 ? exerciseIds[0] : undefined;
}

/**
 * Resolves navigation readiness without granting authority optimistically.
 *
 * The operator session is the authority for scoped roles. Current-exercise
 * discovery is a separate asynchronous gate: a temporarily mismatched local
 * exercise is pending until discovery finishes, not proof that access is
 * denied. Workbench content remains hidden until both gates agree.
 */
export function resolveExconRouteReadiness(input: Readonly<{
  operator: OperatorSessionState;
  mode: OperatorModeSnapshot;
  currentExerciseId: string;
  discovery: CurrentExerciseDiscoveryReadiness;
}>): ExconRouteReadiness {
  const { operator, mode, currentExerciseId, discovery } = input;
  if (operator.state === "LOADING") {
    return Object.freeze({ state: "PENDING", reason: "AUTHORITY" });
  }
  if (operator.state !== "AUTHENTICATED") {
    return Object.freeze({ state: "DENIED", reason: "NOT_AUTHENTICATED" });
  }

  if (mode.userId !== operator.profile.userId) {
    return Object.freeze({ state: "PENDING", reason: "MODE" });
  }
  if (mode.selectedMode !== "EXCON") {
    return Object.freeze({ state: "DENIED", reason: "MODE_NOT_SELECTED" });
  }

  // Preserve the existing one-shot preparation authority. It does not grant
  // EXCON actions: the workbench continues to check the concrete EXCON role.
  if (hasActiveRole(operator, "EXERCISE_BOOTSTRAP")) {
    return Object.freeze({
      state: "AUTHORIZED",
      exerciseId: currentExerciseId,
      intendedExerciseId: currentExerciseId,
    });
  }

  const exerciseIds = activeScopedExerciseIds(operator, "EXCON");
  const intendedExerciseId = exerciseIds.includes(currentExerciseId)
    ? currentExerciseId
    : soleExerciseId(exerciseIds);
  if (!exerciseIds.length) {
    return Object.freeze({ state: "DENIED", reason: "ROLE_MISSING" });
  }
  if (exerciseIds.includes(currentExerciseId)) {
    return Object.freeze({
      state: "AUTHORIZED",
      exerciseId: currentExerciseId,
      intendedExerciseId: currentExerciseId,
    });
  }
  if (discovery === "PENDING") {
    return Object.freeze({
      state: "PENDING",
      reason: "CURRENT_EXERCISE",
      ...(intendedExerciseId ? { intendedExerciseId } : {}),
    });
  }
  if (discovery === "CONFLICT") {
    return Object.freeze({
      state: "DENIED",
      reason: "EXERCISE_SELECTION_REQUIRED",
      ...(intendedExerciseId ? { intendedExerciseId } : {}),
    });
  }
  return Object.freeze({
    state: "DENIED",
    reason: "EXERCISE_UNAVAILABLE",
    ...(intendedExerciseId ? { intendedExerciseId } : {}),
  });
}

export function exconRouteRedirect(
  readiness: ExconRouteReadiness,
): "/" | "/mode" | undefined {
  if (readiness.state !== "DENIED") return undefined;
  return readiness.reason === "NOT_AUTHENTICATED" ? "/" : "/mode";
}
