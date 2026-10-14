import { getBuildProvenance } from "@/config/ReleaseConfig";
import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { supabase } from "@/services/SupabaseService";
import { getOperatorSession, getOperatorAuthSessionGeneration, activeScopedExerciseIds } from "@/services/authorization/OperatorSessionService";
import { exerciseLifecycle } from "@/services/exercise/CurrentExerciseSelectionService";
import { getSelectedOperatorMode } from "@/services/ui/OperatorModeService";
import { getRuntimeWriterAuthorityState, getRuntimeWriterPublicationLeaseId } from "./RuntimeWriterAuthorityState";
import { getRuntimeWriterInstanceId } from "./RuntimeWriterIdentityService";

/** This explicit build flag is never set by a canonical/distributable build. */
export function isC11StaleWriterProbeEnabled(): boolean {
  return isSharedWorkflowValidationHarnessEnabled() &&
    process.env.EXPO_PUBLIC_C11_STALE_WRITER_PROBE === "1" &&
    getBuildProvenance().supabaseProjectRef === "fimcsrivizpliiuoqopv";
}

type CapturedWriter = Readonly<{
  exerciseId: string;
  leaseId: string;
  writerInstanceId: string;
  writerGeneration: number;
  userId: string;
  authSessionGeneration: number;
  operationId: string;
  capturedAt: string;
}>;

export type C11ProbeResult = Readonly<{
  ok: boolean;
  code: string;
  exerciseId?: string;
  operationId?: string;
  writerGeneration?: number;
  expectedRevision?: number;
  httpStatus?: number;
}>;

let captured: CapturedWriter | undefined;
let sent = false;

function reject(code: string): C11ProbeResult { return Object.freeze({ ok: false, code }); }

function scopedActor(exerciseId: string, userId?: string): boolean {
  const operator = getOperatorSession();
  return operator.state === "AUTHENTICATED" && (!userId || operator.profile.userId === userId) &&
    getSelectedOperatorMode() === "EXCON" && activeScopedExerciseIds(operator, "EXCON").includes(exerciseId);
}

function diagnostic(event: "CAPTURED" | "SENT" | "REJECTED" | "ACK", detail: Record<string, string | number | undefined>): void {
  // Never log the projection, access token, session, email, or patient data.
  console.info("C11_STALE_WRITER_PROBE", JSON.stringify({ event, at: new Date().toISOString(), rpc: "publish_exercise_state_current_writer", ...detail }));
}

export function getC11StaleWriterProbeCapture(): Readonly<{
  exerciseId: string; writerGeneration: number; operationId: string; sent: boolean;
}> | undefined {
  if (!isC11StaleWriterProbeEnabled() || !captured) return undefined;
  return Object.freeze({ exerciseId: captured.exerciseId, writerGeneration: captured.writerGeneration,
    operationId: captured.operationId, sent });
}

