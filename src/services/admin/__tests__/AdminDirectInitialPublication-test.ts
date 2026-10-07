import { acknowledgeInitialExercisePublication, initialExerciseProjectionMatches,
  type BootstrapConsumptionReadback, type InitialExercisePublicationPort,
  type InitialExerciseReadback } from "@/services/CloudSyncService";
import { beginInitialExercisePublication, resetInitialExercisePublicationFenceForTests } from
  "@/services/exercise/InitialExercisePublicationFence";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

const input = Object.freeze({ operationId: "OP-DIRECT", userId: "USER-ADMIN", exerciseId: "EX-DIRECT",
  packageId: "russicaptor.narva-trauma", packageVersion: "1.0.5", bootstrapAuthorizationId: "BOOT-DIRECT" });
const projection = {
  exerciseSession: { exerciseId: input.exerciseId, lifecycleState: "READY", simulationTimeSec: 0, speed: 1,
    lastCommandId: "PREPARE-DIRECT" },
  exercisePackageReference: { packageId: input.packageId, packageVersion: input.packageVersion },
} as unknown as SharedExerciseState;
const bootstrap = Object.freeze({ id: input.bootstrapAuthorizationId, status: "ACTIVE",
  consumed_exercise_id: null, consumed_at: null, expires_at: "2099-01-01T00:00:00Z" });

function harness(options: Readonly<{ existing?: boolean; failInsert?: boolean; discovered?: boolean;
  consumed?: boolean; expired?: boolean; wrongUser?: boolean }> = {}) {
  const events: string[] = [];
  let exercise: InitialExerciseReadback | undefined = options.existing ? {
    exercise_id: input.exerciseId, revision: 1, exercise_session: projection.exerciseSession,
    exercise_package_reference: projection.exercisePackageReference,
    updated_at: "2026-10-07T00:00:00Z",
  } : undefined;
  let grant: BootstrapConsumptionReadback = { ...bootstrap,
    ...(options.expired ? { expires_at: "2020-01-01T00:00:00Z" } : {}),
    ...(options.consumed ? { consumed_exercise_id: input.exerciseId, consumed_at: "2026-10-07T00:00:00Z" } : {}),
  };
  const port: InitialExercisePublicationPort = {
    authenticatedUserId: async () => options.wrongUser ? "OTHER" : input.userId,
    projection: () => projection,
    readExercise: async () => { events.push("read-exercise"); return exercise; },
    readBootstrap: async () => { events.push("read-bootstrap"); return grant; },
    insert: async row => {
      events.push("insert");
      if (options.failInsert) throw new Error("ADMIN_EXERCISE_INITIAL_INSERT_FAILED");
      exercise = { exercise_id: row.exercise_id, revision: row.revision,
        exercise_session: row.state.exerciseSession,
        exercise_package_reference: row.state.exercisePackageReference, updated_at: row.updated_at };
      grant = { ...grant, consumed_exercise_id: row.exercise_id, consumed_at: row.updated_at };
    },
    discover: async () => { events.push("discover"); return options.discovered !== false; },
    wait: async () => undefined,
  };
  return { port, events, readExercise: () => exercise, readBootstrap: () => grant };
}

