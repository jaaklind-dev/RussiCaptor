import * as hashing from "@/utils/sha256";
import { assertExerciseNotHistoricallyQuarantined, HISTORICAL_QUARANTINE_ID_DIGESTS, HISTORICAL_QUARANTINE_PLAN_SHA256 } from "../HistoricalExerciseQuarantine";
import { getCurrentExercise, installCurrentExercise } from "@/repositories/ExerciseRepository";
import { getCanonicalExerciseSnapshot, getCanonicalExerciseSnapshotVersion, replaceCanonicalExerciseSnapshot, restoreExerciseSession, subscribeToCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { restoreRemoteExerciseIdentity, restoreSharedExerciseState, restoreSharedExerciseStateAsync } from "@/services/StatePersistenceService";
import { allocateServerExerciseIdentity } from "../ServerExerciseIdentity";
import { supabase } from "@/services/SupabaseService";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

jest.mock("@/services/SupabaseService", () => ({ supabase: { rpc: jest.fn() } }));
const synthetic = "EX-30000000-0000-4000-8000-000000000003";
afterEach(() => { jest.restoreAllMocks(); });
function blockAs(index: number) {
  const real = hashing.sha256Text;
  jest.spyOn(hashing, "sha256Text").mockImplementation(id => id === synthetic ? HISTORICAL_QUARANTINE_ID_DIGESTS[index] : real(id));
}
test("exact four immutable denial digests are bound to the prepared plan, not an approval", () => {
  expect(Object.isFrozen(HISTORICAL_QUARANTINE_ID_DIGESTS)).toBe(true);
  expect(new Set(HISTORICAL_QUARANTINE_ID_DIGESTS).size).toBe(4);
  expect(HISTORICAL_QUARANTINE_PLAN_SHA256).toBe("397176eed1468916266d35b288d041d922ff47f817a3c9d2d1f3ec2cba173566");
});
test.each([0, 1, 2, 3])("denies historical identity %i before any package/session or restore mutation", async index => {
  blockAs(index);
  const before = { ...getCurrentExercise() }, snapshot = getCanonicalExerciseSnapshot(), version = getCanonicalExerciseSnapshotVersion();
  const changed = { ...snapshot, exerciseId: synthetic };
  const listener = jest.fn(), unsubscribe = subscribeToCanonicalExerciseSnapshot(listener);
  try {
    expect(() => installCurrentExercise(synthetic, "Synthetic")).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED");
    expect(() => replaceCanonicalExerciseSnapshot(changed)).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED");
    expect(() => restoreExerciseSession(changed)).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED");
    // Deliberately omit all collections: the identity gate must run first.
    const state = { exerciseSession: changed } as unknown as SharedExerciseState;
    expect(() => restoreRemoteExerciseIdentity(state)).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED");
    expect(() => restoreSharedExerciseState(state)).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED");
    await expect(restoreSharedExerciseStateAsync(state)).rejects.toThrow("HISTORICAL_CHECKPOINT_QUARANTINED");
    expect(getCurrentExercise()).toEqual(before);
    expect(getCanonicalExerciseSnapshot()).toEqual(snapshot);
    expect(getCanonicalExerciseSnapshotVersion()).toBe(version);
    expect(listener).not.toHaveBeenCalled();
  } finally { unsubscribe(); }
});
test.each(["CREATE", "ADMIN", "BUILDER", "PACKAGE", "CLONE", "RESTORE_AS_NEW"] as const)("%s cannot accept a quarantined server allocation", async purpose => {
  blockAs(0);
  (supabase!.rpc as jest.Mock).mockResolvedValue({ data: synthetic, error: null });
  await expect(allocateServerExerciseIdentity({ requestId: "10000000-0000-4000-8000-000000000001", bootstrapId: "20000000-0000-4000-8000-000000000002", purpose })).rejects.toThrow("HISTORICAL_CHECKPOINT_QUARANTINED");
});
test("unrelated identity receives no authority and malformed identity fails closed", () => {
  expect(assertExerciseNotHistoricallyQuarantined("SYNTHETIC-UNRELATED")).toBeUndefined();
  expect(() => assertExerciseNotHistoricallyQuarantined("")).toThrow("EXERCISE_IDENTITY_INVALID");
});
