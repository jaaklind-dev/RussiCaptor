export type RuntimeCommandReadinessDiagnostic = Readonly<{
  readerPhase: "UNTRACKED" | "SYNCHRONIZING" | "READY" | "WRITER";
  exerciseIdentityMatch: boolean;
  revisionConvergence: "UNKNOWN" | "PENDING" | "CONVERGED" | "WRITER";
  simulationClockMatch: boolean;
  failureCategory: "READER_NOT_TRACKED" | "EXERCISE_BINDING_MISMATCH" | "CHECKPOINT_PENDING" |
    "AUTHORITY_UNAVAILABLE" | "CLOCK_MISMATCH";
  gatewaySubmitCalled: false;
}>;

const records: RuntimeCommandReadinessDiagnostic[] = [];
const limit = 16;

/** Fixed primitives only: no IDs, payloads, times, exceptions or session contents. */
export function recordRuntimeCommandReadinessDiagnostic(input: RuntimeCommandReadinessDiagnostic): void {
  const record: RuntimeCommandReadinessDiagnostic = Object.freeze({
    readerPhase: ["UNTRACKED", "SYNCHRONIZING", "READY", "WRITER"].includes(input.readerPhase)
      ? input.readerPhase : "UNTRACKED",
    exerciseIdentityMatch: input.exerciseIdentityMatch === true,
    revisionConvergence: ["UNKNOWN", "PENDING", "CONVERGED", "WRITER"].includes(input.revisionConvergence)
      ? input.revisionConvergence : "UNKNOWN",
    simulationClockMatch: input.simulationClockMatch === true,
    failureCategory: ["READER_NOT_TRACKED", "EXERCISE_BINDING_MISMATCH", "CHECKPOINT_PENDING",
      "AUTHORITY_UNAVAILABLE", "CLOCK_MISMATCH"].includes(input.failureCategory)
      ? input.failureCategory : "CHECKPOINT_PENDING",
    gatewaySubmitCalled: false,
  });
  // Coalesce repeated taps in one unchanged readiness state; retain a bounded history.
  if (JSON.stringify(records.at(-1)) === JSON.stringify(record)) return;
  records.push(record);
  if (records.length > limit) records.shift();
  try { console.info("RUNTIME_COMMAND_READINESS_REJECTED", record); }
  catch { /* Logging must never change command safety. */ }
}

export function getRuntimeCommandReadinessDiagnostics(): readonly RuntimeCommandReadinessDiagnostic[] {
  return Object.freeze([...records]);
}
