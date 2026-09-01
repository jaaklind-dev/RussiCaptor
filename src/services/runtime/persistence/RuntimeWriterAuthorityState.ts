/** `ACQUIRING` deliberately has no write permission: an RPC response alone is
 * not stable authority until the renewal lifecycle has been armed and its
 * confirmation succeeds. */
export type RuntimeWriterAuthorityState = "UNRESOLVED" | "ACQUIRING" | "WRITER" | "READER" | "CONFLICT" | "OFFLINE";
let state: RuntimeWriterAuthorityState = "UNRESOLVED";

export function setRuntimeWriterAuthorityState(value: RuntimeWriterAuthorityState): void { state = value; }
export function getRuntimeWriterAuthorityState(): RuntimeWriterAuthorityState { return state; }
export function runtimeWritesAllowed(): boolean { return state === "UNRESOLVED" || state === "WRITER" || state === "OFFLINE"; }
