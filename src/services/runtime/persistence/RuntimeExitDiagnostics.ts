export type RuntimeExitStage = "PUBLICATION" | "DRAIN_IDENTITY" | "PUBLICATION_LEASE_CHECK"
  | "PUBLICATION_DRAIN" | "CANONICAL_LEASE_CHECK" | "LEASE_RELEASE" | "RELEASE_CONFIRMATION";

const knownReasons = new Set([
  "WRITER_SIGNOUT_LEASE_REPLACED_DURING_DRAIN", "WRITER_SIGNOUT_PUBLICATION_UNSETTLED",
  "WRITER_SIGNOUT_CANONICAL_AUTHORITY_CHANGED", "WRITER_SIGNOUT_CANONICAL_AUTHORITY_UNAVAILABLE",
  "WRITER_SIGNOUT_RELEASE_UNCONFIRMED", "AUTHORITY_UNAVAILABLE", "STALE_WRITER",
  "CHECKPOINT_REVISION_CONFLICT", "CHECKPOINT_PUBLICATION_UNCERTAIN",
  "CHECKPOINT_RECONCILIATION_TIMEOUT", "GENERATION_STOPPED",
]);
export type RuntimeExitDiagnostic = Readonly<{
  atMs: number;
  stage: RuntimeExitStage;
  reason: string;
  errorKind: "ERROR" | "TYPE_ERROR" | "NON_ERROR";
}>;
const failures: RuntimeExitDiagnostic[] = [];

/** Operational, bounded in-memory evidence only. Never retain arbitrary messages,
 * stacks, causes, identifiers, tokens, or payloads. Not a validation/test switch. */
export function recordRuntimeExitFailure(stage: RuntimeExitStage, error: unknown): void {
  failures.push(Object.freeze({
    atMs: Date.now(), stage,
    reason: error instanceof Error && knownReasons.has(error.message) ? error.message : "UNCLASSIFIED_ERROR",
    errorKind: error instanceof TypeError ? "TYPE_ERROR" : error instanceof Error ? "ERROR" : "NON_ERROR",
  }));
  if (failures.length > 8) failures.splice(0, failures.length - 8);
}

export function getRuntimeExitDiagnostics(): readonly RuntimeExitDiagnostic[] {
  return Object.freeze([...failures]);
}
