import { useSyncExternalStore } from "react";

import { runtimePatientCommandSubmissionReadiness } from "./RuntimePatientCommandService";
import { getRuntimeReaderConvergenceVersion, subscribeToRuntimeReaderConvergence } from
  "@/services/runtime/persistence/RuntimeReaderConvergenceService";

/** Reactive UI view of the same fail-closed gate used at durable submission time. */
export function useRuntimePatientCommandSubmissionReadiness(exerciseId: string) {
  useSyncExternalStore(subscribeToRuntimeReaderConvergence, getRuntimeReaderConvergenceVersion,
    getRuntimeReaderConvergenceVersion);
  return runtimePatientCommandSubmissionReadiness(exerciseId);
}
