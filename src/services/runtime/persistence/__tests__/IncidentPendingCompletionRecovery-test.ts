import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { RuntimeCompletionRequest } from "@/models/RuntimeCompletion";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { RuntimeCheckpointRecoveryCoordinator } from "@/services/RuntimeCheckpointSyncService";
import { RuntimeCompletionFinalizerResumeCoordinator } from "@/services/runtime/exercise/RuntimeCompletionFinalizerResumeCoordinator";
import { SupabaseRuntimeCompletionGateway } from "@/services/runtime/exercise/RuntimeCompletionService";
import { handleExerciseControlCommand, resetExerciseControlCommandHandler } from "@/services/runtime/exercise/ExerciseControlCommandHandler";
import { RuntimeExerciseOwnerGeneration } from "@/services/runtime/exercise/RuntimeExerciseOwnerGeneration";
import { clearExerciseRuntimeOwner } from "@/services/runtime/exercise/ExerciseRuntimeOwnerRegistry";
import { stopClockRunner } from "@/services/ClockRunner";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { createRuntimeCheckpoint, getRuntimeCheckpointCanonicalRepresentation, localRuntimeCheckpointStore } from "../RuntimeCheckpointAuthorityService";
import { SupabaseRuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";
import { setRuntimeWriterAuthorityState } from "../RuntimeWriterAuthorityState";

// Synthetic in-memory transport fixture, never a connection to production.
// Real recovery, owner, completion handler, checkpoint and RPC adapters execute.
// SQL transactional behavior is modelled here, not claimed as new real-DB proof.
const exerciseId = "EX-1792248579668-1";
const commandId = "EXCON-1792250118376-2";
const userId = "ISOLATED-OPERATOR";
function runningState(): SharedExerciseState {
  const runtime = { simulationTimeSec: 963 };
  return { exerciseSession: { exerciseId, lifecycleState: "RUNNING", version: 2, speed: 1, simulationTimeSec: 963 },
    patients: [{ id: "PT-001", name: "Synthetic" }], assignments: [], transfers: [], questions: [], labs: [],
    imagingStudies: [], orders: [], notes: [], scenarioEvents: [], timelineEvents: [{ id: "PRESERVED-FIXTURE-EVIDENCE" }],
    persistedRuntimeStates: [{ schemaVersion: 1, provenance: { exerciseId, patientId: "PT-001", packageId: "FIXTURE",
      packageVersion: "1", packageHash: "fixture", definitionHash: "fixture", moduleCompositionHash: "fixture" },
      capturedAtSimulationTimeSec: 963, payload: runtime, payloadHash: sha256Text(stableJson(runtime)) }],
  } as unknown as SharedExerciseState;
}

class IncidentFixture {
  checkpoint = createRuntimeCheckpoint(runningState(), 799);
  projectionRevision = 17;
  lifecycle = "RUNNING";
  generation = 1;
  lease: RuntimeWriterLease | undefined;
  ownerCount = 0;
  commits = 0;
  expired = false;
  interrupt = false;
  loseResponse = false;
  request: RuntimeCompletionRequest = { exerciseId, commandId, requestedBy: userId,
    expectedExerciseVersion: 2, fenceCommandSequence: 0, status: "PENDING" };
  readonly rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
    const fail = (message: string) => ({ data: null, error: { message } });
    if (name === "acquire_runtime_writer") {
      if (this.lease) return fail("WRITER_AUTHORITY_HELD");
      if (args.p_expected_revision !== this.checkpoint.checkpointRevision) return fail("CHECKPOINT_REVISION_CONFLICT");
      this.generation++;
      this.lease = { exerciseId, leaseId: `LEASE-${this.generation}`, writerInstanceId: String(args.p_writer_instance_id),
        userId, expiresAt: "2099-01-01T00:00:00Z", writerGeneration: this.generation };
      return { data: { lease_id: this.lease.leaseId, user_id: userId, expires_at: this.lease.expiresAt,
        writer_generation: this.generation, checkpoint_revision: this.checkpoint.checkpointRevision }, error: null };
    }
    if (name === "release_runtime_writer") { this.lease = undefined; return { data: null, error: null }; }
    if (name !== "finalize_runtime_completion_canonical_payload") throw new Error(`Unexpected RPC ${name}`);
    if (args.p_command_id !== this.request.commandId) return fail("COMPLETION_REQUEST_NOT_FOUND");
    if (this.request.status !== "COMPLETED") {
      if (!this.lease || this.expired || args.p_lease_id !== this.lease.leaseId ||
        args.p_writer_instance_id !== this.lease.writerInstanceId) return fail("STALE_WRITER");
      if (args.p_expected_checkpoint_revision !== this.checkpoint.checkpointRevision) return fail("CHECKPOINT_REVISION_CONFLICT");
      const payload = JSON.parse(String(args.p_canonical_payload_text));
      if (payload.exerciseSession.lifecycleState !== "COMPLETED" || this.ownerCount !== 0 ||
        sha256Text(String(args.p_canonical_payload_text)) !== args.p_payload_hash) return fail("TERMINAL_CHECKPOINT_INVALID");
      if (this.interrupt) return fail("NETWORK_UNAVAILABLE");
      this.checkpoint = createRuntimeCheckpoint(payload, Number(args.p_checkpoint_revision));
      this.projectionRevision++;
      this.lifecycle = "COMPLETED";
      this.request = { ...this.request, status: "COMPLETED", terminalCheckpointRevision: this.checkpoint.checkpointRevision,
        terminalPayloadHash: this.checkpoint.payloadHash };
      this.lease = undefined;
      this.commits++;
      if (this.loseResponse) { this.loseResponse = false; return fail("NETWORK_RESPONSE_LOST"); }
    }
    return { data: { checkpoint_revision: this.checkpoint.checkpointRevision, payload_hash: this.checkpoint.payloadHash,
      provenance_hash: this.checkpoint.provenanceHash }, error: null };
  });
  readonly client = { rpc: this.rpc, from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
    if (table === "runtime_completion_requests") return { data: { exercise_id: exerciseId, command_id: this.request.commandId,
      requested_by: userId, expected_exercise_version: 2, fence_command_sequence: 0, status: this.request.status,
      terminal_checkpoint_revision: this.request.terminalCheckpointRevision, terminal_payload_hash: this.request.terminalPayloadHash }, error: null };
    if (table === "runtime_checkpoint_notifications") return { data: { exercise_id: exerciseId,
      checkpoint_revision: this.checkpoint.checkpointRevision, payload_hash: this.checkpoint.payloadHash,
      provenance_hash: this.checkpoint.provenanceHash, checkpoint_bytes: 1000 }, error: null };
    if (table === "runtime_checkpoint_canonical_artifacts") {
      const c = getRuntimeCheckpointCanonicalRepresentation(this.checkpoint)!;
      return { data: { exercise_id: exerciseId, checkpoint_revision: c.checkpointRevision,
        canonical_format_version: c.canonicalFormatVersion, persisted_runtime_version: c.persistedRuntimeVersion,
        payload_hash: c.payloadHash, provenance_hash: c.provenanceHash, canonical_payload_text: c.canonicalPayloadText,
        derivation_method: c.derivationMethod }, error: null };
    }
    throw new Error(`Unexpected read ${table}`);
  } }) }) }) };
  readonly repository = new SupabaseRuntimeCheckpointRepository(this.client as never);
  readonly completion = new SupabaseRuntimeCompletionGateway(this.client as never);
  restored: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
  async restore(writer = "RECOVERED-WRITER", failAdopt = false) {
    return new RuntimeCheckpointRecoveryCoordinator().recover({ intentId: "INCIDENT-RECOVERY", exerciseId,
      writerInstanceId: writer, repository: this.repository,
      acquire: revision => this.repository.acquireWriter(exerciseId, writer, revision, 60),
      adopt: async checkpoint => {
        if (failAdopt) throw new Error("INTERRUPTED");
        await localRuntimeCheckpointStore.restoreAsync(checkpoint, async () => undefined);
        this.restored = checkpoint;
        replaceCanonicalExerciseSnapshot(checkpoint.payload.exerciseSession as never);
      } });
  }
  terminal() {
    setRuntimeWriterAuthorityState("WRITER");
    const owner = new RuntimeExerciseOwnerGeneration(exerciseId, () => true);
    expect(owner.establish()).toBe(true);
    const applied = handleExerciseControlCommand({ exerciseId, commandId: this.request.commandId,
      commandType: "COMPLETE_EXERCISE", issuedBy: "Exercise Controller", issuedAtWallClock: "2026-10-17T00:00:00Z",
      expectedVersion: getCanonicalExerciseSnapshot().version });
    expect(applied.ok).toBe(true);
    return createRuntimeCheckpoint({ ...this.restored!.payload, exerciseSession: getCanonicalExerciseSnapshot() }, 800);
  }
}

