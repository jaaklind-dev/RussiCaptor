export type InitialWriterStartPhase =
  | "WRITER_READY"
  | "RUNNING_PUBLISH_PENDING"
  | "RUNNING_PUBLISH_DURABLE"
  | "WORKFLOW_HEAD_BOOTSTRAP"
  | "RUNTIME_READY";

export type InitialWriterStartResult =
  | Readonly<{ ok: true; phase: "RUNTIME_READY"; revision: number }>
  | Readonly<{ ok: false; phase: InitialWriterStartPhase; code: string }>;

export type InitialWriterStartPort = Readonly<{
  currentWriter: () => Promise<boolean>;
  publishAndConfirmRunning: () => Promise<Readonly<{ ok: true; revision: number }> | Readonly<{ ok: false; code: string }>>;
  initializeWorkflowHeads: () => Promise<boolean>;
  establishRuntimeOwner: () => boolean;
}>;

/** The patient-head RPC requires durable RUNNING, not a local START intent or a lease alone. */
export async function runInitialWriterStartOrder(port: InitialWriterStartPort): Promise<InitialWriterStartResult> {
  let current = false;
  try { current = await port.currentWriter(); } catch { /* Fail closed on lease-read failure. */ }
  if (!current) return { ok: false, phase: "WRITER_READY", code: "WRITER_AUTHORITY_UNAVAILABLE" };
  let published: Awaited<ReturnType<InitialWriterStartPort["publishAndConfirmRunning"]>>;
  try { published = await port.publishAndConfirmRunning(); }
  catch { return { ok: false, phase: "RUNNING_PUBLISH_PENDING", code: "EXERCISE_STATE_WRITE_FAILED" }; }
  if (!published.ok) return { ok: false, phase: "RUNNING_PUBLISH_PENDING", code: published.code };
  try { current = await port.currentWriter(); } catch { current = false; }
  if (!current) return { ok: false, phase: "RUNNING_PUBLISH_DURABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" };
  let headsReady = false;
  try { headsReady = await port.initializeWorkflowHeads(); } catch { /* Keep command ownership withheld. */ }
  if (!headsReady) {
    return { ok: false, phase: "WORKFLOW_HEAD_BOOTSTRAP", code: "WORKFLOW_HEAD_INITIALIZATION_FAILED" };
  }
  try { current = await port.currentWriter(); } catch { current = false; }
  let ownerReady = false;
  if (current) {
    try { ownerReady = port.establishRuntimeOwner(); } catch { /* Never advertise readiness after registration failure. */ }
  }
  if (!current || !ownerReady) {
    return { ok: false, phase: "WORKFLOW_HEAD_BOOTSTRAP", code: "RUNTIME_OWNER_NOT_READY" };
  }
  return { ok: true, phase: "RUNTIME_READY", revision: published.revision };
}
