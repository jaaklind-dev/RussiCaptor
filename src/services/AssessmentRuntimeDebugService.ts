import type { AssessmentSnapshot } from "@/models/ClinicalAssessment";
import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import { publishDerivedSnapshotNotification } from "@/services/runtime/RuntimeDerivedSnapshotTransaction";

type Listener = () => void;
let snapshot: AssessmentSnapshot | undefined;
let version = 0;
const listeners = new Set<Listener>();

export function publishAssessmentDebugSnapshot(next: AssessmentSnapshot): void {
  const endClone = startRuntimeWorkTrace("ENGINE_ASSESSMENT_DEBUG_CLONE");
  snapshot = structuredClone(next);
  endClone();
  version += 1;
  publishDerivedSnapshotNotification("assessment", () => listeners.forEach(listener => listener()));
}

export function getAssessmentDebugSnapshot(): AssessmentSnapshot | undefined {
  return snapshot ? structuredClone(snapshot) : undefined;
}

export function getAssessmentDebugVersion(): number { return version; }

export function subscribeToAssessmentDebug(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
