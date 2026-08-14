export type RuntimeWriterAuthorityState = "UNRESOLVED" | "WRITER" | "READER" | "CONFLICT" | "OFFLINE";
let state: RuntimeWriterAuthorityState = "UNRESOLVED";

export function setRuntimeWriterAuthorityState(value: RuntimeWriterAuthorityState): void { state = value; }
export function getRuntimeWriterAuthorityState(): RuntimeWriterAuthorityState { return state; }
export function runtimeWritesAllowed(): boolean { return state === "UNRESOLVED" || state === "WRITER" || state === "OFFLINE"; }
