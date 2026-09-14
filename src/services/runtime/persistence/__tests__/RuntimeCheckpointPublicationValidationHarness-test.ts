import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { InMemoryRuntimePatientCommandGateway } from "@/services/runtime/commands/InMemoryRuntimePatientCommandGateway";
import { resetRuntimePatientCommandCursor } from "@/services/runtime/commands/RuntimePatientCommandCursor";
import { RuntimePatientCommandConsumer } from "@/services/runtime/commands/RuntimePatientCommandService";
import { publishRuntimeCheckpointTerminal } from "../RuntimeCheckpointPublicationService";
import {
  armNextRuntimeCheckpointPublicationLostResponseForValidation,
  clearRuntimeCheckpointPublicationLostResponseForValidation,
  interceptRuntimeCheckpointPublicationResponseForValidation,
  isRuntimeCheckpointPublicationLostResponseArmedForValidation,
} from "../RuntimeCheckpointPublicationValidationHarness";
import type { RuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";
import { clearRuntimeLeaseTraceForValidation, getRuntimeLeaseLifecycleTrace } from "../RuntimeLeaseLifecycleTrace";

const lease = Object.freeze({
  leaseId: "LEASE-A",
  exerciseId: "EX-1",
  writerInstanceId: "WRITER-A",
  userId: "EXCON-A",
  expiresAt: "2099-01-01T00:00:00.000Z",
}) satisfies RuntimeWriterLease;

const checkpoint = Object.freeze({
  exerciseId: "EX-1",
  checkpointRevision: 11,
  payloadHash: "HASH-11",
  provenanceHash: "PROVENANCE-11",
}) as RuntimeCheckpointEnvelope<SharedExerciseState>;

describe("validation-only lost checkpoint publication response", () => {
  const environment = {
    releaseEnvironment: process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT,
    enabled: process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS,
  };

  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = "production";
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = "1";
    clearRuntimeCheckpointPublicationLostResponseForValidation();
    clearRuntimeLeaseTraceForValidation();
    resetRuntimePatientCommandCursor();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = environment.releaseEnvironment;
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = environment.enabled;
  });

  test("is unavailable and inert when the validation harness is disabled", async () => {
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = undefined;
    expect(armNextRuntimeCheckpointPublicationLostResponseForValidation("EX-1")).toBe(false);
    const published = { status: "PUBLISHED" as const, checkpoint };
    await expect(interceptRuntimeCheckpointPublicationResponseForValidation(
      Promise.resolve(published), "EX-1",
    )).resolves.toBe(published);
    expect(getRuntimeLeaseLifecycleTrace().map(item => item.event)).not.toEqual(expect.arrayContaining([
      "VALIDATION_PUBLICATION_LOST_RESPONSE_ARMED",
      "VALIDATION_PUBLICATION_LOST_RESPONSE_FIRED",
    ]));
  });

  test("withholds exactly one response only after the real publication commits", async () => {
    let serverCommitted = false;
    expect(armNextRuntimeCheckpointPublicationLostResponseForValidation("EX-1")).toBe(true);
    const first = interceptRuntimeCheckpointPublicationResponseForValidation(
      Promise.resolve().then(() => {
        serverCommitted = true;
        return { status: "PUBLISHED" as const, checkpoint };
      }),
      "EX-1",
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(serverCommitted).toBe(true);
    expect(isRuntimeCheckpointPublicationLostResponseArmedForValidation("EX-1")).toBe(false);
    await expect(Promise.race([
      first.then(() => "RESOLVED"),
      new Promise<string>(resolve => setTimeout(() => resolve("CLIENT_RESPONSE_WITHHELD"), 1)),
    ])).resolves.toBe("CLIENT_RESPONSE_WITHHELD");

    const second = { status: "PUBLISHED" as const, checkpoint };
    await expect(interceptRuntimeCheckpointPublicationResponseForValidation(
      Promise.resolve(second), "EX-1",
    )).resolves.toBe(second);
    expect(getRuntimeLeaseLifecycleTrace().map(item => item.event).filter(event =>
      event.startsWith("VALIDATION_PUBLICATION_LOST_RESPONSE_"))).toEqual([
      "VALIDATION_PUBLICATION_LOST_RESPONSE_ARMED",
      "VALIDATION_PUBLICATION_LOST_RESPONSE_FIRED",
    ]);
  });

  test("does not consume the arm until a successful commit for the selected exercise", async () => {
    expect(armNextRuntimeCheckpointPublicationLostResponseForValidation("EX-1")).toBe(true);
    const rejected = { status: "AUTHORITY_UNAVAILABLE" as const, code: "BACKEND_ERROR" as const };
    await expect(interceptRuntimeCheckpointPublicationResponseForValidation(
      Promise.resolve(rejected), "EX-1",
    )).resolves.toBe(rejected);
    expect(isRuntimeCheckpointPublicationLostResponseArmedForValidation("EX-1")).toBe(true);
  });

  test("drives the real reconciliation path and leaves an accepted command consumable once", async () => {
    let durableCheckpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
    const repository = {
      publish: () => interceptRuntimeCheckpointPublicationResponseForValidation(
        Promise.resolve().then(() => {
          durableCheckpoint = checkpoint;
          return { status: "PUBLISHED" as const, checkpoint };
        }),
        checkpoint.exerciseId,
      ),
      loadLatestMetadata: async () => durableCheckpoint ? ({
        exerciseId: durableCheckpoint.exerciseId,
        checkpointRevision: durableCheckpoint.checkpointRevision,
        payloadHash: durableCheckpoint.payloadHash,
        provenanceHash: durableCheckpoint.provenanceHash,
        writerInstanceId: lease.writerInstanceId,
      }) : undefined,
      loadLatest: async () => durableCheckpoint,
    } as Pick<RuntimeCheckpointRepository, "publish" | "loadLatestMetadata" | "loadLatest">;

    expect(armNextRuntimeCheckpointPublicationLostResponseForValidation("EX-1")).toBe(true);
    await expect(publishRuntimeCheckpointTerminal(repository, lease, 10, checkpoint, 2))
      .resolves.toEqual({ state: "PUBLISHED", checkpoint, reconciled: true });

    const actor = { userId: "CM-A", role: "CM" as const, exerciseIds: ["EX-1"] };
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor);
    gateway.seed("EX-1", "PT-1", "CM-A");
    await gateway.submit({ exerciseId: "EX-1", patientId: "PT-1", commandId: "PARACETAMOL-82",
      commandType: "RESOURCE_APPLY", patientBaseRevision: 0, simulationTimeSec: 1150,
      payload: Object.freeze({ resourceId: "PARACETAMOL" }) });
    const materialize = jest.fn(() => ({ status: "MATERIALIZED" as const, result: { ok: true } }));
    const consumer = new RuntimePatientCommandConsumer(gateway, materialize);
    await consumer.drain("EX-1", lease);
    await consumer.drain("EX-1", lease);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(gateway.materialized(1)).toEqual({ status: "MATERIALIZED", result: { ok: true } });

    const events = getRuntimeLeaseLifecycleTrace().map(item => item.event);
    expect(events).toEqual(expect.arrayContaining([
      "VALIDATION_PUBLICATION_LOST_RESPONSE_FIRED",
      "PUBLICATION_RECONCILE_START",
      "PUBLICATION_RECONCILE_COMMITTED_MATCH",
    ]));
    expect(events).not.toContain("PUBLICATION_AUTHORITY_LOST");
  });
});
