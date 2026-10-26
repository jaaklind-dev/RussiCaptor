import Constants from "expo-constants";
import { getOperatorSession, hasPlatformAdminAuthority } from "@/services/authorization/OperatorSessionService";
import { createSharedExerciseSnapshot, restoreRemoteExerciseIdentity, restoreSharedExerciseState, restoreSharedExerciseStateAsync } from "@/services/StatePersistenceService";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot, restoreExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { getCurrentExercise, installCurrentExercise } from "@/repositories/ExerciseRepository";
import { assertExerciseNotHistoricallyQuarantined } from "@/services/exercise/HistoricalExerciseQuarantine";
import { isValidRuntimeCheckpoint, isValidRuntimeCheckpointAsync, localRuntimeCheckpointStore } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { getRuntimeWriterAuthorityState, getRuntimeWriterPublicationGeneration, getRuntimeWriterPublicationLeaseId } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";
import { H4_IDENTITIES, H4_RECEIPT_TEXT } from "./HistoricalInputFixture";
import { executeH4Cases, type H4Case, type H4Report } from "./HistoricalInputProbeCore";

export const H4_RECEIPT_SHA256 = "2100f4f299067bc0ce64efdac0c9f9804168873075dd28701dfe9325668573a5";
let consumed = false;

export function h4ProbeAvailability(): string | undefined {
  if (Constants.expoConfig?.version !== "1.2.1-h4diag1" || Constants.expoConfig?.android?.versionCode !== 187) return "WRONG_DIAGNOSTIC_ARTIFACT";
  if (!hasPlatformAdminAuthority(getOperatorSession())) return "EXISTING_ADMIN_REQUIRED";
  if (getCanonicalExerciseSnapshot().lifecycleState !== "COMPLETED") return "COMPLETED_IDLE_STATE_REQUIRED";
  if (getRuntimeWriterAuthorityState() === "WRITER" || getRuntimeWriterPublicationLeaseId()) return "LOCAL_WRITER_MUST_BE_ABSENT";
  if (consumed) return "PROBE_ALREADY_CONSUMED";
  return undefined;
}

/** Explicit tap only. Fixed inputs, no arbitrary ID/payload interface; never runs at import/startup. */
export async function runHistoricalInputProbe(): Promise<H4Report> {
  const unavailable = h4ProbeAvailability();
  if (unavailable) throw new Error(unavailable);
  if (sha256Text(H4_RECEIPT_TEXT) !== H4_RECEIPT_SHA256) throw new Error("FIXTURE_HASH_MISMATCH");
  const receipt = JSON.parse(H4_RECEIPT_TEXT);
  if (receipt.result?.runtimeEligible !== false || receipt.result?.historicalInvalid !== 4 || H4_IDENTITIES.length !== 4) throw new Error("FIXTURE_BINDING_MISMATCH");
  consumed = true;
  const baseline = createSharedExerciseSnapshot();
  const canonicalSession = getCanonicalExerciseSnapshot();
  const fingerprint = () => sha256Text(stableJson({ shared: createSharedExerciseSnapshot(), exercise: getCurrentExercise(), checkpoint: localRuntimeCheckpointStore.get(), writer: getRuntimeWriterAuthorityState(), lease: getRuntimeWriterPublicationLeaseId(), generation: getRuntimeWriterPublicationGeneration() }));
  // All four guard prechecks run first. Unexpected success stops before any restoration entry call.
  const cases: H4Case[] = H4_IDENTITIES.map(item => ({ id: "EXACT_ID_PRECHECK", alias: item.alias, expected: "HISTORICAL_CHECKPOINT_QUARANTINED", run: () => assertExerciseNotHistoricallyQuarantined(item.exerciseId) }));
  const offline = () => JSON.parse(H4_RECEIPT_TEXT) as RuntimeCheckpointEnvelope<SharedExerciseState>;
  cases.push({ id: "EXACT_OFFLINE_RECEIPT_SYNC_VALIDATOR", expected: "FALSE", run: () => isValidRuntimeCheckpoint(offline()) });
  cases.push({ id: "EXACT_OFFLINE_RECEIPT_ASYNC_VALIDATOR", expected: "FALSE", run: () => isValidRuntimeCheckpointAsync(offline(), async () => undefined) });
  for (const item of H4_IDENTITIES) {
    // Identity-bound projection probe, NOT a claimed copy/reconstruction of historical checkpoint payload.
    const projection = { ...baseline, exerciseSession: { ...canonicalSession, exerciseId: item.exerciseId } };
    const paths: readonly [string, () => unknown | Promise<unknown>][] = [
      ["REMOTE_IDENTITY", () => restoreRemoteExerciseIdentity(projection)],
      ["SYNC_HYDRATION", () => restoreSharedExerciseState(projection, false)],
      ["ASYNC_HYDRATION", () => restoreSharedExerciseStateAsync(projection, false)],
      ["BOOTSTRAP_INSTALL", () => installCurrentExercise(item.exerciseId, item.exerciseId)],
      ["CANONICAL_REPLACE", () => replaceCanonicalExerciseSnapshot(projection.exerciseSession)],
      ["SESSION_RESTORE", () => restoreExerciseSession(projection.exerciseSession)],
    ];
    for (const [id, run] of paths) cases.push({ id, alias: item.alias, expected: "HISTORICAL_CHECKPOINT_QUARANTINED", run });
  }
  const result = await executeH4Cases(H4_RECEIPT_SHA256, fingerprint, cases);
  // One small line per case prevents Android log-entry truncation; never log a projection/payload.
  try {
    const runId = `H4C3-${result.at}`;
    for (const item of result.cases) console.info("H4C3_DIAG187", JSON.stringify({ kind: "CASE", runId, ...item }));
    console.info("H4C3_DIAG187", JSON.stringify({ kind: "FINAL", runId, version: result.version, at: result.at, status: result.status, reason: result.reason, fixtureSha256: result.fixtureSha256, beforeDigest: result.beforeDigest, afterDigest: result.afterDigest, caseCount: result.cases.length }));
  } catch { /* UI retains result if logging is unavailable. */ }
  return result;
}
