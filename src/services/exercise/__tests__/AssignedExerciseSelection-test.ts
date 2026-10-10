import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";

let mockExerciseId = "OLD-EXERCISE";
let mockMode: "CM" | "EXCON" = "CM";
let mockSessionGeneration = 1;
let mockOperator: OperatorSessionState;
const mockMaybeSingle = jest.fn();
const mockSelect = jest.fn(() => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect }));
const mockRestoreIdentity = jest.fn((state: { exerciseSession: { exerciseId: string } }) => {
  mockExerciseId = state.exerciseSession.exerciseId;
});

jest.mock("@/services/SupabaseService", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (table: string) => mockFrom(table) },
  synchronizeRealtimeAuthorization: jest.fn(),
}));
jest.mock("@/services/authorization/OperatorSessionService", () => ({
  getOperatorSession: () => mockOperator,
  getOperatorAuthSessionGeneration: () => mockSessionGeneration,
  activeScopedExerciseIds: (state: OperatorSessionState, role: string) =>
    state.state === "AUTHENTICATED" ? state.principal.roleAssignments
      .flatMap(item => item.role === role && item.status === "ACTIVE" && item.scope.scopeType === "EXERCISE"
        ? [item.scope.scopeId] : []) : [],
  hasActiveRole: jest.fn(),
}));
jest.mock("@/services/ui/OperatorModeService", () => ({ getSelectedOperatorMode: () => mockMode }));
jest.mock("@/repositories/ExerciseSessionRepository", () => ({
  getCanonicalExerciseSnapshot: () => ({ exerciseId: mockExerciseId, lifecycleState: "READY" }),
}));
jest.mock("@/services/StatePersistenceService", () => ({
  restoreRemoteExerciseIdentity: (state: unknown) => mockRestoreIdentity(state as never),
  restoreSharedExerciseState: jest.fn(), createSharedExerciseProjection: jest.fn(),
  getLocalRuntimeCheckpoint: jest.fn(),
}));

// eslint-disable-next-line import/first
import { selectAssignedRemoteExercise } from "@/services/CloudSyncService";

const target = "EX-ASSIGNED";
function operator(userId = "USER-1", roles: readonly ("CM" | "EXCON")[] = ["CM", "EXCON"]): OperatorSessionState {
  return { state: "AUTHENTICATED", profile: { userId, displayName: "Operator" }, principal: {
    userId, authenticationState: "AUTHENTICATED", permissions: [],
    roleAssignments: roles.map(role => ({ assignmentId: `${role}-1`, userId, role,
      status: "ACTIVE", scope: { scopeType: "EXERCISE", scopeId: target },
      issuedAt: "2026-10-10T00:00:00Z", issuedBy: "ADMIN" })),
    authorizationFreshness: "VERIFIED_ONLINE",
    authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS",
      verifiedAt: "2026-10-10T00:00:00Z", expiresAt: "2026-10-11T00:00:00Z" },
  } };
}
function row(exerciseId = target) {
  return { exercise_id: exerciseId, revision: 6, updated_at: "2026-10-10T12:00:00Z", updated_by: "USER-1",
    state: { exerciseSession: { exerciseId, lifecycleState: "PAUSED", simulationTimeSec: 30,
      speed: 1, version: 6, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 },
    patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [],
    orders: [], notes: [], scenarioEvents: [], timelineEvents: [] } };
}

describe("assigned exercise selection after session restore", () => {
  beforeEach(() => {
    mockExerciseId = "OLD-EXERCISE"; mockMode = "CM"; mockSessionGeneration = 1; mockOperator = operator();
    mockFrom.mockClear(); mockSelect.mockClear(); mockRestoreIdentity.mockClear();
    mockMaybeSingle.mockReset().mockResolvedValue({ data: row(), error: null });
  });

  test("CM-SEL-01 restored CM opens exact current assignment without a discovery conflict", async () => {
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith("exercise_states");
    expect(mockExerciseId).toBe(target);
  });
  test("CM-SEL-02 stale remembered exercise is replaced by the server row", async () => {
    mockExerciseId = "OLD-BOTULISM";
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: true });
    expect(mockRestoreIdentity).toHaveBeenCalledTimes(1);
    expect(mockExerciseId).toBe(target);
  });
  test("CM-SEL-03 refreshed assignment controls selection, not a previous local ID", async () => {
    mockOperator = operator("USER-1", ["CM"]);
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: true });
    expect(mockExerciseId).toBe(target);
  });
  test("CM-SEL-04 a replaced session cannot apply the old user's in-flight result", async () => {
    let release!: (value: unknown) => void;
    mockMaybeSingle.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const selection = selectAssignedRemoteExercise(target, "CM");
    mockSessionGeneration += 1;
    release({ data: row(), error: null });
    await expect(selection).resolves.toEqual({ ok: false, code: "ASSIGNMENT_MISSING" });
    expect(mockRestoreIdentity).not.toHaveBeenCalled();
  });
  test("CM-SEL-05 missing assignment fails closed before fetching", async () => {
    mockOperator = operator("USER-1", []);
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: false, code: "ASSIGNMENT_MISSING" });
    expect(mockFrom).not.toHaveBeenCalled();
  });
  test("CM-SEL-06 missing server row is distinct from role denial", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: false, code: "EXERCISE_UNAVAILABLE" });
  });
  test("CM-SEL-07 transient read failure permits a deliberate bounded retry", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: false, code: "EXERCISE_SELECTION_UNAVAILABLE" });
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: true });
    expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
  });
  test("CM-SEL-08 CM and EXCON remain separate scoped authorities", async () => {
    mockOperator = operator("USER-1", ["CM"]); mockMode = "EXCON";
    await expect(selectAssignedRemoteExercise(target, "EXCON")).resolves.toEqual({ ok: false, code: "ASSIGNMENT_MISSING" });
    mockMode = "CM";
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: true });
  });
  test("wrong returned exercise identity cannot replace current state", async () => {
    mockMaybeSingle.mockResolvedValue({ data: row("EX-OTHER"), error: null });
    await expect(selectAssignedRemoteExercise(target, "CM")).resolves.toEqual({ ok: false, code: "EXERCISE_IDENTITY_MISMATCH" });
    expect(mockRestoreIdentity).not.toHaveBeenCalled();
  });
});
