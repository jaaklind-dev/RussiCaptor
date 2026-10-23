import * as Crypto from "expo-crypto";
import { supabase } from "@/services/SupabaseService";
import { sha256Text } from "@/utils/sha256";
import { assertExerciseNotHistoricallyQuarantined } from "./HistoricalExerciseQuarantine";

export type ExerciseIdentityPurpose = "CREATE" | "ADMIN" | "BUILDER" | "PACKAGE" | "CLONE" | "RESTORE_AS_NEW";
export type ExerciseIdentityRequest = Readonly<{ requestId: string; bootstrapId: string; purpose: ExerciseIdentityPurpose }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const newExerciseAllocationRequestId = (): string => Crypto.randomUUID();
/** Stable across lost ACKs and process-local attempt-cache loss. Reusing an
 * operation with another bootstrap fails at the server instead of duplicating it. */
export function exerciseAllocationRequestId(userId: string, operationId: string): string {
  const hex = sha256Text(JSON.stringify(["exercise-allocation-v1", userId, operationId]));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** One committed server reservation. No client-generated exercise ID or fallback. */
export async function allocateServerExerciseIdentity(input: ExerciseIdentityRequest): Promise<string> {
  if (!uuid.test(input.requestId) || !uuid.test(input.bootstrapId)
    || !["CREATE", "ADMIN", "BUILDER", "PACKAGE", "CLONE", "RESTORE_AS_NEW"].includes(input.purpose)) {
    throw new Error("EXERCISE_ALLOCATION_INVALID_REQUEST");
  }
  if (!supabase) throw new Error("EXERCISE_ALLOCATION_UNAVAILABLE");
  const { data, error } = await supabase.rpc("allocate_exercise_identity", {
    p_request_id: input.requestId, p_bootstrap_id: input.bootstrapId, p_purpose: input.purpose,
  });
  // Never reflect backend error text, credentials or request payloads into UI/logs.
  if (error) throw new Error("EXERCISE_ALLOCATION_REJECTED");
  if (typeof data !== "string" || !data.startsWith("EX-") || !uuid.test(data.slice(3))) {
    throw new Error("EXERCISE_ALLOCATION_INVALID_RESPONSE");
  }
  assertExerciseNotHistoricallyQuarantined(data);
  return data;
}