describe("Admin direct initial publication", () => {
  beforeEach(() => {
    resetInitialExercisePublicationFenceForTests();
    beginInitialExercisePublication({ operationId: input.operationId, exerciseId: input.exerciseId,
      packageIdentity: { packageId: input.packageId, packageVersion: input.packageVersion } });
  });

  test("ADMIN-DIRECT-PUB-01/02/03 issues and awaits one explicit INSERT rather than an empty flush", async () => {
    const h = harness();
    await expect(acknowledgeInitialExercisePublication(input, h.port)).resolves.toMatchObject({ exerciseId: input.exerciseId, revision: 1 });
    expect(h.events.filter(event => event === "insert")).toHaveLength(1);
    expect(h.events.indexOf("insert")).toBeLessThan(h.events.indexOf("discover"));
  });

  test("ADMIN-DIRECT-PUB-04/05/06 requires INSERT, consumed grant, exact row and discovery before ACK", async () => {
    const h = harness({ failInsert: true });
    await expect(acknowledgeInitialExercisePublication(input, h.port)).rejects.toThrow("ADMIN_EXERCISE_INITIAL_INSERT_FAILED");
    expect(h.events).not.toContain("discover");
    expect(h.readExercise()).toBeUndefined();
    expect(h.readBootstrap().consumed_at).toBeNull();
  });

  test("ADMIN-DIRECT-PUB-07/08 exact package ID and version are required", () => {
    expect(initialExerciseProjectionMatches(projection, input.exerciseId, input.packageId, input.packageVersion)).toBe(true);
    expect(initialExerciseProjectionMatches(projection, input.exerciseId, "other", input.packageVersion)).toBe(false);
    expect(initialExerciseProjectionMatches(projection, input.exerciseId, input.packageId, "1.0.4")).toBe(false);
  });

  test("ADMIN-DIRECT-PUB-09 no insert is allowed for a different authenticated user", async () => {
    const h = harness({ wrongUser: true });
    await expect(acknowledgeInitialExercisePublication(input, h.port)).rejects.toThrow("ADMIN_EXERCISE_AUTH_MISMATCH");
    expect(h.events).not.toContain("insert");
  });

  test("ADMIN-DIRECT-PUB-10 expired bootstrap fails closed before INSERT", async () => {
    const h = harness({ expired: true });
    await expect(acknowledgeInitialExercisePublication(input, h.port)).rejects.toThrow("ADMIN_EXERCISE_BOOTSTRAP_UNAVAILABLE");
    expect(h.events).not.toContain("insert");
  });

  test("ADMIN-DIRECT-PUB-11 consumed bootstrap cannot be reused to create another row", async () => {
    const h = harness({ consumed: true });
    await expect(acknowledgeInitialExercisePublication(input, h.port)).rejects.toThrow("ADMIN_EXERCISE_BOOTSTRAP_UNAVAILABLE");
    expect(h.events).not.toContain("insert");
  });

  test("ADMIN-DIRECT-PUB-12 lost response discovers the same prior row without duplicate INSERT", async () => {
    const h = harness({ existing: true, consumed: true });
    await expect(acknowledgeInitialExercisePublication(input, h.port)).resolves.toMatchObject({ exerciseId: input.exerciseId });
    expect(h.events).not.toContain("insert");
  });

  test("ADMIN-DIRECT-PUB-13 prior mismatched identity is refused, not overwritten", async () => {
    const h = harness({ existing: true, consumed: true });
    await expect(acknowledgeInitialExercisePublication({ ...input, packageVersion: "1.0.4" }, h.port))
      .rejects.toThrow("ADMIN_EXERCISE_PROJECTION_MISMATCH");
    expect(h.events).not.toContain("insert");
  });

  test("ADMIN-DIRECT-PUB-14 discovery failure cannot count as durable success", async () => {
    const h = harness({ discovered: false });
    await expect(acknowledgeInitialExercisePublication(input, h.port)).rejects.toThrow("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT");
    expect(h.events.filter(event => event === "insert")).toHaveLength(1);
  });

  test("ADMIN-DIRECT-PUB-15 wrong pending operation cannot publish", async () => {
    const h = harness();
    await expect(acknowledgeInitialExercisePublication({ ...input, operationId: "OTHER" }, h.port))
      .rejects.toThrow("ADMIN_EXERCISE_CREATE_IDENTITY_MISMATCH");
    expect(h.events).toHaveLength(0);
  });

  test("ADMIN-DIRECT-PUB-21 delayed backend INSERT keeps the create promise unsettled", async () => {
    const h = harness();
    let release!: () => void;
    const originalInsert = h.port.insert;
    const port = { ...h.port, insert: (row: Parameters<typeof originalInsert>[0]) =>
      new Promise<void>(resolve => { release = () => { void originalInsert(row).then(resolve); }; }) };
    const create = acknowledgeInitialExercisePublication(input, port);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.events).not.toContain("discover");
    release();
    await expect(create).resolves.toMatchObject({ exerciseId: input.exerciseId });
  });

  test("ADMIN-DIRECT-PUB-22 an unconsumed bootstrap cannot be mistaken for success", async () => {
    const h = harness();
    const port = { ...h.port, readBootstrap: async () => bootstrap };
    await expect(acknowledgeInitialExercisePublication(input, port)).rejects.toThrow("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT");
    expect(h.events.filter(event => event === "insert")).toHaveLength(1);
    expect(h.events).not.toContain("discover");
  });
});
