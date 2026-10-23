import { sha256Text } from "@/utils/sha256";

/** Denial only. This exact historical set grants no role, writer authority,
 * hash exception, or permission to restore any other identity. Raw IDs and
 * checkpoint payloads remain in the encrypted evidence boundary. */
export const HISTORICAL_QUARANTINE_PLAN_SHA256 = "397176eed1468916266d35b288d041d922ff47f817a3c9d2d1f3ec2cba173566";
export const HISTORICAL_QUARANTINE_ID_DIGESTS: readonly string[] = Object.freeze([
  "f2b7b9c37080de00aa9806d3a7674ca29bfcf606e5ae1f880788642074398498",
  "44b0f6e156af6997e1fa7ce64fa1d95e20d63a725e1a40af6040f4c4e584bdce",
  "40f65f617cbb32e73968ba16adffa3912f2d8a44cc98b2c48f4ba5aee4ef7fc1",
  "f6069873fa0f17a0efdc1a91b4cbbf8dc33e142f147aac829ab86b816eddbb82",
]);
const denied = new Set(HISTORICAL_QUARANTINE_ID_DIGESTS);

export function assertExerciseNotHistoricallyQuarantined(exerciseId: string): void {
  if (typeof exerciseId !== "string" || exerciseId.length === 0) {
    throw new Error("EXERCISE_IDENTITY_INVALID");
  }
  // Exact UTF-8 identity; no trimming, case folding or hash rewriting.
  if (denied.has(sha256Text(exerciseId))) {
    throw new Error("HISTORICAL_CHECKPOINT_QUARANTINED");
  }
}
