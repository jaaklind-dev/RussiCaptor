import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { RuntimePatientCommandSubmission } from "@/models/RuntimePatientCommand";
import { InMemoryRuntimePatientCommandGateway, type RuntimeCommandActor } from "../InMemoryRuntimePatientCommandGateway";
import { RuntimePatientCommandConsumer } from "../RuntimePatientCommandService";
import { resetRuntimePatientCommandCursor, restoreRuntimePatientCommandCursor } from "../RuntimePatientCommandCursor";

let actor: RuntimeCommandActor;
const command = (patientId: string, commandId: string, revision = 0): RuntimePatientCommandSubmission => Object.freeze({
  exerciseId: "EX-NARVA", patientId, commandId, commandType: "RESOURCE_APPLY", patientBaseRevision: revision,
  simulationTimeSec: 120, payload: Object.freeze({ resourceId: patientId === "PT-A" ? "PB-1" : "CD-1" }),
});
const lease: RuntimeWriterLease = Object.freeze({ leaseId: "LEASE", exerciseId: "EX-NARVA",
  writerInstanceId: "WRITER", userId: "CM-A", expiresAt: "2099-01-01T00:00:00.000Z" });

describe("WP-NARVA-06 patient-scoped Runtime command inbox", () => {
  beforeEach(() => { actor = { userId: "CM-A", role: "CM", exerciseIds: ["EX-NARVA"] }; resetRuntimePatientCommandCursor(); });

  test("two patient owners submit independently while one writer materializes in server order", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor);
    gateway.seed("EX-NARVA", "PT-A", "CM-A"); gateway.seed("EX-NARVA", "PT-B", "CM-B");
    const first = await gateway.submit(command("PT-A", "BINDER"));
    actor = { userId: "CM-B", role: "CM", exerciseIds: ["EX-NARVA"] };
    const second = await gateway.submit(command("PT-B", "DRAIN"));
    expect([first.status, second.status]).toEqual(["APPLIED", "APPLIED"]);
    const applied: string[] = [];
    const consumer = new RuntimePatientCommandConsumer(gateway, item => {
      applied.push(`${item.patientId}:${item.commandId}`);
      return { status: "MATERIALIZED", result: { ok: true } };
    });
    await expect(consumer.drain("EX-NARVA", lease)).resolves.toBe(2);
    expect(applied).toEqual(["PT-A:BINDER", "PT-B:DRAIN"]);
  });

  test("same-patient same-base mutable commands remain CAS-conflict safe", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed("EX-NARVA", "PT-A", "CM-A");
    expect((await gateway.submit(command("PT-A", "FIRST"))).status).toBe("APPLIED");
    expect((await gateway.submit(command("PT-A", "SECOND"))).status).toBe("STALE_VERSION");
  });

  test("former owner is rejected after transfer and new owner succeeds", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed("EX-NARVA", "PT-B", "CM-B", 2);
    gateway.transfer("EX-NARVA", "PT-B", "CM-A");
    actor = { userId: "CM-B", role: "CM", exerciseIds: ["EX-NARVA"] };
    expect((await gateway.submit(command("PT-B", "STALE", 3))).status).toBe("NOT_OWNER");
    actor = { userId: "CM-A", role: "CM", exerciseIds: ["EX-NARVA"] };
    expect((await gateway.submit(command("PT-B", "VALID", 3))).status).toBe("APPLIED");
  });

  test("durable command survives writer absence and replay is exactly once by command id", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed("EX-NARVA", "PT-A", "CM-A");
    const request = command("PT-A", "DURABLE");
    const first = await gateway.submit(request); const duplicate = await gateway.submit(request);
    expect([first.status, duplicate.status]).toEqual(["APPLIED", "IDEMPOTENT"]);
    const effects = new Set<string>();
    const consumer = new RuntimePatientCommandConsumer(gateway, item => {
      effects.add(item.commandId); return { status: "MATERIALIZED", result: { ok: true } };
    });
    await consumer.drain("EX-NARVA", lease);
    restoreRuntimePatientCommandCursor("EX-NARVA", 0);
    await consumer.drain("EX-NARVA", lease);
    expect(effects).toEqual(new Set(["DURABLE"]));
  });

  test("non-writer transport survives writer absence and materializes once after takeover", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed("EX-NARVA", "PT-A", "CM-A");
    const transport: RuntimePatientCommandSubmission = Object.freeze({ ...command("PT-A", "TRANSPORT-1"),
      commandType: "TRANSPORT_START", payload: Object.freeze({ resourceId: "REANIMOBILE-1", destinationId: "IVKH" }) });
    expect((await gateway.submit(transport)).status).toBe("APPLIED");
    expect(gateway.materialized(1)).toBeUndefined();
    const effects = new Set<string>();
    const consumer = new RuntimePatientCommandConsumer(gateway, item => {
      effects.add(item.commandId); return { status: "MATERIALIZED", result: { ok: true } };
    });
    await consumer.drain("EX-NARVA", lease);
    restoreRuntimePatientCommandCursor("EX-NARVA", 0);
    await consumer.drain("EX-NARVA", lease);
    expect(effects).toEqual(new Set(["TRANSPORT-1"]));
    expect(gateway.materialized(1)).toEqual({ status: "MATERIALIZED", result: { ok: true } });
  });

  test("completion fence rejects later clinical commands", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed("EX-NARVA", "PT-A", "CM-A");
    gateway.fence("EX-NARVA");
    expect((await gateway.submit(command("PT-A", "TOO-LATE"))).status).toBe("COMPLETION_FENCED");
    expect(gateway.accepted()).toHaveLength(0);
  });

  test("completion drains every command accepted before its fence in deterministic order", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor);
    gateway.seed("EX-NARVA", "PT-A", "CM-A"); gateway.seed("EX-NARVA", "PT-B", "CM-A");
    await gateway.submit(command("PT-A", "BEFORE-1"));
    await gateway.submit(command("PT-B", "BEFORE-2"));
    gateway.fence("EX-NARVA");
    const materialized: string[] = [];
    const consumer = new RuntimePatientCommandConsumer(gateway, item => {
      materialized.push(item.commandId); return { status: "MATERIALIZED", result: { ok: true } };
    });
    await expect(consumer.drain("EX-NARVA", lease, 2)).resolves.toBe(2);
    expect(materialized).toEqual(["BEFORE-1", "BEFORE-2"]);
  });
});
