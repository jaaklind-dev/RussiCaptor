import "expo-sqlite/localStorage/install";

import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import {
  activeScopedExerciseIds,
  hasPlatformAdminAuthority,
} from "@/services/authorization/OperatorSessionService";
import {
  completeOperatorRuntimeExitDrain,
  prepareOperatorRuntimeExit,
} from "@/services/authorization/OperatorSignOutLifecycle";

export const operatorModes = ["ADMIN", "CM", "EXCON"] as const;
export type OperatorMode = (typeof operatorModes)[number];
export type AvailableUserMode = Readonly<{
  mode: OperatorMode;
  exerciseIds: readonly string[];
}>;
export type OperatorModeSnapshot = Readonly<{
  userId?: string;
  selectedMode?: OperatorMode;
}>;

const preferencePrefix = "russicaptor.ui.last-selected-mode.";
let snapshot: OperatorModeSnapshot = Object.freeze({});
const listeners = new Set<() => void>();
let transitionInFlight: Promise<OperatorModeSnapshot> | undefined;

function publish(next: OperatorModeSnapshot): OperatorModeSnapshot {
  if (snapshot.userId === next.userId && snapshot.selectedMode === next.selectedMode) return snapshot;
  snapshot = Object.freeze(next);
  listeners.forEach(listener => listener());
  return snapshot;
}

function preferenceKey(userId: string): string { return `${preferencePrefix}${userId}`; }

function readPreference(userId: string): OperatorMode | undefined {
  try {
    const value = globalThis.localStorage?.getItem(preferenceKey(userId));
    return operatorModes.includes(value as OperatorMode) ? value as OperatorMode : undefined;
  } catch { return undefined; }
}

function writePreference(userId: string, mode?: OperatorMode): void {
  try {
    if (mode) globalThis.localStorage?.setItem(preferenceKey(userId), mode);
    else globalThis.localStorage?.removeItem(preferenceKey(userId));
  } catch {
    // A UI preference must never prevent authorization or navigation.
  }
}

export function resolveAvailableUserModes(
  operator: OperatorSessionState,
  now = new Date().toISOString(),
): readonly AvailableUserMode[] {
  if (operator.state !== "AUTHENTICATED") return Object.freeze([]);
  const result: AvailableUserMode[] = [];
  if (hasPlatformAdminAuthority(operator)) result.push(Object.freeze({ mode: "ADMIN", exerciseIds: Object.freeze([]) }));
  const cmExerciseIds = activeScopedExerciseIds(operator, "CM", now);
  if (cmExerciseIds.length) result.push(Object.freeze({ mode: "CM", exerciseIds: cmExerciseIds }));
  const exconExerciseIds = activeScopedExerciseIds(operator, "EXCON", now);
  if (exconExerciseIds.length) result.push(Object.freeze({ mode: "EXCON", exerciseIds: exconExerciseIds }));
  return Object.freeze(result);
}

export function getOperatorModeSnapshot(): OperatorModeSnapshot { return snapshot; }
export function getSelectedOperatorMode(): OperatorMode | undefined { return snapshot.selectedMode; }
export function subscribeOperatorMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reconcileOperatorMode(operator: OperatorSessionState): OperatorModeSnapshot {
  if (operator.state !== "AUTHENTICATED") return publish({});
  const available = resolveAvailableUserModes(operator);
  const allowed = new Set(available.map(item => item.mode));
  const sameUserSelection = snapshot.userId === operator.profile.userId && snapshot.selectedMode;
  if (sameUserSelection && allowed.has(sameUserSelection)) return snapshot;
  const remembered = readPreference(operator.profile.userId);
  if (remembered && allowed.has(remembered)) {
    return publish({ userId: operator.profile.userId, selectedMode: remembered });
  }
  if (remembered) writePreference(operator.profile.userId, undefined);
  if (available.length === 1) {
    writePreference(operator.profile.userId, available[0].mode);
    return publish({ userId: operator.profile.userId, selectedMode: available[0].mode });
  }
  return publish({ userId: operator.profile.userId });
}

export function selectedModeIsAuthorized(operator: OperatorSessionState, mode?: OperatorMode): boolean {
  return Boolean(mode && resolveAvailableUserModes(operator).some(item => item.mode === mode));
}

export function selectOperatorMode(operator: OperatorSessionState, mode: OperatorMode): OperatorModeSnapshot {
  if (operator.state !== "AUTHENTICATED" || !selectedModeIsAuthorized(operator, mode)) {
    throw new Error("MODE_NOT_AUTHORIZED");
  }
  writePreference(operator.profile.userId, mode);
  return publish({ userId: operator.profile.userId, selectedMode: mode });
}

export function switchOperatorMode(operator: OperatorSessionState, mode: OperatorMode): Promise<OperatorModeSnapshot> {
  if (transitionInFlight) return transitionInFlight;
  if (!selectedModeIsAuthorized(operator, mode)) return Promise.reject(new Error("MODE_NOT_AUTHORIZED"));
  if (snapshot.userId === (operator.state === "AUTHENTICATED" ? operator.profile.userId : undefined)
      && snapshot.selectedMode === mode) return Promise.resolve(snapshot);
  const task = (async () => {
    await prepareOperatorRuntimeExit();
    const next = selectOperatorMode(operator, mode);
    completeOperatorRuntimeExitDrain();
    return next;
  })();
  const inFlight = task.finally(() => {
    if (transitionInFlight === inFlight) transitionInFlight = undefined;
  });
  transitionInFlight = inFlight;
  return inFlight;
}

export function resetOperatorModeForTests(): void {
  snapshot = Object.freeze({});
  listeners.clear();
  transitionInFlight = undefined;
}
