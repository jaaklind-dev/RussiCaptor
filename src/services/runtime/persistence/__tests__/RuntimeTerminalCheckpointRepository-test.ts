import { SupabaseRuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";
import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

const lease: RuntimeWriterLease = Object.freeze({ leaseId: "00000000-0000-0000-0000-000000000001",
  exerciseId: "EX-LARGE", writerInstanceId: "WRITER-1", userId: "USER-1", expiresAt: "2099-01-01T00:00:00.000Z" });

describe("WP-NARVA-06 terminal checkpoint repository", () => {
  test("submits an approximately 4 MB completed checkpoint to the atomic finalizer", async () => {
    const large = "x".repeat(4_100_000);
    const checkpoint = Object.freeze({ envelopeVersion: 1 as const, exerciseId: "EX-LARGE", checkpointRevision: 75, persistedRuntimeVersion: 1,
      payloadHash: "a".repeat(64), provenanceHash: "b".repeat(64),
      payload: { exerciseSession: { exerciseId: "EX-LARGE", lifecycleState: "COMPLETED", simulationTimeSec: 120,
        speed: 1, version: 8 }, patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [],
        orders: [], notes: [], scenarioEvents: [], timelineEvents: [], runtimePatientCommandCursor: 4, testPayload: large } as unknown as SharedExerciseState,
    }) as RuntimeCheckpointEnvelope<SharedExerciseState>;
    const rpc = jest.fn(async () => ({ data: [{ checkpoint_revision: 75, payload_hash: checkpoint.payloadHash,
      provenance_hash: checkpoint.provenanceHash }], error: null }));
    const repository = new SupabaseRuntimeCheckpointRepository({ rpc } as never);
    await expect(repository.finalizeCompletion("COMPLETE-1", lease, 74, checkpoint)).resolves.toMatchObject({
      status: "PUBLISHED", checkpoint: { checkpointRevision: 75 },
    });
    expect(rpc).toHaveBeenCalledWith("finalize_runtime_completion", expect.objectContaining({
      p_command_id: "COMPLETE-1", p_expected_checkpoint_revision: 74, p_checkpoint: checkpoint,
    }));
    expect(JSON.stringify(checkpoint).length).toBeGreaterThan(4_000_000);
  });

  test("terminal persistence failure is returned without a success acknowledgement", async () => {
    const repository = new SupabaseRuntimeCheckpointRepository({ rpc: async () => ({ data: null,
      error: { message: "TERMINAL_CHECKPOINT_INVALID" } }) } as never);
    const checkpoint = { exerciseId: "EX-LARGE" } as RuntimeCheckpointEnvelope<SharedExerciseState>;
    await expect(repository.finalizeCompletion("COMPLETE-1", lease, 74, checkpoint)).resolves.toMatchObject({
      status: "AUTHORITY_UNAVAILABLE", code: "TERMINAL_CHECKPOINT_INVALID",
    });
  });

  test("does not misclassify an unknown database failure as missing authentication", async () => {
    const repository = new SupabaseRuntimeCheckpointRepository({ rpc: async () => ({ data: null,
      error: { code: "XX000", message: "database execution failed" } }) } as never);
    const checkpoint = { exerciseId: "EX-LARGE" } as RuntimeCheckpointEnvelope<SharedExerciseState>;
    await expect(repository.finalizeCompletion("COMPLETE-1", lease, 74, checkpoint)).resolves.toMatchObject({
      status: "AUTHORITY_UNAVAILABLE", code: "BACKEND_ERROR",
    });
  });

  test("retains explicit authentication failure classification", async () => {
    const repository = new SupabaseRuntimeCheckpointRepository({ rpc: async () => ({ data: null,
      error: { code: "PGRST301", message: "JWT expired" } }) } as never);
    const checkpoint = { exerciseId: "EX-LARGE" } as RuntimeCheckpointEnvelope<SharedExerciseState>;
    await expect(repository.finalizeCompletion("COMPLETE-1", lease, 74, checkpoint)).resolves.toMatchObject({
      status: "AUTHORITY_UNAVAILABLE", code: "AUTHORITY_UNAVAILABLE",
    });
  });
});
