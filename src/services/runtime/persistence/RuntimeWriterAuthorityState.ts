/** `ACQUIRING` deliberately has no write permission: an RPC response alone is
 * not stable authority until the renewal lifecycle has been armed and its
 * confirmation succeeds. */
export type RuntimeWriterAuthorityState = "UNRESOLVED" | "ACQUIRING" | "WRITER" | "READER" | "CONFLICT" | "OFFLINE";
let state: RuntimeWriterAuthorityState = "UNRESOLVED";
let leaseId: string | undefined;
let generation = 0;
let runtimeGeneration = 0;

/** A new lease fences publications queued by the previous writer, even if both report WRITER. */
export function setRuntimeWriterAuthorityState(value: RuntimeWriterAuthorityState, currentLeaseId?: string): void {
  const nextLeaseId = value === "WRITER" ? currentLeaseId : undefined;
  if (state !== value || leaseId !== nextLeaseId) generation += 1;
  state = value;
  leaseId = nextLeaseId;
}
export function getRuntimeWriterAuthorityState(): RuntimeWriterAuthorityState { return state; }
export function getRuntimeWriterPublicationGeneration(): number { return generation; }
export function getRuntimeWriterPublicationLeaseId(): string | undefined { return leaseId; }
export function setRuntimePublicationGeneration(value: number): void { runtimeGeneration = value; }
export function getRuntimePublicationGeneration(): number { return runtimeGeneration; }
export function runtimeWritesAllowed(): boolean { return state === "UNRESOLVED" || state === "WRITER" || state === "OFFLINE"; }
