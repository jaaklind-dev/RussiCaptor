// Run with the explicitly pinned legacy source mapper, never as a current-
// client assertion. This documents display hydration, not a server writer lease.
import { createSharedExerciseSnapshot, loadPersistedState } from "@/services/StatePersistenceService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { getRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
jest.mock("@/services/SupabaseService", () => ({ supabase: undefined }));
let mockDisk = "";
jest.mock("expo-file-system/legacy", () => ({ documentDirectory: "synthetic://private/", getInfoAsync: jest.fn(async () => ({ exists: true })), readAsStringAsync: jest.fn(async () => mockDisk) }));
test("pinned-source cache contract: legacy READY display is not a server writer; current source denies the identity", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const id = "TEST-WF-PROD-20261011-01", state = createSharedExerciseSnapshot();
    mockDisk = JSON.stringify({ ...state, version: 1, savedAt: "2026-01-01T00:00:00Z", currentCaseManager: getCurrentCaseManager(), exerciseSession: { ...state.exerciseSession, exerciseId: id, lifecycleState: "READY" } });
    const legacy = require.resolve("@/services/StatePersistenceService").includes("/russicaptor-a2-history-source/");
    await loadPersistedState();
    if (legacy) expect(getCanonicalExerciseSnapshot().exerciseId).toBe(id);
    else expect(getCanonicalExerciseSnapshot().exerciseId).not.toBe(id);
    expect(getRuntimeWriterAuthorityState()).not.toBe("WRITER");
  } finally { warn.mockRestore(); }
});
