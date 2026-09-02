import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { RuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";
import { publishRuntimeCheckpointTerminal } from "../RuntimeCheckpointPublicationService";
import { RuntimeCheckpointDeltaBuildCancelledError } from "../RuntimeCheckpointDeltaService";

const lease = { exerciseId: "EX", writerInstanceId: "W" } as RuntimeWriterLease;
const checkpoint = { exerciseId: "EX", checkpointRevision: 11, payloadHash: "H11" } as RuntimeCheckpointEnvelope<SharedExerciseState>;
const older = { exerciseId: "EX", checkpointRevision: 10, payloadHash: "H10" } as RuntimeCheckpointEnvelope<SharedExerciseState>;
const never = new Promise<never>(() => {});

function repository(remote: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined): RuntimeCheckpointRepository {
  return {
    publish: () => never,
    loadLatest: async () => remote,
    loadDeltas: async () => [],
    loadDeltaMetadata: async () => [],
    loadLatestMetadata: async () => remote ? ({
      exerciseId: remote.exerciseId, checkpointRevision: remote.checkpointRevision,
      payloadHash: remote.payloadHash, provenanceHash: "P", writerInstanceId: "W",
    }) : undefined,
    acquireWriter: jest.fn(), renewWriter: jest.fn(), releaseWriter: jest.fn(),
  } as RuntimeCheckpointRepository;
}

describe("WP-44B terminal checkpoint publication", () => {
  test("lost response plus committed expected checkpoint reconciles as published", async () => {
    await expect(publishRuntimeCheckpointTerminal(repository(checkpoint), lease, 10, checkpoint, 2))
      .resolves.toEqual({ state: "PUBLISHED", checkpoint, reconciled: true });
  });
  test("lost response without backend commit terminates as uncertain timeout", async () => {
    await expect(publishRuntimeCheckpointTerminal(repository(older), lease, 10, checkpoint, 2))
      .resolves.toEqual({ state: "TRANSPORT_TIMEOUT", code: "CHECKPOINT_PUBLICATION_UNCERTAIN" });
  });
  test("another writer advancing remote state terminates as revision conflict", async () => {
    const advanced = { ...checkpoint, checkpointRevision: 12, payloadHash: "OTHER" };
    await expect(publishRuntimeCheckpointTerminal(repository(advanced), lease, 10, checkpoint, 2))
      .resolves.toEqual({ state: "REVISION_CONFLICT", code: "CHECKPOINT_REVISION_CONFLICT" });
  });
  test("hanging RPC and hanging reconciliation still terminate", async () => {
    const hanging = { ...repository(undefined), loadLatestMetadata: () => never } as RuntimeCheckpointRepository;
    await expect(publishRuntimeCheckpointTerminal(hanging, lease, 10, checkpoint, 2))
      .resolves.toEqual({ state: "TRANSPORT_TIMEOUT", code: "CHECKPOINT_RECONCILIATION_TIMEOUT" });
  });
  test("RPC success does not depend on Realtime", async () => {
    const direct = { ...repository(undefined), publish: async () => ({ status: "PUBLISHED" as const, checkpoint }) } as RuntimeCheckpointRepository;
    await expect(publishRuntimeCheckpointTerminal(direct, lease, 10, checkpoint, 2))
      .resolves.toEqual({ state: "PUBLISHED", checkpoint, reconciled: false });
  });
  test("pre-RPC cooperative cancellation returns the existing stopped terminal without reconciliation", async () => {
    const cancelled = {
      ...repository(undefined),
      publish: jest.fn(async () => { throw new RuntimeCheckpointDeltaBuildCancelledError(); }),
      loadLatestMetadata: jest.fn(),
    } as unknown as RuntimeCheckpointRepository;
    await expect(publishRuntimeCheckpointTerminal(cancelled, lease, 10, checkpoint, 2, undefined, {
      priority: "ROUTINE", yieldControl: async () => undefined, shouldContinue: () => false,
    })).resolves.toEqual({ state: "GENERATION_STOPPED", code: "GENERATION_STOPPED" });
    expect(cancelled.loadLatestMetadata).not.toHaveBeenCalled();
  });
  test("transport timeout starts only after cooperative local preparation submits the RPC", async () => {
    const preparedThenPublished = {
      ...repository(undefined),
      publish: jest.fn(async (_lease, _revision, _checkpoint, _base, control) => {
        await new Promise(resolve => setTimeout(resolve, 12));
        control?.onRpcSubmitted?.();
        return { status: "PUBLISHED" as const, checkpoint };
      }),
    } as unknown as RuntimeCheckpointRepository;
    await expect(publishRuntimeCheckpointTerminal(preparedThenPublished, lease, 10, checkpoint, 2, undefined, {
      priority: "ROUTINE", yieldControl: async () => undefined, shouldContinue: () => true,
    })).resolves.toEqual({ state: "PUBLISHED", checkpoint, reconciled: false });
  });
});
