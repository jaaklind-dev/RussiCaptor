import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { RuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";
import { publishRuntimeCheckpointTerminal, reconcileRuntimeCheckpointPublication } from "../RuntimeCheckpointPublicationService";
import { RuntimeCheckpointDeltaBuildCancelledError } from "../RuntimeCheckpointDeltaService";

const lease = { exerciseId: "EX", writerInstanceId: "W" } as RuntimeWriterLease;
const checkpoint = { exerciseId: "EX", checkpointRevision: 11, payloadHash: "H11", provenanceHash: "P11" } as RuntimeCheckpointEnvelope<SharedExerciseState>;
const older = { exerciseId: "EX", checkpointRevision: 10, payloadHash: "H10", provenanceHash: "P10" } as RuntimeCheckpointEnvelope<SharedExerciseState>;
const never = new Promise<never>(() => {});

function repository(remote: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined): RuntimeCheckpointRepository {
  return {
    publish: () => never,
    loadLatest: async () => remote,
    loadDeltas: async () => [],
    loadDeltaMetadata: async () => [],
    loadLatestMetadata: async () => remote ? ({
      exerciseId: remote.exerciseId, checkpointRevision: remote.checkpointRevision,
      payloadHash: remote.payloadHash, provenanceHash: remote.provenanceHash, writerInstanceId: "W",
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
    const advanced = { ...checkpoint, checkpointRevision: 12, payloadHash: "OTHER", provenanceHash: "OTHER-P" };
    const otherWriter = { ...repository(advanced), loadLatestMetadata: async () => ({
      exerciseId: "EX", checkpointRevision: 12, payloadHash: "OTHER", provenanceHash: "OTHER-P", writerInstanceId: "OTHER",
    }) } as RuntimeCheckpointRepository;
    await expect(publishRuntimeCheckpointTerminal(otherWriter, lease, 10, checkpoint, 2))
      .resolves.toEqual({ state: "REVISION_CONFLICT", code: "CHECKPOINT_REVISION_CONFLICT" });
  });
  test("same revision with a different hash remains a conflict", () => {
    expect(reconcileRuntimeCheckpointPublication({ exerciseId:"EX", checkpointRevision:11,
      payloadHash:"OTHER", provenanceHash:"P11", writerInstanceId:"W" }, lease, 10, checkpoint))
      .toEqual({ state:"REVISION_CONFLICT", code:"CHECKPOINT_REVISION_CONFLICT" });
  });
  test("same revision, hashes, and writer reconciles the lost response", () => {
    expect(reconcileRuntimeCheckpointPublication({ exerciseId:"EX", checkpointRevision:11,
      payloadHash:"H11", provenanceHash:"P11", writerInstanceId:"W" }, lease, 10, checkpoint))
      .toEqual({ state:"PUBLISHED", checkpoint, reconciled:true });
  });
  test("higher revision on the same writer lineage reconciles forward", () => {
    expect(reconcileRuntimeCheckpointPublication({ exerciseId:"EX", checkpointRevision:12,
      payloadHash:"H12", provenanceHash:"P12", writerInstanceId:"W" }, lease, 10, checkpoint))
      .toEqual({ state:"RECONCILED_FORWARD", checkpointRevision:12, payloadHash:"H12",
        provenanceHash:"P12", code:"CHECKPOINT_PUBLICATION_RECONCILED_FORWARD" });
  });
  test("a later local retry advances over the same writer's lost committed revision", () => {
    const retry = { ...checkpoint, checkpointRevision:402, payloadHash:"H402", provenanceHash:"P402" };
    expect(reconcileRuntimeCheckpointPublication({ exerciseId:"EX", checkpointRevision:399,
      payloadHash:"H399", provenanceHash:"P399", writerInstanceId:"W" }, lease, 398, retry))
      .toEqual({ state:"RECONCILED_FORWARD", checkpointRevision:399, payloadHash:"H399",
        provenanceHash:"P399", code:"CHECKPOINT_PUBLICATION_RECONCILED_FORWARD" });
  });
  test("revision-conflict response reconciles prior same-writer forward progress", async () => {
    const advanced = { ...checkpoint, checkpointRevision: 12, payloadHash: "H12", provenanceHash: "P12" };
    const conflicted = { ...repository(advanced), publish: async () => ({ status:"REVISION_CONFLICT" as const,
      code:"CHECKPOINT_REVISION_CONFLICT" as const }) } as RuntimeCheckpointRepository;
    await expect(publishRuntimeCheckpointTerminal(conflicted, lease, 10, checkpoint, 20))
      .resolves.toEqual({ state:"RECONCILED_FORWARD", checkpointRevision:12, payloadHash:"H12",
        provenanceHash:"P12", code:"CHECKPOINT_PUBLICATION_RECONCILED_FORWARD" });
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
