import { SupabaseRuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";
import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { createRuntimeCheckpoint, getRuntimeCheckpointCanonicalRepresentation } from "../RuntimeCheckpointAuthorityService";

const lease: RuntimeWriterLease = Object.freeze({ leaseId: "00000000-0000-0000-0000-000000000001",
  exerciseId: "EX-LARGE", writerInstanceId: "WRITER-1", userId: "USER-1", expiresAt: "2099-01-01T00:00:00.000Z" });

describe("WP-NARVA-06 terminal checkpoint repository", () => {
  test("canonical terminal publication sends one full semantic representation to an atomic finalizer", async () => {
    const checkpoint = createRuntimeCheckpoint({
      exerciseSession: { exerciseId: "EX-LARGE", lifecycleState: "COMPLETED", simulationTimeSec: 120 },
      patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
      scenarioEvents: [], timelineEvents: [], persistedRuntimeStates: [], runtimePatientCommandCursor: 4,
    } as never, 75);
    const representation = getRuntimeCheckpointCanonicalRepresentation(checkpoint)!;
    const rpc = jest.fn(async (..._args: unknown[]) => ({ data: [{ checkpoint_revision: 75, payload_hash: checkpoint.payloadHash,
      provenance_hash: checkpoint.provenanceHash }], error: null }));
    const repository = new SupabaseRuntimeCheckpointRepository({ rpc } as never);
    await expect(repository.finalizeCompletion("COMPLETE-1", lease, 74, checkpoint)).resolves.toMatchObject({ status: "PUBLISHED" });
    expect(rpc).toHaveBeenCalledWith("finalize_runtime_completion_canonical_payload", expect.objectContaining({
      p_command_id: "COMPLETE-1", p_expected_checkpoint_revision: 74,
      p_canonical_payload_text: representation.canonicalPayloadText,
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_checkpoint");
  });

  test.each([
    ["1.8 MB", 1_800_000],
    ["4 MB", 4_000_000],
    ["8 MB", 8_000_000],
    ["12 MB", 12_000_000],
    ["15.6 MB", 15_600_000],
  ])("submits an approximately %s completed checkpoint to the atomic finalizer", async (_label, payloadSize) => {
    const large = "x".repeat(payloadSize);
    const checkpoint = createRuntimeCheckpoint({ exerciseSession: { exerciseId: "EX-LARGE", lifecycleState: "COMPLETED", simulationTimeSec: 120,
        speed: 1, version: 8 }, patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [],
        orders: [], notes: [], scenarioEvents: [], timelineEvents: [], runtimePatientCommandCursor: 4, testPayload: large } as unknown as SharedExerciseState,
      75) as RuntimeCheckpointEnvelope<SharedExerciseState>;
    const rpc = jest.fn(async (..._args: unknown[]) => ({ data: [{ checkpoint_revision: 75, payload_hash: checkpoint.payloadHash,
      provenance_hash: checkpoint.provenanceHash }], error: null }));
    const repository = new SupabaseRuntimeCheckpointRepository({ rpc } as never);
    await expect(repository.finalizeCompletion("COMPLETE-1", lease, 74, checkpoint)).resolves.toMatchObject({
      status: "PUBLISHED", checkpoint: { checkpointRevision: 75 },
    });
    expect(rpc).toHaveBeenCalledWith("finalize_runtime_completion_canonical_payload", expect.objectContaining({
      p_command_id: "COMPLETE-1", p_expected_checkpoint_revision: 74,
    }));
    const request = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(request).not.toHaveProperty("p_checkpoint");
    expect(JSON.stringify(request).length).toBeGreaterThan(payloadSize);
    expect(JSON.stringify(request).length).toBeLessThan(JSON.stringify(checkpoint).length * 1.2);
  });

  test("profiles one-representation publication request sizes", async () => {
    const profile: { label: string; semanticBytes: number; beforeBytes: number; afterBytes: number; reductionPercent: number }[] = [];
    for (const [label, payloadSize] of [["1.8 MB",1_800_000],["3 MB",3_000_000],["4 MB",4_000_000],
      ["8 MB",8_000_000],["12 MB",12_000_000],["15.6 MB",15_600_000]] as const) {
      const checkpoint = createRuntimeCheckpoint({
        exerciseSession: { exerciseId: "EX-LARGE", lifecycleState: "COMPLETED", simulationTimeSec: 120 },
        patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
        scenarioEvents: [], timelineEvents: [], persistedRuntimeStates: [], runtimePatientCommandCursor: 4,
        testPayload: "x".repeat(payloadSize),
      } as never, 75);
      let request: Record<string, unknown> = {};
      const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => {
        request = args;
        return { data: [{ checkpoint_revision: 75, payload_hash: checkpoint.payloadHash,
          provenance_hash: checkpoint.provenanceHash }], error: null };
      });
      const repository = new SupabaseRuntimeCheckpointRepository({ rpc } as never);
      await repository.finalizeCompletion("COMPLETE-1", lease, 74, checkpoint);
      const afterBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
      const beforeBytes = Buffer.byteLength(JSON.stringify({ ...request, p_checkpoint: checkpoint }), "utf8");
      profile.push({ label, semanticBytes: Buffer.byteLength(JSON.stringify(checkpoint), "utf8"), beforeBytes, afterBytes,
        reductionPercent: Math.round((1-afterBytes/beforeBytes)*1_000)/10 });
      expect(request).not.toHaveProperty("p_checkpoint");
      expect(afterBytes).toBeLessThan(beforeBytes*.6);
    }
    console.info("WP_NARVA_10B15_PUBLICATION_SIZE_PROFILE", JSON.stringify(profile));
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
