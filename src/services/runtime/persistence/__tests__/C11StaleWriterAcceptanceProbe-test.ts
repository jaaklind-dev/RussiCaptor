import fs from "node:fs";
import path from "node:path";

jest.mock("@/config/ReleaseConfig", () => ({ getBuildProvenance: jest.fn(() => ({ supabaseProjectRef: "fimcsrivizpliiuoqopv" })) }));
jest.mock("@/config/SharedWorkflowValidationHarness", () => ({ isSharedWorkflowValidationHarnessEnabled: jest.fn(() => true) }));
jest.mock("@/repositories/ExerciseSessionRepository", () => ({ getCanonicalExerciseSnapshot: jest.fn(() => ({ exerciseId: "EX-TEST", lifecycleState: "RUNNING" })) }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({
  getOperatorSession: jest.fn(() => ({ state: "AUTHENTICATED", profile: { userId: "USER-A" } })),
  getOperatorAuthSessionGeneration: jest.fn(() => 1),
  activeScopedExerciseIds: jest.fn(() => ["EX-TEST"]),
}));
jest.mock("@/services/exercise/CurrentExerciseSelectionService", () => ({ exerciseLifecycle: jest.fn(() => "RUNNING") }));
jest.mock("@/services/ui/OperatorModeService", () => ({ getSelectedOperatorMode: jest.fn(() => "EXCON") }));
jest.mock("../RuntimeWriterAuthorityState", () => ({
  getRuntimeWriterAuthorityState: jest.fn(() => "WRITER"),
  getRuntimeWriterPublicationLeaseId: jest.fn(() => "LEASE-A"),
}));
jest.mock("../RuntimeWriterIdentityService", () => ({ getRuntimeWriterInstanceId: jest.fn(async () => "WRITER-A") }));
jest.mock("@/services/SupabaseService", () => ({ supabase: {
  auth: { getUser: jest.fn(async () => ({ data: { user: { id: "USER-A", is_anonymous: false } }, error: null })) },
  from: jest.fn(),
  rpc: jest.fn(async () => ({ error: { message: "WRITER_GENERATION_STALE" }, status: 403 })),
} }));

const leaseA = { lease_id: "LEASE-A", writer_instance_id: "WRITER-A", writer_user_id: "USER-A",
  writer_generation: 1, released_at: null, expires_at: "2099-01-01T00:00:00Z" };
const leaseB = { ...leaseA, lease_id: "LEASE-B", writer_instance_id: "WRITER-B", writer_generation: 2 };
const state = { exerciseSession: { exerciseId: "EX-TEST", lifecycleState: "RUNNING" },
  exercisePackageReference: { packageId: "russicaptor.narva-trauma", packageVersion: "1.0.5" } };

type Probe = typeof import("../C11StaleWriterAcceptanceProbe");
let probe: Probe;
let db: { auth: { getUser: jest.Mock }; from: jest.Mock; rpc: jest.Mock };
let currentLease = leaseA;
const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
const buildSource = fs.readFileSync(path.resolve(process.cwd(), "scripts/build-field-release.mjs"), "utf8");
const workboardSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/excon/dashboard.tsx"), "utf8");
const exconSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/excon/index.tsx"), "utf8");
const controlsSource = fs.readFileSync(path.resolve(process.cwd(), "src/components/excon/C11StaleWriterAcceptanceControls.tsx"), "utf8");

beforeEach(() => {
  jest.resetModules();
  process.env.EXPO_PUBLIC_C11_STALE_WRITER_PROBE = "1";
  // Jest's resetModules requires a synchronous import in this test runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  probe = require("../C11StaleWriterAcceptanceProbe") as Probe;
  db = (jest.requireMock("@/services/SupabaseService") as { supabase: typeof db }).supabase;
  (jest.requireMock("@/config/ReleaseConfig") as { getBuildProvenance: jest.Mock })
    .getBuildProvenance.mockReturnValue({ supabaseProjectRef: "fimcsrivizpliiuoqopv" });
  (jest.requireMock("@/config/SharedWorkflowValidationHarness") as {
    isSharedWorkflowValidationHarnessEnabled: jest.Mock;
  }).isSharedWorkflowValidationHarnessEnabled.mockReturnValue(true);
  currentLease = leaseA;
  db.auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: "USER-A", is_anonymous: false } }, error: null });
  db.rpc.mockReset().mockResolvedValue({ error: { message: "WRITER_GENERATION_STALE" }, status: 403 });
  db.from.mockReset().mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => table === "runtime_writer_leases"
    ? { data: currentLease, error: null }
    : { data: { exercise_id: "EX-TEST", revision: 7, state }, error: null } }) }) }));
  jest.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.EXPO_PUBLIC_C11_STALE_WRITER_PROBE; });

async function captureAndTakeover() {
  expect((await probe.captureC11StaleWriterProbe()).ok).toBe(true);
  currentLease = leaseB;
}

