import { supabase } from "@/services/SupabaseService";

export const sharedWorkflowMutationKinds = ["CLAIM", "TRANSFER_REQUEST", "TRANSFER", "RELEASE", "REACQUIRE", "APPEND", "MUTABLE"] as const;
export type SharedWorkflowMutationKind = typeof sharedWorkflowMutationKinds[number];

export type SharedWorkflowMutationRequest = Readonly<{
  exerciseId: string;
  patientId: string;
  commandId: string;
  kind: SharedWorkflowMutationKind;
  expectedRevision: number;
  expectedOwnerUserId?: string;
  nextOwnerUserId?: string;
  state: Readonly<Record<string, unknown>>;
}>;

export type SharedWorkflowMutationStatus =
  | "APPLIED" | "IDEMPOTENT" | "STALE_VERSION" | "OWNERSHIP_CHANGED"
  | "NOT_OWNER" | "ALREADY_OWNED" | "COMPLETION_FENCED" | "EXERCISE_COMPLETED"
  | "AUTHORIZATION_DENIED" | "RECONNECT_REQUIRED" | "UNAVAILABLE";

export type SharedWorkflowMutationResult = Readonly<{
  status: SharedWorkflowMutationStatus;
  revision: number;
  ownerUserId?: string;
  state?: Readonly<Record<string, unknown>>;
}>;

export type SharedWorkflowConflictMetrics = Readonly<{
  ownershipConflicts: number;
  staleWriteRejections: number;
  idempotentDuplicates: number;
  concurrentMutations: number;
  successfulRetries: number;
  reconnectConflictResolutions: number;
}>;

export interface SharedWorkflowGateway {
  submit(request: SharedWorkflowMutationRequest, observer?: SharedWorkflowRpcObserver, guard?: SharedWorkflowSubmissionGuard): Promise<SharedWorkflowMutationResult>;
}
export type SharedWorkflowSubmissionGuard = Readonly<{ operatorId: string; valid(): boolean; negativeTest?: true }>;

/** Optional acceptance-only projection; never includes RPC parameters or raw errors. */
export type SharedWorkflowRpcObserver = (event: Readonly<{
  phase: "LOCAL" | "SUBMITTED" | "RESPONSE" | "TRANSPORT_UNKNOWN"; attempt: number;
  httpStatus: number | null; serverErrorCode: string | null;
  status: SharedWorkflowMutationStatus | null; revision: number | null; ownerUserId?: string;
}>) => void;
function observeRpc(observer: SharedWorkflowRpcObserver | undefined, event: Parameters<SharedWorkflowRpcObserver>[0]): void {
  try { observer?.(event); } catch { /* Diagnostics cannot affect normal command semantics. */ }
}

const emptyMetrics = (): SharedWorkflowConflictMetrics => ({ ownershipConflicts: 0, staleWriteRejections: 0,
  idempotentDuplicates: 0, concurrentMutations: 0, successfulRetries: 0, reconnectConflictResolutions: 0 });
let metrics = emptyMetrics();
let gateway: SharedWorkflowGateway | undefined;
let online = false;
const patientHeads = new Map<string, Readonly<{ revision: number; ownerUserId?: string }>>();
const unresolvedConflicts = new Set<string>();
let reconnectPending = false;
let realtimeLifecycle = "IDLE";
const listeners = new Set<() => void>();

function key(exerciseId: string, patientId: string): string { return `${exerciseId}\u0000${patientId}`; }
function updateMetrics(change: Partial<Record<keyof SharedWorkflowConflictMetrics, number>>): void {
  metrics = Object.freeze(Object.fromEntries(Object.entries(metrics).map(([metric, value]) =>
    [metric, value + (change[metric as keyof SharedWorkflowConflictMetrics] ?? 0)])) as unknown as SharedWorkflowConflictMetrics);
}
function publish(): void { listeners.forEach(listener => listener()); }

