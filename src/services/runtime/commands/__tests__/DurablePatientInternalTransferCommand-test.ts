import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { RuntimePatientCommandSubmission } from "@/models/RuntimePatientCommand";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataProvider } from "@/providers/ProviderFactory";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import { resetExercise } from "@/services/ExerciseResetService";
import { DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { clearPatientTransportRuntime, getPatientTransportSnapshot, preparePatientTransportRuntime } from
  "@/services/runtime/exercise/PatientTransportRuntimeService";
import { getAvailablePatientInternalTransfers, materializePatientInternalTransfer,
  materializePatientInternalTransferAuthoritatively } from
  "@/services/runtime/exercise/PatientInternalTransferService";
import { capturePatientSharedWorkflowState } from "@/services/sharedWorkflow/PatientSharedWorkflowState";
import { InMemorySharedWorkflowGateway } from "@/services/sharedWorkflow/InMemorySharedWorkflowGateway";
import { observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics, setSharedWorkflowConnectivity,
  setSharedWorkflowGateway } from "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { InMemoryRuntimePatientCommandGateway, type RuntimeCommandActor } from
  "../InMemoryRuntimePatientCommandGateway";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { RuntimePatientCommandConsumer } from "../RuntimePatientCommandService";
import { resetRuntimePatientCommandCursor, restoreRuntimePatientCommandCursor } from
  "../RuntimePatientCommandCursor";

const exerciseId = "demo";
const pelvicId = "PT-PELVIC-001";
const chestId = "PT-CHEST-001";
const lease: RuntimeWriterLease = Object.freeze({ leaseId: "LEASE", exerciseId,
  writerInstanceId: "WRITER", userId: "EXCON", expiresAt: "2099-01-01T00:00:00.000Z" });
let actor: RuntimeCommandActor;
const patient = (id: string, location: string) => ({ id, isikukood: id, name: id, triage: "P1" as const,
  status: "Active" as const, location, lastSeen: "T+0", mist: { mechanism: "Trauma", injuries: "",
    signs: "", treatment: "" } });
const command = (commandId = "MOVE-1", patientId = pelvicId): RuntimePatientCommandSubmission => Object.freeze({
  exerciseId, patientId, commandId, commandType: "PATIENT_LOCATION_TRANSFER", patientBaseRevision: 0,
  simulationTimeSec: 120, payload: Object.freeze({ actionId: "P01-MOVE-ED" }),
});

describe("NARVA-P01-INTERNAL-TRANSFER-01 / LOC-G01", () => {
  beforeEach(() => {
    resetExercise(); resetRuntimePatientCommandCursor();
    exercisePackageLoader.unbind(exerciseId);
    exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    dataProvider.installPatients([patient(pelvicId, "NARVA_HOSPITAL_OUTDOOR"), patient(chestId, "NARVA_ED")]);
    preparePatientTransportRuntime(exerciseId);
    actor = { userId: "CM", role: "CM", exerciseIds: [exerciseId] };
  });
  afterEach(() => {
    setSharedWorkflowGateway(undefined); setSharedWorkflowConnectivity(false); resetSharedWorkflowConflictMetrics();
    clearPatientTransportRuntime(); resetRuntimePatientCommandCursor(); resetExercise();
    exercisePackageLoader.unbind(exerciseId);
    exercisePackageLoader.bind(exerciseId, DEFAULT_EXERCISE_PACKAGE);
  });

  test("P01 alone receives the package-owned source action while outdoors", () => {
    expect(getAvailablePatientInternalTransfers(exerciseId, pelvicId)).toEqual([
      expect.objectContaining({ actionId: "P01-MOVE-ED", fromLocationId: "NARVA_HOSPITAL_OUTDOOR",
        toLocationId: "NARVA_ED", displayName: "Ohutu transport õuest EMOsse" }),
    ]);
    expect(getAvailablePatientInternalTransfers(exerciseId, chestId)).toEqual([]);
  });

  test("writer materializes one canonical location change and evidence without transport mutation", () => {
    const before = getPatientTransportSnapshot()!;
    expect(materializePatientInternalTransfer("MOVE-1", pelvicId, "P01-MOVE-ED", 120, "CM"))
      .toEqual({ ok: true, status: "TRANSFERRED", actionId: "P01-MOVE-ED", locationId: "NARVA_ED" });
    expect(dataProvider.getPatientById(pelvicId)?.location).toBe("NARVA_ED");
    expect(getAvailablePatientInternalTransfers(exerciseId, pelvicId)).toEqual([]);
    expect(getTimelineEvents(pelvicId).filter(item => item.title === "P01-MOVE-ED")).toEqual([
      expect.objectContaining({ id: "TL-INTERNAL-TRANSFER-MOVE-1", simulationTimeSec: 120, authorId: "CM" }),
    ]);
    const after = getPatientTransportSnapshot()!;
    expect(after.patientLocations[pelvicId]).toBe("NARVA_ED");
    expect(after.transports).toEqual(before.transports);
    expect(after.resources).toEqual(before.resources);
    expect(after.evidence).toEqual(before.evidence);
    expect(materializePatientInternalTransfer("MOVE-1", pelvicId, "P01-MOVE-ED", 120, "CM"))
      .toEqual({ ok: true, status: "IDEMPOTENT", actionId: "P01-MOVE-ED", locationId: "NARVA_ED" });
    expect(getTimelineEvents(pelvicId).filter(item => item.title === "P01-MOVE-ED")).toHaveLength(1);
  });

  test("wrong patient and wrong origin fail closed", () => {
    expect(materializePatientInternalTransfer("WRONG", chestId, "P01-MOVE-ED", 120, "CM"))
      .toMatchObject({ ok: false, reason: "INTERNAL_TRANSFER_NOT_ALLOWED" });
    dataProvider.setPatientLocation(pelvicId, "NARVA_ED");
    expect(materializePatientInternalTransfer("WRONG-ORIGIN", pelvicId, "P01-MOVE-ED", 120, "CM"))
      .toMatchObject({ ok: false, reason: "INTERNAL_TRANSFER_ALREADY_COMPLETED" });
  });

  test("workflow reflection failure rolls the transfer proposal back before checkpoint publication", async () => {
    setSharedWorkflowConnectivity(false);
    await expect(materializePatientInternalTransferAuthoritatively({ commandId: "REFLECTION-OFFLINE",
      exerciseId, patientId: pelvicId, actionId: "P01-MOVE-ED", simulationTimeSec: 120,
      actorUserId: "CM", acceptedPatientRevision: 1 })).resolves.toMatchObject({
      ok: false, reason: "CANONICAL_WORKFLOW_REFLECTION_FAILED", ownershipStatus: "RECONNECT_REQUIRED",
    });
    expect(dataProvider.getPatientById(pelvicId)?.location).toBe("NARVA_HOSPITAL_OUTDOOR");
    expect(getTimelineEvents(pelvicId).filter(item => item.title === "P01-MOVE-ED")).toHaveLength(0);
  });

  test("reader acceptance does not mutate locally; takeover writer consumes exactly once", async () => {
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor);
    gateway.seed(exerciseId, pelvicId, "CM");
    const accepted = await gateway.submit(command("TAKEOVER"));
    expect(accepted.status).toBe("APPLIED");
    const shared = new InMemorySharedWorkflowGateway(() => ({ userId: "EXCON", role: "EXCON", exerciseIds: [exerciseId] }));
    shared.seed(exerciseId, pelvicId, capturePatientSharedWorkflowState(pelvicId), undefined, accepted.patientRevision);
    setSharedWorkflowGateway(shared); setSharedWorkflowConnectivity(true);
    observeSharedWorkflowHead(exerciseId, pelvicId, accepted.patientRevision);
    expect(dataProvider.getPatientById(pelvicId)?.location).toBe("NARVA_HOSPITAL_OUTDOOR");
    const consumer = new RuntimePatientCommandConsumer(gateway, materializeRuntimePatientCommand, () => 120);
    await consumer.drain(exerciseId, { ...lease, writerInstanceId: "TAKEOVER" });
    expect(gateway.materialized(1)).toMatchObject({ status: "MATERIALIZED", result: { ok: true } });
    expect(dataProvider.getPatientById(pelvicId)?.location).toBe("NARVA_ED");
    expect(shared.read(exerciseId, pelvicId)).toMatchObject({ revision: accepted.patientRevision + 1,
      state: { patient: { location: "NARVA_ED" }, timelineEvents: [expect.objectContaining({
        id: "TL-INTERNAL-TRANSFER-TAKEOVER" })] } });
    restoreRuntimePatientCommandCursor(exerciseId, 0);
    await consumer.drain(exerciseId, lease);
    expect(getTimelineEvents(pelvicId).filter(item => item.title === "P01-MOVE-ED")).toHaveLength(1);
  });

  test("production UI and facade use shared readiness with no CM-zone fallback", () => {
    const service = readFileSync(resolve(process.cwd(),
      "src/services/runtime/exercise/PatientInternalTransferService.ts"), "utf8");
    const ui = readFileSync(resolve(process.cwd(),
      "src/components/patient/PatientInternalTransferControls.tsx"), "utf8");
    expect(service).toContain("runtimePatientCommandSubmissionReadiness");
    expect(service).toContain('commandType: "PATIENT_LOCATION_TRANSFER"');
    expect(ui).toContain("useRuntimePatientCommandSubmissionReadiness");
    expect(`${service}\n${ui}`).not.toContain("updatePatientLocationFromCurrentCm");
  });
});
