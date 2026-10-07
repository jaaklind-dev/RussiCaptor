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
export type ExerciseBootstrapAuthorization = Readonly<{
  id: string; user_id: string; status: "ACTIVE"; consumed_exercise_id: null; expires_at: string;
}>;

async function invoke<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase pole seadistatud.");
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message || "Administreerimise päring ebaõnnestus.");
  if (!data?.ok) throw new Error(String(data?.error || "Administreerimise päring ebaõnnestus."));
  return data as T;
}

export async function listAdminUsers(): Promise<readonly AdminUser[]> {
  return (await invoke<{ ok: true; users: AdminUser[] }>("platform-admin-users", { operation: "list" })).users;
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
  return (await invoke<{ ok: true; exercises: AdminExercise[] }>("platform-admin-exercises", { operation: "list" })).exercises;
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