/** Capture only the genuine current writer on this physical installation. */
export async function captureC11StaleWriterProbe(): Promise<C11ProbeResult> {
  if (!isC11StaleWriterProbeEnabled() || !supabase) return reject("PROBE_DISABLED");
  if (captured) return reject("PROBE_ALREADY_CAPTURED");
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const leaseId = getRuntimeWriterPublicationLeaseId();
  if (!exerciseId || !leaseId || getRuntimeWriterAuthorityState() !== "WRITER" || !scopedActor(exerciseId)) {
    return reject("WRITER_NOT_READY");
  }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user || auth.user.is_anonymous || !scopedActor(exerciseId, auth.user.id)) return reject("UNAUTHORIZED");
  const writerInstanceId = await getRuntimeWriterInstanceId();
  const { data: row, error } = await supabase.from("runtime_writer_leases")
    .select("lease_id,writer_instance_id,writer_user_id,writer_generation,released_at,expires_at")
    .eq("exercise_id", exerciseId).maybeSingle();
  if (error || !row || row.lease_id !== leaseId || row.writer_instance_id !== writerInstanceId ||
    row.writer_user_id !== auth.user.id || row.released_at || Date.parse(row.expires_at) <= Date.now() ||
    !Number.isSafeInteger(Number(row.writer_generation)) || Number(row.writer_generation) < 1 ||
    getRuntimeWriterPublicationLeaseId() !== leaseId || getRuntimeWriterAuthorityState() !== "WRITER") {
    return reject("WRITER_NOT_READY");
  }
  captured = Object.freeze({ exerciseId, leaseId, writerInstanceId,
    writerGeneration: Number(row.writer_generation), userId: auth.user.id,
    authSessionGeneration: getOperatorAuthSessionGeneration(),
    operationId: `C11-PROBE-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    capturedAt: new Date().toISOString() });
  sent = false;
  diagnostic("CAPTURED", { exerciseId, leaseId, writerInstanceId, writerGeneration: captured.writerGeneration,
    operationId: captured.operationId });
  return Object.freeze({ ok: true, code: "CAPTURED", exerciseId, operationId: captured.operationId,
    writerGeneration: captured.writerGeneration });
}

/** Exactly one authenticated old-lease RPC. Only the local suppression is bypassed. */
export async function sendC11StaleWriterProbe(): Promise<C11ProbeResult> {
  if (!isC11StaleWriterProbeEnabled() || !supabase) return reject("PROBE_DISABLED");
  const frozen = captured;
  if (!frozen || sent) return reject("PROBE_NOT_ARMED");
  // Consume before any async work so a second tap cannot create a second RPC.
  sent = true;
  if (getCanonicalExerciseSnapshot().exerciseId !== frozen.exerciseId || !scopedActor(frozen.exerciseId, frozen.userId) ||
    getOperatorAuthSessionGeneration() !== frozen.authSessionGeneration) {
    return reject("EXERCISE_OR_SCOPE_CHANGED");
  }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || auth.user?.id !== frozen.userId || auth.user.is_anonymous) return reject("UNAUTHORIZED");
  const { data: lease, error: leaseError } = await supabase.from("runtime_writer_leases")
    .select("lease_id,writer_instance_id,writer_generation,released_at,expires_at")
    .eq("exercise_id", frozen.exerciseId).maybeSingle();
  if (leaseError || !lease || lease.lease_id === frozen.leaseId || lease.released_at ||
    Date.parse(lease.expires_at) <= Date.now() || Number(lease.writer_generation) <= frozen.writerGeneration) {
    return reject("TAKEOVER_NOT_CONFIRMED");
  }
  const { data: canonical, error: readError } = await supabase.from("exercise_states")
    .select("exercise_id,revision,state").eq("exercise_id", frozen.exerciseId).maybeSingle();
  const state = canonical?.state as SharedExerciseState | undefined;
  if (readError || !canonical || canonical.exercise_id !== frozen.exerciseId ||
    !Number.isSafeInteger(canonical.revision) || canonical.revision < 1 || !state ||
    state.exerciseSession?.exerciseId !== frozen.exerciseId ||
    !["RUNNING", "PAUSED"].includes(exerciseLifecycle(state))) return reject("CANONICAL_STATE_UNAVAILABLE");
  const expectedRevision = canonical.revision;
  diagnostic("SENT", { exerciseId: frozen.exerciseId, leaseId: frozen.leaseId, writerInstanceId: frozen.writerInstanceId,
    writerGeneration: frozen.writerGeneration, operationId: frozen.operationId, expectedRevision });
  const { error, status } = await supabase.rpc("publish_exercise_state_current_writer", {
    p_exercise_id: frozen.exerciseId,
    p_operation_id: frozen.operationId,
    p_lease_id: frozen.leaseId,
    p_writer_instance_id: frozen.writerInstanceId,
    p_expected_revision: expectedRevision,
    // An unchanged current projection is the only allowed payload. If the
    // server fence failed, this would reveal a revision mutation without
    // overwriting B's clinical projection.
    p_state: state,
  });
  const code = error?.message === "WRITER_GENERATION_STALE" ? "WRITER_GENERATION_STALE"
    : error ? "UNEXPECTED_SERVER_REJECTION" : "UNEXPECTED_SERVER_ACCEPTANCE";
  diagnostic(error ? "REJECTED" : "ACK", { exerciseId: frozen.exerciseId, leaseId: frozen.leaseId,
    writerInstanceId: frozen.writerInstanceId, writerGeneration: frozen.writerGeneration,
    operationId: frozen.operationId, expectedRevision, httpStatus: status, code });
  return Object.freeze({ ok: code === "WRITER_GENERATION_STALE", code,
    exerciseId: frozen.exerciseId, operationId: frozen.operationId,
    writerGeneration: frozen.writerGeneration, expectedRevision, httpStatus: status });
}
