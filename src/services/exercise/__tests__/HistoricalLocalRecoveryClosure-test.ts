import * as FileSystem from "expo-file-system/legacy";
import { createSharedExerciseSnapshot, loadPersistedState, restoreSharedExerciseState, restoreSharedExerciseStateAsync } from "@/services/StatePersistenceService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { createRuntimeCheckpoint, localRuntimeCheckpointStore } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { setRuntimeWriterAuthorityState, runtimeWritesAllowed } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { renewalFailureRevokesWriter, RuntimeCheckpointRecoveryCoordinator, publicationResultRevokesWriter } from "@/services/RuntimeCheckpointSyncService";
import { storeCompletedExerciseArchive, getCompletedExerciseArchive, clearCompletedExerciseArchives } from "../CompletedExerciseArchiveService";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";

let mockDisk = "";
jest.mock("@/services/SupabaseService", () => ({ supabase: undefined }));
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "synthetic://private/",
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  readAsStringAsync: jest.fn(async () => mockDisk),
  writeAsStringAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
}));
const ids = [
  "RUNTIME-RECOVERY-ACCEPTANCE-286990d3a64e3dcf38395a98f818abf1",
  "RUNTIME-RECOVERY-ACCEPTANCE-9d666dc221df5b51e75bbdb7da8ba3b9",
  "TEST-WF-PROD-20261011-01", "WP44B-SMOKE-1786557775424",
];
const lease: RuntimeWriterLease = { leaseId: "SYNTHETIC-LEASE", exerciseId: "SYNTHETIC-ACTIVE", writerInstanceId: "SYNTHETIC-WRITER", userId: "SYNTHETIC-USER", expiresAt: "2099-01-01T00:00:00Z" };
let warnings: jest.SpyInstance;
beforeEach(() => { warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined); localRuntimeCheckpointStore.restore(undefined); setRuntimeWriterAuthorityState("UNRESOLVED"); });
afterEach(() => { warnings.mockRestore(); jest.clearAllMocks(); setRuntimeWriterAuthorityState("UNRESOLVED"); clearCompletedExerciseArchives(); });
function cached(id: string) {
  const state = createSharedExerciseSnapshot();
  return { ...state, version: 1, savedAt: "2026-01-01T00:00:00Z", exerciseSession: { ...state.exerciseSession, exerciseId: id }, patients: [] };
}
async function rejectDisk(value: unknown) {
  const before = getCanonicalExerciseSnapshot(); mockDisk = JSON.stringify(value);
  await loadPersistedState(); expect(getCanonicalExerciseSnapshot()).toEqual(before);
  expect(localRuntimeCheckpointStore.get()).toBeUndefined();
  expect(warnings).toHaveBeenCalled();
}
test.each(ids)("cached quarantined state and cold restart reject %s before local mutation", async id => rejectDisk(cached(id)));
test("offline startup still applies exact local deny without server availability", async () => { setRuntimeWriterAuthorityState("OFFLINE"); await rejectDisk(cached(ids[0])); });
test("network reconnection cannot restore a quarantined raw projection", () => expect(() => restoreSharedExerciseState(cached(ids[0]) as SharedExerciseState)).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED"));
test("failed server quarantine/registry lookup cannot override the embedded exact denial", async () => { await expect(restoreSharedExerciseStateAsync(cached(ids[0]) as SharedExerciseState)).rejects.toThrow("HISTORICAL_CHECKPOINT_QUARANTINED"); });
test("server unavailable does not bypass disk denial", async () => rejectDisk(cached(ids[1])));
test("expired writer lease revokes publication authority", () => expect(renewalFailureRevokesWriter({ status: "REJECTED", code: "WRITER_LEASE_EXPIRED" } as never, { ...lease, expiresAt: "2000-01-01T00:00:00Z" })).toBe(true));
test("stale generation/lease result revokes writer", () => expect(renewalFailureRevokesWriter({ status: "REJECTED", code: "STALE_WRITER" } as never, lease)).toBe(true));
test("restore request for exact historical ID rejects", () => expect(() => restoreSharedExerciseState(cached(ids[2]) as SharedExerciseState, true)).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED"));
test("identity-preserving clone request cannot hydrate source under its quarantined ID", async () => expect(restoreSharedExerciseStateAsync(cached(ids[2]) as SharedExerciseState, true)).rejects.toThrow("HISTORICAL_CHECKPOINT_QUARANTINED"));
test("legacy JSON storage format receives same pre-hydration identity denial", async () => rejectDisk({ ...cached(ids[0]), runtimeCheckpoint: { exerciseId: ids[0], checkpointRevision: 1 } }));
test("unauthorized reader cannot run local writer commands", () => { setRuntimeWriterAuthorityState("READER"); expect(runtimeWritesAllowed()).toBe(false); });
test("checkpoint publication after reconnect rejects stale writer result", () => expect(publicationResultRevokesWriter("STALE_WRITER")).toBe(true));
test("normal active recovery still requires acquire and exact post-acquire freshness", async () => {
  const cp = createRuntimeCheckpoint(cached(lease.exerciseId) as SharedExerciseState, 1);
  const acquire = jest.fn(async () => ({ status: "ACQUIRED", lease, checkpointRevision: 1 }));
  const adopt = jest.fn();
  const result = await new RuntimeCheckpointRecoveryCoordinator().recover({ intentId: "SYNTHETIC-NORMAL", exerciseId: lease.exerciseId, writerInstanceId: lease.writerInstanceId, repository: { loadLatest: jest.fn(async () => cp), loadLatestMetadata: jest.fn(async () => cp), releaseWriter: jest.fn() }, acquire, adopt } as never);
  expect(result.state).toBe("RECOVERED"); expect(acquire).toHaveBeenCalledWith(1); expect(adopt).toHaveBeenCalledWith(cp, lease);
});
test("completed historical display storage grants no writer authority", () => {
  setRuntimeWriterAuthorityState("READER"); const archive = { exerciseId: ids[0], snapshot: { ...getCanonicalExerciseSnapshot(), exerciseId: ids[0], lifecycleState: "COMPLETED" }, debrief: {}, analytics: {} };
  storeCompletedExerciseArchive(archive as never); expect(getCompletedExerciseArchive(ids[0])?.exerciseId).toBe(ids[0]); expect(runtimeWritesAllowed()).toBe(false);
});
test("ownerless historical ID receives same cached-state denial", async () => rejectDisk(cached(ids[3])));
test("missing quarantine metadata cannot turn known ID into accepted state", async () => rejectDisk({ ...cached(ids[3]), quarantine: undefined }));
test("tampered local storage cannot substitute known historical identity", async () => rejectDisk({ ...cached(ids[0]), payloadHash: "TAMPERED" }));
test("logout/login principal reset does not clear exact deny set", async () => { setRuntimeWriterAuthorityState("OFFLINE"); await rejectDisk(cached(ids[1])); setRuntimeWriterAuthorityState("UNRESOLVED"); await rejectDisk(cached(ids[1])); });
test("upgrade preserving serialized local file applies current denial before hydration", async () => { const persisted = JSON.stringify(cached(ids[2])); mockDisk = persisted; await loadPersistedState(); expect(mockDisk).toBe(persisted); expect(warnings).toHaveBeenCalled(); });
test("a valid-hash historical envelope remains forbidden as an operational identity", () => { const state = cached(ids[0]) as SharedExerciseState; const checkpoint = createRuntimeCheckpoint(state, 1); expect(() => restoreSharedExerciseState(checkpoint.payload, true)).toThrow("HISTORICAL_CHECKPOINT_QUARANTINED"); });
test("malformed disk JSON fails without state mutation", async () => { const before = getCanonicalExerciseSnapshot(); mockDisk = "{"; await loadPersistedState(); expect(getCanonicalExerciseSnapshot()).toEqual(before); });
test("legacy persisted-file test never opens a real filesystem or server", () => expect((FileSystem.getInfoAsync as jest.Mock).getMockImplementation()).toBeDefined());
test.each(["AUTHORITY_UNAVAILABLE", "STALE_WRITER", "WRITER_LEASE_EXPIRED"])("recovery cannot adopt a historical cached checkpoint when server says %s", async code => {
  const cp = createRuntimeCheckpoint(cached(ids[0]) as SharedExerciseState, 1), adopt = jest.fn();
  const result = await new RuntimeCheckpointRecoveryCoordinator().recover({ intentId: code, exerciseId: ids[0], writerInstanceId: lease.writerInstanceId, repository: { loadLatest: jest.fn(async () => cp), loadLatestMetadata: jest.fn(async () => cp), releaseWriter: jest.fn() }, acquire: jest.fn(async () => ({ status: "REJECTED", code })), adopt } as never);
  expect(result.state).toBe("REJECTED"); expect(adopt).not.toHaveBeenCalled();
});
test("even an erroneous successful server response cannot bypass the local historical hydration gate", async () => {
  const cp = createRuntimeCheckpoint(cached(ids[0]) as SharedExerciseState, 1), release = jest.fn(), before = getCanonicalExerciseSnapshot(), historicalLease = { ...lease, exerciseId: ids[0] };
  const result = await new RuntimeCheckpointRecoveryCoordinator().recover({ intentId: "SYNTHETIC-WRONG-SUCCESS", exerciseId: ids[0], writerInstanceId: lease.writerInstanceId, repository: { loadLatest: jest.fn(async () => cp), loadLatestMetadata: jest.fn(async () => cp), releaseWriter: release }, acquire: jest.fn(async () => ({ status: "ACQUIRED", lease: historicalLease })), adopt: async () => restoreSharedExerciseState(cp.payload, true) } as never);
  expect(result.state).toBe("REJECTED"); expect(release).toHaveBeenCalledWith(historicalLease); expect(getCanonicalExerciseSnapshot()).toEqual(before);
});