describe("isolated revision-17/checkpoint-799 pending completion recovery", () => {
  afterEach(() => { stopClockRunner(); clearExerciseRuntimeOwner(); resetExerciseControlCommandHandler();
    localRuntimeCheckpointStore.restore(undefined); setRuntimeWriterAuthorityState("UNRESOLVED"); });
  test("real recovery adapters and finalizer resume reuse the original command and commit once", async () => {
    const f = new IncidentFixture();
    const request = (await f.completion.load(exerciseId))!;
    let ready = false;
    const coordinator = new RuntimeCompletionFinalizerResumeCoordinator({ exerciseId, generation: "RESTORED",
      isCurrent: () => true, isWriterReady: () => ready, dispatch: async pending => {
        const terminal = f.terminal();
        expect(await f.repository.finalizeCompletion(pending.commandId, f.lease!, 799, terminal)).toMatchObject({ status: "PUBLISHED" });
        coordinator.completed(pending.commandId);
      } });
    expect(await coordinator.observe(request)).toBe("DEFERRED_WRITER_NOT_READY");
    expect(await f.restore()).toMatchObject({ state: "RECOVERED", checkpoint: { checkpointRevision: 799 } });
    expect(f.generation).toBe(2);
    expect(f.restored?.payloadHash).toBe(f.checkpoint.payloadHash);
    ready = true;
    await Promise.all([coordinator.writerReady(), coordinator.wake("APP_FOREGROUND")]);
    expect(f.lifecycle).toBe("COMPLETED"); expect(f.projectionRevision).toBe(18);
    expect(f.request).toMatchObject({ status: "COMPLETED", commandId, terminalCheckpointRevision: 800 });
    expect(f.lease).toBeUndefined(); expect(f.ownerCount).toBe(0); expect(f.commits).toBe(1);
    expect(f.checkpoint.payload.timelineEvents).toEqual([{ id: "PRESERVED-FIXTURE-EVIDENCE" }]);
    expect(f.checkpoint.payload.patients).toEqual(f.restored!.payload.patients);
    expect(f.checkpoint.payload.persistedRuntimeStates).toEqual(f.restored!.payload.persistedRuntimeStates);
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(["acquire_runtime_writer", "finalize_runtime_completion_canonical_payload"]);
    expect(f.rpc.mock.calls[1][1]).toMatchObject({ p_command_id: commandId, p_expected_checkpoint_revision: 799 });
    expect(f.rpc.mock.calls[1][1]).not.toHaveProperty("p_checkpoint");
    expect(await coordinator.observe((await f.completion.load(exerciseId))!)).toBe("NO_PENDING_REQUEST");
  });
  test.each(["stale lease", "expired lease", "CAS conflict"])("%s fails closed without terminal writes", async failure => {
    const f = new IncidentFixture(); await f.restore(); const lease = f.lease!; const terminal = f.terminal();
    const supplied = failure === "stale lease" ? { ...lease, leaseId: "OLD-GENERATION-1" } : lease;
    f.expired = failure === "expired lease";
    const result = await f.repository.finalizeCompletion(commandId, supplied, failure === "CAS conflict" ? 798 : 799, terminal);
    expect(result.status).toBe(failure === "CAS conflict" ? "REVISION_CONFLICT" : "STALE_CHECKPOINT_WRITER");
    expect(f.request.status).toBe("PENDING"); expect(f.projectionRevision).toBe(17); expect(f.commits).toBe(0);
  });
  test("interrupted adoption releases acquired authority and preserves the pending request", async () => {
    const f = new IncidentFixture();
    expect(await f.restore("INTERRUPTED", true)).toMatchObject({ state: "REJECTED" });
    expect(f.lease).toBeUndefined(); expect(f.request.status).toBe("PENDING"); expect(f.commits).toBe(0);
    expect(await f.restore("RESTARTED")).toMatchObject({ state: "RECOVERED" });
  });
  test("interrupted finalization preserves CAS state and identical retry commits once", async () => {
    const f = new IncidentFixture(); await f.restore(); const lease = f.lease!; const terminal = f.terminal();
    f.interrupt = true;
    expect((await f.repository.finalizeCompletion(commandId, lease, 799, terminal)).status).toBe("AUTHORITY_UNAVAILABLE");
    expect(f.projectionRevision).toBe(17); expect(f.request.status).toBe("PENDING");
    f.interrupt = false;
    expect((await f.repository.finalizeCompletion(commandId, lease, 799, terminal)).status).toBe("PUBLISHED");
    expect((await f.repository.finalizeCompletion(commandId, lease, 799, terminal)).status).toBe("PUBLISHED");
    expect(f.commits).toBe(1); expect(f.lease).toBeUndefined();
  });
  test("lost finalization response reconciles completed original request without duplicate creation", async () => {
    const f = new IncidentFixture(); await f.restore(); const lease = f.lease!; const terminal = f.terminal();
    f.loseResponse = true;
    await f.repository.finalizeCompletion(commandId, lease, 799, terminal);
    expect(await f.completion.load(exerciseId)).toMatchObject({ commandId, status: "COMPLETED" });
    await f.repository.finalizeCompletion(commandId, lease, 799, terminal);
    expect(f.commits).toBe(1);
    expect(f.rpc.mock.calls.some(call => call[0] === "submit_runtime_completion_request")).toBe(false);
  });
  test("concurrent legitimate acquisition has only one winner", async () => {
    const f = new IncidentFixture();
    const results = await Promise.all([f.repository.acquireWriter(exerciseId, "A", 799, 60),
      f.repository.acquireWriter(exerciseId, "B", 799, 60)]);
    expect(results.map(r => r.status).sort()).toEqual(["ACQUIRED", "HELD_BY_OTHER_WRITER"]);
    expect(f.generation).toBe(2); expect(f.commits).toBe(0);
  });
  test("process recreation after local completion restores remote RUNNING then resumes the original request", async () => {
    const f = new IncidentFixture(); await f.restore();
    f.terminal(); // Local terminal state was never committed remotely.
    expect(f.request.status).toBe("PENDING"); expect(f.checkpoint.checkpointRevision).toBe(799);
    f.lease = undefined; // Model released authority after process loss.
    clearExerciseRuntimeOwner(); resetExerciseControlCommandHandler();
    localRuntimeCheckpointStore.restore(undefined); setRuntimeWriterAuthorityState("UNRESOLVED");
    expect(await f.restore("RESTARTED-WRITER")).toMatchObject({ state: "RECOVERED" });
    expect(getCanonicalExerciseSnapshot().lifecycleState).toBe("RUNNING");
    const terminal = f.terminal();
    await f.repository.finalizeCompletion(f.request.commandId, f.lease!, 799, terminal);
    expect(f.request).toMatchObject({ commandId, status: "COMPLETED" });
    expect(f.commits).toBe(1); expect(f.generation).toBe(3); expect(f.lease).toBeUndefined();
  });
});
