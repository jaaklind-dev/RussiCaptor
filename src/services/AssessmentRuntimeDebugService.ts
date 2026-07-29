import type { AssessmentSnapshot } from "@/models/ClinicalAssessment";

type Listener = () => void;
let snapshot: AssessmentSnapshot | undefined;
let version = 0;
const listeners = new Set<Listener>();

export function publishAssessmentDebugSnapshot(next: AssessmentSnapshot): void {
  snapshot = structuredClone(next);
  version += 1;
  listeners.forEach(listener => listener());
}

export function getAssessmentDebugSnapshot(): AssessmentSnapshot | undefined {
  return snapshot ? structuredClone(snapshot) : undefined;
}

export function getAssessmentDebugVersion(): number { return version; }

export function subscribeToAssessmentDebug(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