describe("C11 physical stale-writer acceptance probe", () => {
  test("C11-PROBE-01 is unavailable in normal production configuration and canonical builds", async () => {
    delete process.env.EXPO_PUBLIC_C11_STALE_WRITER_PROBE;
    expect(probe.isC11StaleWriterProbeEnabled()).toBe(false);
    expect((await probe.captureC11StaleWriterProbe()).code).toBe("PROBE_DISABLED");
    expect(buildSource).toContain('releaseVariant === "canonical" || !validationHarnessRequested');
    expect(buildSource).toContain('EXPO_PUBLIC_C11_STALE_WRITER_PROBE: c11ProbeRequested ? "1" : "0"');
  });

  test("C11-PROBE-01B requires the non-distributable harness and exact project", async () => {
    const harness = jest.requireMock("@/config/SharedWorkflowValidationHarness") as {
      isSharedWorkflowValidationHarnessEnabled: jest.Mock;
    };
    const release = jest.requireMock("@/config/ReleaseConfig") as { getBuildProvenance: jest.Mock };
    harness.isSharedWorkflowValidationHarnessEnabled.mockReturnValue(false);
    expect(probe.isC11StaleWriterProbeEnabled()).toBe(false);
    harness.isSharedWorkflowValidationHarnessEnabled.mockReturnValue(true);
    release.getBuildProvenance.mockReturnValue({ supabaseProjectRef: "thixnregyriwevgptclw" });
    expect(probe.isC11StaleWriterProbeEnabled()).toBe(false);
    expect((await probe.captureC11StaleWriterProbe()).code).toBe("PROBE_DISABLED");
  });

  test("C11-PROBE-02 requires the current authenticated operator session", async () => {
    db.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await probe.captureC11StaleWriterProbe()).code).toBe("UNAUTHORIZED");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test("C11-PROBE-03 cannot direct-write exercise_states", async () => {
    await captureAndTakeover();
    await probe.sendC11StaleWriterProbe();
    expect(db.from).toHaveBeenCalledWith("exercise_states");
    expect(db.from.mock.results.every(result => typeof result.value.insert === "undefined" &&
      typeof result.value.update === "undefined" && typeof result.value.upsert === "undefined")).toBe(true);
  });

  test("C11-PROBE-04 calls only the deployed bounded publication RPC", async () => {
    await captureAndTakeover();
    await probe.sendC11StaleWriterProbe();
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc.mock.calls[0][0]).toBe("publish_exercise_state_current_writer");
    expect(Object.keys(db.rpc.mock.calls[0][1]).sort()).toEqual([
      "p_exercise_id", "p_expected_revision", "p_lease_id", "p_operation_id", "p_state", "p_writer_instance_id",
    ]);
  });

  test("C11-PROBE-05 preserves A's old lease/writer/generation evidence", async () => {
    await captureAndTakeover();
    expect(probe.getC11StaleWriterProbeCapture()?.writerGeneration).toBe(1);
    const result = await probe.sendC11StaleWriterProbe();
    expect(result.writerGeneration).toBe(1);
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_lease_id: "LEASE-A", p_writer_instance_id: "WRITER-A" });
    expect(currentLease.writer_generation).toBe(2);
  });

  test("C11-PROBE-06 does not refresh A identity, and uses current revision with unchanged canonical payload", async () => {
    await captureAndTakeover();
    const result = await probe.sendC11StaleWriterProbe();
    expect(result.expectedRevision).toBe(7);
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_lease_id: "LEASE-A", p_expected_revision: 7, p_state: state });
  });

  test("C11-PROBE-07 sends no more than once per captured operation", async () => {
    await captureAndTakeover();
    expect((await probe.sendC11StaleWriterProbe()).ok).toBe(true);
    expect((await probe.sendC11StaleWriterProbe()).code).toBe("PROBE_NOT_ARMED");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  test("C11-PROBE-07B cannot send without a valid captured A context", async () => {
    expect((await probe.sendC11StaleWriterProbe()).code).toBe("PROBE_NOT_ARMED");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test("C11-PROBE-07C concurrent explicit sends still produce exactly one RPC", async () => {
    await captureAndTakeover();
    const results = await Promise.all([probe.sendC11StaleWriterProbe(), probe.sendC11StaleWriterProbe()]);
    expect(results.map(result => result.code).sort()).toEqual(["PROBE_NOT_ARMED", "WRITER_GENERATION_STALE"]);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  test("C11-PROBE-08 diagnostic contains no token, session, email, or state payload", async () => {
    await captureAndTakeover();
    await probe.sendC11StaleWriterProbe();
    const emitted = (console.info as jest.Mock).mock.calls.map(args => JSON.stringify(args)).join(" ");
    expect(emitted).toContain("SENT");
    expect(emitted).not.toMatch(/access_token|refresh_token|@|patients|exerciseSession|p_state/);
  });

  test("C11-PROBE-09 surfaces only the exact bounded stale generation error", async () => {
    await captureAndTakeover();
    expect((await probe.sendC11StaleWriterProbe()).code).toBe("WRITER_GENERATION_STALE");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  test("C11-PROBE-10 does not change normal local stale-writer suppression", () => {
    expect(source).toContain("sendCurrentProjectionPublication(publicationStamp, currentProjectionPublicationContext()");
    expect(source).toContain("projectionPublicationStampIsCurrent(publicationStamp, sendContext)");
    expect(source).not.toContain("sendC11StaleWriterProbe");
  });

  test("C11-PROBE-11 refuses a replacement authenticated session after capture", async () => {
    await captureAndTakeover();
    (jest.requireMock("@/services/authorization/OperatorSessionService") as {
      getOperatorAuthSessionGeneration: jest.Mock;
    }).getOperatorAuthSessionGeneration.mockReturnValue(2);
    expect((await probe.sendC11StaleWriterProbe()).code).toBe("EXERCISE_OR_SCOPE_CHANGED");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test("C11-PROBE-12 is reachable on the active EXCON workboard without PLATFORM_ADMIN", () => {
    expect(workboardSource).toContain("<C11StaleWriterAcceptanceControls />");
    expect(exconSource).not.toContain("<C11StaleWriterAcceptanceControls />");
    expect(controlsSource).toContain("if (!isC11StaleWriterProbeEnabled()) return null");
    expect(controlsSource).toContain("useSyncExternalStore(subscribeToWriterAuthority");
    expect(controlsSource).toContain("captureC11StaleWriterProbe");
    expect(controlsSource).toContain("sendC11StaleWriterProbe");
    expect(controlsSource).not.toContain("hasPlatformAdminAuthority");
  });
});
