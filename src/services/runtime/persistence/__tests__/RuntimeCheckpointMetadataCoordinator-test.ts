import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { parseRuntimeCheckpointMetadata, RuntimeCheckpointMetadataCoordinator, type RuntimeCheckpointMetadata } from "../RuntimeCheckpointMetadataCoordinator";

type Checkpoint = RuntimeCheckpointEnvelope<SharedExerciseState>;
const metadata = (revision: number, hash = `H${revision}`): RuntimeCheckpointMetadata => Object.freeze({
  exerciseId: "EX-1", checkpointRevision: revision, payloadHash: hash,
  provenanceHash: "P", writerInstanceId: "WRITER-2",
});
const checkpoint = (revision: number, hash = `H${revision}`): Checkpoint => ({
  exerciseId: "EX-1", checkpointRevision: revision, payloadHash: hash,
  provenanceHash: "P", persistedRuntimeVersion: 1, payload: {},
}) as Checkpoint;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe("WP-EGRESS-01 conditional checkpoint fetch coordination", () => {
  test("current metadata causes no payload fetch", async () => {
    const loadLatest = jest.fn();
    const subject = new RuntimeCheckpointMetadataCoordinator({ exerciseId: "EX-1", current: () => checkpoint(4), loadLatest, accept: jest.fn() });
    await subject.notify(metadata(4));
    expect(loadLatest).not.toHaveBeenCalled();
  });

  test("a newer revision causes exactly one full payload fetch", async () => {
    let current = checkpoint(4); const accept = jest.fn((value: Checkpoint) => { current = value; });
    const loadLatest = jest.fn(async () => checkpoint(5));
    const subject = new RuntimeCheckpointMetadataCoordinator({ exerciseId: "EX-1", current: () => current, loadLatest, accept });
    await subject.notify(metadata(5));
    expect(loadLatest).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ checkpointRevision: 5 }), metadata(5));
  });

  test("duplicate metadata while a fetch is active is coalesced", async () => {
    const pending = deferred<Checkpoint>(); const coalesced = jest.fn();
    const loadLatest = jest.fn(() => pending.promise);
    const subject = new RuntimeCheckpointMetadataCoordinator({ exerciseId: "EX-1", current: () => checkpoint(4), loadLatest, accept: jest.fn(), coalesced });
    const first = subject.notify(metadata(5)); const duplicate = subject.notify(metadata(5));
    pending.resolve(checkpoint(5)); await Promise.all([first, duplicate]);
    expect(loadLatest).toHaveBeenCalledTimes(1); expect(coalesced).toHaveBeenCalledTimes(1);
  });

  test("rapidly increasing revisions converge to the highest authoritative checkpoint", async () => {
    const pending = deferred<Checkpoint>(); let current = checkpoint(4); const accepted: number[] = [];
    const loadLatest = jest.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(checkpoint(7));
    const subject = new RuntimeCheckpointMetadataCoordinator({ exerciseId: "EX-1", current: () => current, loadLatest,
      accept: value => { current = value; accepted.push(value.checkpointRevision); } });
    const first = subject.notify(metadata(5)); void subject.notify(metadata(6)); void subject.notify(metadata(7));
    pending.resolve(checkpoint(5)); await first;
    expect(loadLatest).toHaveBeenCalledTimes(2); expect(accepted).toEqual([5, 7]); expect(current.checkpointRevision).toBe(7);
  });

  test("an in-flight fetch that already returns the newest revision avoids an intermediate second download", async () => {
    const pending = deferred<Checkpoint>(); const loadLatest = jest.fn(() => pending.promise);
    const subject = new RuntimeCheckpointMetadataCoordinator({ exerciseId: "EX-1", current: () => checkpoint(4), loadLatest, accept: jest.fn() });
    const first = subject.notify(metadata(5)); void subject.notify(metadata(7)); pending.resolve(checkpoint(7)); await first;
    expect(loadLatest).toHaveBeenCalledTimes(1);
  });

  test("same revision with a different hash is fetched for authoritative conflict resolution", async () => {
    const loadLatest = jest.fn(async () => checkpoint(5, "REMOTE"));
    const subject = new RuntimeCheckpointMetadataCoordinator({ exerciseId: "EX-1", current: () => checkpoint(5, "LOCAL"), loadLatest, accept: jest.fn() });
    await subject.notify(metadata(5, "REMOTE")); expect(loadLatest).toHaveBeenCalledTimes(1);
  });

  test("malformed metadata fails closed without fetching", async () => {
    const ignored = jest.fn(); const loadLatest = jest.fn();
    const subject = new RuntimeCheckpointMetadataCoordinator({ exerciseId: "EX-1", current: () => checkpoint(1), loadLatest, accept: jest.fn(), ignored });
    await subject.notify(parseRuntimeCheckpointMetadata({ exercise_id: "EX-1", checkpoint_revision: 2, payload_hash: "" }));
    expect(loadLatest).not.toHaveBeenCalled(); expect(ignored).toHaveBeenCalledWith("MALFORMED");
  });

  test("parses only the small canonical notification shape", () => {
    expect(parseRuntimeCheckpointMetadata({ exercise_id: "EX-1", checkpoint_revision: 2, payload_hash: "H", provenance_hash: "P", writer_instance_id: "W", updated_at: "2026-08-26T00:00:00Z" }))
      .toEqual({ exerciseId: "EX-1", checkpointRevision: 2, payloadHash: "H", provenanceHash: "P", writerInstanceId: "W", updatedAt: "2026-08-26T00:00:00Z" });
  });

  test("accepts already parsed durable subscription metadata", () => {
    expect(parseRuntimeCheckpointMetadata(metadata(2, "H"))).toEqual(metadata(2, "H"));
  });
});