export function getSharedWorkflowConflictMetrics(): SharedWorkflowConflictMetrics { return Object.freeze({ ...metrics }); }
export function getSharedWorkflowOperationalState() {
  let authoritativeRevision = 0;
  patientHeads.forEach(head => { authoritativeRevision = Math.max(authoritativeRevision, head.revision); });
  return Object.freeze({ online, reconnectPending, unresolvedConflictCount: unresolvedConflicts.size,
    authoritativeRevision, pendingMutationCount: reconnectPending ? 1 : 0, realtimeLifecycle });
}
export function resetSharedWorkflowConflictMetrics(): void { metrics = emptyMetrics(); patientHeads.clear(); unresolvedConflicts.clear(); reconnectPending=false; realtimeLifecycle="IDLE"; publish(); }
export function subscribeToSharedWorkflowConflicts(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function setSharedWorkflowConnectivity(value: boolean): void {
  if(!value&&online)reconnectPending=true;
  if(value&&reconnectPending){updateMetrics({reconnectConflictResolutions:unresolvedConflicts.size});reconnectPending=false;}
  online = value; publish();
}
export function setSharedWorkflowRealtimeLifecycle(value: string): void { realtimeLifecycle = value; publish(); }
export function setSharedWorkflowGateway(value: SharedWorkflowGateway | undefined): void { gateway = value; }
export function getSharedWorkflowHead(exerciseId: string, patientId: string): Readonly<{ revision: number; ownerUserId?: string }> {
  return patientHeads.get(key(exerciseId,patientId)) ?? Object.freeze({ revision: 0 });
}
export function observeSharedWorkflowHead(exerciseId: string,patientId: string,revision: number,ownerUserId?: string): void {
  const current = getSharedWorkflowHead(exerciseId,patientId);
  if (revision < current.revision) return;
  patientHeads.set(key(exerciseId,patientId),Object.freeze({revision,ownerUserId})); publish();
}

export async function submitSharedWorkflowMutation(request: SharedWorkflowMutationRequest, observer?: SharedWorkflowRpcObserver, guard?: SharedWorkflowSubmissionGuard): Promise<SharedWorkflowMutationResult> {
  if (!online) return Object.freeze({ status: "RECONNECT_REQUIRED", revision: request.expectedRevision,
    ownerUserId: request.expectedOwnerUserId });
  const activeGateway = gateway ?? supabaseSharedWorkflowGateway;
  const result = await activeGateway.submit(request, observer, guard);
  if (guard && (guard.negativeTest || !guard.valid())) return result;
  const patientKey=key(request.exerciseId,request.patientId);
  if (result.status === "APPLIED" || result.status === "IDEMPOTENT") {
    const previous = getSharedWorkflowHead(request.exerciseId,request.patientId);
    observeSharedWorkflowHead(request.exerciseId,request.patientId,result.revision,result.ownerUserId);
    updateMetrics({ idempotentDuplicates: result.status === "IDEMPOTENT" ? 1 : 0,
      successfulRetries: unresolvedConflicts.delete(patientKey) ? 1 : result.status === "IDEMPOTENT" && previous.revision === result.revision ? 1 : 0 });
  } else if (result.status === "STALE_VERSION") {unresolvedConflicts.add(patientKey);updateMetrics({ staleWriteRejections: 1, concurrentMutations: 1 });}
  else if (["OWNERSHIP_CHANGED","NOT_OWNER","ALREADY_OWNED"].includes(result.status)) {unresolvedConflicts.add(patientKey);updateMetrics({ ownershipConflicts: 1, concurrentMutations: 1 });}
  publish(); return result;
}

export function sharedWorkflowStatusMessage(status: SharedWorkflowMutationStatus): string {
  switch(status) {
    case "APPLIED": return "Muudatus salvestati.";
    case "IDEMPOTENT": return "Tegevus oli juba salvestatud.";
    case "STALE_VERSION": return "Patsiendi andmed on muutunud. Värskenda vaade ja proovi uuesti.";
    case "OWNERSHIP_CHANGED": case "NOT_OWNER": return "Patsiendi vastutav CM on muutunud.";
    case "ALREADY_OWNED": return "Patsient on juba teise CM-i vastutusel.";
    case "COMPLETION_FENCED": return "Õppuse lõpetamine on pooleli. Uusi muudatusi ei saa enam teha.";
    case "EXERCISE_COMPLETED": return "Õppus on lõpetatud. Muudatusi ei saa enam teha.";
    case "AUTHORIZATION_DENIED": return "Sul puudub selle õppuse muutmise õigus.";
    case "RECONNECT_REQUIRED": return "Toimingu kinnitamiseks taasta võrguühendus.";
    default: return "Jagatud töövoo salvestamine pole praegu saadaval.";
  }
}

export function classifySharedWorkflowError(message: string): SharedWorkflowMutationStatus {
  if (message.includes("COMPLETION_FENCED")) return "COMPLETION_FENCED";
  if (message.includes("EXERCISE_COMPLETED")) return "EXERCISE_COMPLETED";
  if (/AUTHORIZATION_DENIED|AUTHENTICATION_REQUIRED|42501/.test(message)) return "AUTHORIZATION_DENIED";
  return "UNAVAILABLE";
}

export const supabaseSharedWorkflowGateway: SharedWorkflowGateway = {
  async submit(request, observer, guard) {
    if (!supabase) return Object.freeze({ status: "UNAVAILABLE", revision: request.expectedRevision });
    const { data: session } = await supabase.auth.getSession();
    if (!session.session || session.session.user.is_anonymous) return Object.freeze({ status: "UNAVAILABLE", revision: request.expectedRevision });
    if (guard && (!guard.valid() || session.session.user.id !== guard.operatorId)) {
      observeRpc(observer, { phase: "LOCAL", attempt: 0, httpStatus: null, serverErrorCode: null, status: "AUTHORIZATION_DENIED", revision: null });
      return Object.freeze({ status: "AUTHORIZATION_DENIED", revision: request.expectedRevision });
    }
    const parameters = {
      p_exercise_id: request.exerciseId, p_patient_id: request.patientId, p_command_id: request.commandId,
      p_mutation_kind: request.kind, p_expected_revision: request.expectedRevision,
      p_expected_owner_user_id: request.expectedOwnerUserId ?? null,
      p_next_owner_user_id: request.nextOwnerUserId ?? null, p_state: request.state,
    };
    const send = async (attempt: number) => {
      if (guard && !guard.valid()) {
        observeRpc(observer, { phase: "LOCAL", attempt, httpStatus: null, serverErrorCode: null, status: "AUTHORIZATION_DENIED", revision: null });
        throw new Error("VALIDATION_BINDING_CHANGED");
      }
      observeRpc(observer, { phase: "SUBMITTED", attempt, httpStatus: null, serverErrorCode: null, status: null, revision: null });
      try {
        const call = supabase!.rpc("apply_shared_workflow_patient_mutation", parameters);
        const response = await (guard?.negativeTest ? call.retry(false) : call);
        const row = (Array.isArray(response.data) ? response.data[0] : response.data) as { status?: string; revision?: number; owner_user_id?: string } | null;
        const known = ["APPLIED", "IDEMPOTENT", "STALE_VERSION", "OWNERSHIP_CHANGED", "NOT_OWNER", "ALREADY_OWNED", "COMPLETION_FENCED", "EXERCISE_COMPLETED", "AUTHORIZATION_DENIED", "RECONNECT_REQUIRED", "UNAVAILABLE"];
        const hasHttpResponse = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599;
        observeRpc(observer, { phase: hasHttpResponse ? "RESPONSE" : "TRANSPORT_UNKNOWN", attempt,
          httpStatus: hasHttpResponse ? response.status : null,
          serverErrorCode: response.error?.code && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(response.error.code) ? response.error.code : null,
          status: response.error ? classifySharedWorkflowError(`${response.error.message} ${response.error.code}`)
            : known.includes(row?.status ?? "") ? row!.status as SharedWorkflowMutationStatus : "UNAVAILABLE",
          revision: Number.isSafeInteger(Number(row?.revision)) && row?.revision != null ? Number(row.revision) : null,
          ownerUserId: typeof row?.owner_user_id === "string" && /^[a-f0-9-]{36}$/i.test(row.owner_user_id) ? row.owner_user_id : undefined });
        return response;
      } catch (error) {
        observeRpc(observer, { phase: "TRANSPORT_UNKNOWN", attempt, httpStatus: null, serverErrorCode: null, status: "UNAVAILABLE", revision: null });
        throw error;
      }
    };
    let response = await send(1);
    const firstErrorStatus = response.error
      ? classifySharedWorkflowError(`${response.error.message} ${response.error.code}`)
      : undefined;
    if (response.error && firstErrorStatus === "UNAVAILABLE" && !guard?.negativeTest) {
      // An ambiguous transport failure may have occurred after commit. Retry
      // the exact command ID once; the server ledger makes this deterministic.
      response = await send(2);
    }
    const {data,error}=response;
    if (error) return Object.freeze({ status: classifySharedWorkflowError(`${error.message} ${error.code}`),
      revision: request.expectedRevision });
    const row = (Array.isArray(data) ? data[0] : data) as { status?: string; revision?: number; owner_user_id?: string; state?: Record<string,unknown> } | null;
    const status = row?.status as SharedWorkflowMutationStatus | undefined;
    if (!status) return Object.freeze({ status: "UNAVAILABLE", revision: request.expectedRevision });
    return Object.freeze({ status, revision: Number(row?.revision ?? request.expectedRevision),
      ownerUserId: row?.owner_user_id ?? undefined, state: row?.state ? Object.freeze(row.state) : undefined });
  },
};
