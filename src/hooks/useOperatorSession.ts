import { useSyncExternalStore } from "react";
import { getOperatorSession, subscribeOperatorSession } from "@/services/authorization/OperatorSessionService";

export function useOperatorSession() {
  return useSyncExternalStore(subscribeOperatorSession, getOperatorSession, getOperatorSession);
}
