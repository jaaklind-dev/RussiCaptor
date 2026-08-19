import { SupabaseExerciseRuntimeRecoveryRepository } from "../SupabaseExerciseRuntimeRecoveryRepository";

const command = { exerciseId: "EX-A", expectedVersion: 4, persistenceFailure: "ACTIVE_RUNTIME_PERSISTENCE_MISSING" as const };
const completedState = {
  exerciseSession: { exerciseId: "EX-A", lifecycleState: "COMPLETED", simulationTimeSec: 10, speed: 1, version: 5, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 },
  patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [], scenarioEvents: [], timelineEvents: [], interventions: [], medicationAdministrations: [], vitalSigns: [],
};

function query(result: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ["select", "eq", "order", "limit"].forEach(method => { chain[method] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => result);
  chain.then = jest.fn((resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve));
  return chain;
}

describe("Supabase recovery terminal reconciliation", () => {
  test("lost RPC result reconciles a committed terminal recovery and clears pending upstream", async () => {
    jest.useFakeTimers();
    const never = new Promise(() => undefined);
    const stateQuery = query({ data: { state: completedState }, error: null });
    const auditQuery = query({ data: [{ id: "AUDIT-1", result: "RECOVERY_TERMINATED" }], error: null });
    const client = { rpc: jest.fn(() => never), from: jest.fn((table: string) => table === "exercise_states" ? stateQuery : auditQuery) } as never;
    const apply = jest.fn(); const pending = new SupabaseExerciseRuntimeRecoveryRepository(client, apply).terminate(command);
    await jest.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toMatchObject({ auditId: "AUDIT-1", snapshot: { lifecycleState: "COMPLETED" } });
    expect(apply).toHaveBeenCalledWith(completedState);
    jest.useRealTimers();
  });

  test("uncommitted recovery returns a typed bounded failure", async () => {
    jest.useFakeTimers();
    const never = new Promise(() => undefined);
    const stateQuery = query({ data: { state: { ...completedState, exerciseSession: { ...completedState.exerciseSession, lifecycleState: "RUNNING" } } }, error: null });
    const auditQuery = query({ data: [], error: null });
    const client = { rpc: jest.fn(() => never), from: jest.fn((table: string) => table === "exercise_states" ? stateQuery : auditQuery) } as never;
    const pending = new SupabaseExerciseRuntimeRecoveryRepository(client, jest.fn()).terminate(command);
    await jest.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toEqual({ code: "RECOVERY_CONFIRMATION_TIMEOUT" });
    jest.useRealTimers();
  });
});
