import { useSyncExternalStore } from "react";
import { getOperatorModeSnapshot, subscribeOperatorMode } from "@/services/ui/OperatorModeService";

export function useOperatorMode() {
  return useSyncExternalStore(subscribeOperatorMode, getOperatorModeSnapshot, getOperatorModeSnapshot);
}
