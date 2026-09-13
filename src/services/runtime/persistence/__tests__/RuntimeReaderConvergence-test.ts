import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import {
  acceptRuntimeReaderCheckpoint,
  advertiseRuntimeReaderCheckpoint,
  beginRuntimeReaderConvergence,
  getRuntimeReaderConvergenceState,
  resetRuntimeReaderConvergence,
  runtimeReaderCommandReadiness,
  setRuntimeCommandAuthorityWriter,
} from "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import {
  setRuntimePatientCommandGateway,
  submitPatientRuntimeCommand,
  type RuntimePatientCommandGateway,
} from "@/services/runtime/commands/RuntimePatientCommandService";
import { observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics } from
  "@/services/sharedWorkflow/SharedWorkflowMutationService";

const exerciseId = "EX-READER-COLD";
const patientId = "PT-IRO-001";

const checkpoint = (revision: number, simulationTimeSec: number, version = revision) => ({
  exerciseId,
  checkpointRevision: revision,
  payloadHash: `HASH-${revision}-${simulationTimeSec}`,
  provenanceHash: `PROVENANCE-${revision}`,
  persistedRuntimeVersion: 1,
  payload: { exerciseSession: { exerciseId, lifecycleState: "RUNNING", simulationTimeSec,
    speed: 1, version, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 } },
}) as RuntimeCheckpointEnvelope<SharedExerciseState>;

const metadata = (value: RuntimeCheckpointEnvelope<SharedExerciseState>) => ({
  exerciseId: value.exerciseId,
  checkpointRevision: value.checkpointRevision,
  payloadHash: value.payloadHash,
  provenanceHash: value.provenanceHash,
  writerInstanceId: "WRITER-EMULATOR",
});

describe("WP-NARVA-10B8 reader checkpoint/time convergence", () => {
  const exerciseBefore = getCanonicalExerciseSnapshot();

  afterEach(() => {
    resetRuntimeReaderConvergence();
    setRuntimePatientCommandGateway(undefined);
    resetSharedWorkflowConflictMetrics();
    replaceCanonicalExerciseSnapshot(exerciseBefore);
  });

  test("fences a stale T+728 reader until rev 26 / T+2622 is atomically accepted", () => {
    const authoritative = checkpoint(26, 2622, 1456);
    beginRuntimeReaderConvergence(exerciseId);
    advertiseRuntimeReaderCheckpoint(metadata(authoritative));

    expect(runtimeReaderCommandReadiness(exerciseId, 728)).toMatchObject({ ready: false });
    expect(getRuntimeReaderConvergenceState()).toMatchObject({ phase: "SYNCHRONIZING",
      advertisedRevision: 26 });

    acceptRuntimeReaderCheckpoint(authoritative, "REMOTE");
    expect(getRuntimeReaderConvergenceState()).toMatchObject({ phase: "READY", appliedRevision: 26,
      simulationTimeSec: 2622, sessionVersion: 1456, source: "REMOTE" });
    expect(runtimeReaderCommandReadiness(exerciseId, 2622)).toEqual({ ready: true });
    expect(runtimeReaderCommandReadiness(exerciseId, 728)).toMatchObject({ ready: false });
  });

  test("accepts revisions monotonically and ignores late rev 24/25 callbacks after rev 26", () => {
    beginRuntimeReaderConvergence(exerciseId);
    advertiseRuntimeReaderCheckpoint(metadata(checkpoint(24, 2400)));
    advertiseRuntimeReaderCheckpoint(metadata(checkpoint(26, 2622)));
    acceptRuntimeReaderCheckpoint(checkpoint(26, 2622), "DELTA");
    advertiseRuntimeReaderCheckpoint(metadata(checkpoint(25, 2500)));
    acceptRuntimeReaderCheckpoint(checkpoint(24, 2400), "REMOTE");
    expect(getRuntimeReaderConvergenceState()).toMatchObject({ phase: "READY", advertisedRevision: 26,
      appliedRevision: 26, simulationTimeSec: 2622, source: "DELTA" });
  });

  test("a newer advertised revision immediately fences a previously ready reader", () => {
    beginRuntimeReaderConvergence(exerciseId);
    const revision25 = checkpoint(25, 2500);
    advertiseRuntimeReaderCheckpoint(metadata(revision25));
    acceptRuntimeReaderCheckpoint(revision25, "REMOTE");
    expect(runtimeReaderCommandReadiness(exerciseId, 2500)).toEqual({ ready: true });
    advertiseRuntimeReaderCheckpoint(metadata(checkpoint(26, 2622)));
    expect(runtimeReaderCommandReadiness(exerciseId, 2500)).toMatchObject({ ready: false });
  });

  test("central durable submit rejects stale reader intent before backend insertion, then accepts converged time", async () => {
    const submit = jest.fn(async () => Object.freeze({ status: "APPLIED" as const,
      commandSequence: 63, patientRevision: 12, ownerUserId: "CM-A" }));
    const gateway: RuntimePatientCommandGateway = { submit, loadAfter: jest.fn(async () => Object.freeze([])),
      record: jest.fn(async () => undefined) };
    replaceCanonicalExerciseSnapshot({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 2622,
      speed: 1, version: 1456, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead(exerciseId, patientId, 11, "CM-A");
    setRuntimePatientCommandGateway(gateway);
    beginRuntimeReaderConvergence(exerciseId);
    const authoritative = checkpoint(26, 2622, 1456);
    advertiseRuntimeReaderCheckpoint(metadata(authoritative));

    await expect(submitPatientRuntimeCommand({ exerciseId, patientId, commandId: "PARACETAMOL-STALE",
      commandType: "CLINICAL_TREATMENT", simulationTimeSec: 728, payload: {} }))
      .resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });
    expect(submit).not.toHaveBeenCalled();

    acceptRuntimeReaderCheckpoint(authoritative, "REMOTE");
    await expect(submitPatientRuntimeCommand({ exerciseId, patientId, commandId: "PARACETAMOL-CURRENT",
      commandType: "CLINICAL_TREATMENT", payload: {} }))
      .resolves.toMatchObject({ status: "APPLIED", commandSequence: 63 });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ simulationTimeSec: 2622,
      patientBaseRevision: 11 }));
  });

  test("writer authority remains command-ready without reader convergence or a reader lease", () => {
    beginRuntimeReaderConvergence(exerciseId);
    setRuntimeCommandAuthorityWriter(exerciseId);
    expect(runtimeReaderCommandReadiness(exerciseId, 9999)).toEqual({ ready: true });
  });
});
