import { supabase } from "@/services/SupabaseService";

export type AdminAssignment = Readonly<{
  id: string; user_id: string; role: "CM" | "EXCON"; scope_id: string;
  status: "ACTIVE" | "REVOKED"; issued_at: string; revoked_at?: string | null;
}>;
export type AdminUser = Readonly<{
  userId: string; email: string; displayName: string; status: string;
  invitedAt?: string | null; lastSignInAt?: string | null;
  assignments: readonly AdminAssignment[];
}>;
export type AdminExercise = Readonly<{
  exerciseId: string; revision: number; packageId?: string | null; packageVersion?: string | null;
  lifecycleState: string; updatedAt: string; participantCount: number; cmCount: number;
  exconCount: number; activeWriterUserId?: string | null; assignments: readonly AdminAssignment[];
}>;
export type AdminExerciseOverview = Readonly<{
  exercises: readonly AdminExercise[]; readyCancellationEnabled: boolean;
}>;
export type ExerciseBootstrapAuthorization = Readonly<{
  id: string; user_id: string; status: "ACTIVE"; consumed_exercise_id: null; expires_at: string;
}>;

async function boundedErrorCode(error: unknown, allowedCodes: readonly string[]): Promise<string | undefined> {
  if (!allowedCodes.length) return undefined;
  const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } })?.context;
  try {
    const payload = await context?.clone?.().json();
    const code = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
    return typeof code === "string" && allowedCodes.includes(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

async function invoke<T>(functionName: string, body: Record<string, unknown>, retryTransientRead = false,
  allowedErrorCodes: readonly string[] = []): Promise<T> {
  if (!supabase) throw new Error("Supabase pole seadistatud.");
  for (let attempt = 0; attempt < (retryTransientRead ? 2 : 1); attempt += 1) {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    if (error) {
      // A transient authority-read outage is retried only for read-only list operations.
      // 401/403 and all mutations remain fail-closed; no response body is logged.
      const status = (error as { context?: { status?: unknown } }).context?.status;
      if (retryTransientRead && attempt === 0 && [429, 502, 503, 504].includes(Number(status))) {
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      throw new Error(await boundedErrorCode(error, allowedErrorCodes)
        || error.message || "Administreerimise päring ebaõnnestus.");
    }
    if (!data?.ok) throw new Error(String(data?.error || "Administreerimise päring ebaõnnestus."));
    return data as T;
  }
  throw new Error("Administreerimise päring ebaõnnestus.");
}

export async function listAdminUsers(): Promise<readonly AdminUser[]> {
  return (await invoke<{ ok: true; users: AdminUser[] }>("platform-admin-users", { operation: "list" }, true)).users;
}
export async function inviteAdminUser(email: string, displayName: string): Promise<void> {
  await invoke("platform-admin-users", { operation: "invite", email, displayName });
}
export async function requestAdminPasswordReset(email: string): Promise<void> {
  await invoke("platform-admin-users", { operation: "resetPassword", email });
}
export async function setAdminUserActive(userId: string, active: boolean): Promise<void> {
  await invoke("platform-admin-users", { operation: active ? "reactivate" : "deactivate", userId });
}
export async function listAdminExercises(): Promise<readonly AdminExercise[]> {
  return (await listAdminExerciseOverview()).exercises;
}
export async function listAdminExerciseOverview(): Promise<AdminExerciseOverview> {
  const result = await invoke<{ ok: true; exercises: AdminExercise[]; readyCancellationEnabled?: unknown }>(
    "platform-admin-exercises", { operation: "list" }, true);
  if (!Array.isArray(result.exercises)) throw new Error("EXERCISE_LIST_FAILED");
  return { exercises: result.exercises, readyCancellationEnabled: result.readyCancellationEnabled === true };
}
export async function grantExerciseBootstrap(userId: string): Promise<ExerciseBootstrapAuthorization> {
  const result = await invoke<{ ok: true; authorization: ExerciseBootstrapAuthorization }>(
    "platform-admin-exercises", { operation: "grantBootstrap", userId });
  const authorization = result.authorization;
  if (!authorization?.id || authorization.user_id !== userId || authorization.status !== "ACTIVE"
    || authorization.consumed_exercise_id !== null || !authorization.expires_at) {
    throw new Error("ADMIN_EXERCISE_BOOTSTRAP_INVALID");
  }
  return authorization;
}
export async function revokeUnusedExerciseBootstrap(bootstrapId: string, userId: string): Promise<void> {
  await invoke("platform-admin-exercises", { operation: "revokeBootstrap", bootstrapId, userId });
}
export async function grantExerciseRole(userId: string, exerciseId: string, role: "CM" | "EXCON"): Promise<void> {
  await invoke("platform-admin-exercises", { operation: "grantRole", userId, exerciseId, role });
}
export async function revokeExerciseRole(assignment: AdminAssignment): Promise<void> {
  await invoke("platform-admin-exercises", {
    operation: "revokeRole", assignmentId: assignment.id, exerciseId: assignment.scope_id,
    userId: assignment.user_id, role: assignment.role,
  });
}

export type ReadyCancellationReason = "UNUSED_READY" | "FAILED_START" | "TEST_CLEANUP";
export type ReadyCancellationResult = Readonly<{
  exerciseId: string; revision: number; lifecycleState: "CANCELLED";
  cancelledAt: string; idempotent: boolean;
}>;
export async function cancelReadyExercise(
  exerciseId: string, expectedRevision: number, operationId: string,
  reason: ReadyCancellationReason = "UNUSED_READY",
): Promise<ReadyCancellationResult> {
  const result = await invoke<{ ok: true; exerciseId: string; revision: number;
    lifecycleState: "CANCELLED"; cancelledAt: string; idempotent: boolean }>(
    "platform-admin-exercises",
    { operation: "cancelReady", exerciseId, expectedRevision, operationId, reason },
    false, ["READY_CANCELLATION_DISABLED"],
  );
  if (result.exerciseId !== exerciseId || result.lifecycleState !== "CANCELLED"
    || !Number.isSafeInteger(result.revision) || result.revision !== expectedRevision + 1
    || typeof result.cancelledAt !== "string") {
    throw new Error("READY_CANCELLATION_READBACK_FAILED");
  }
  return result;
}
