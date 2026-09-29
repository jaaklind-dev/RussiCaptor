import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from
  "@/repositories/ExerciseSessionRepository";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import { dataProvider } from "@/providers/ProviderFactory";
import { assignPatientToMeConflictSafe, getPatientAssignment } from "@/services/AssignmentRepository";
import { setCurrentCaseManager } from "@/services/CurrentUserService";
import { resetExercise } from "@/services/ExerciseResetService";
import { updatePatientLocationFromCurrentCmConflictSafe } from "@/services/PatientLocationService";
import { DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { getAvailablePatientInternalTransfers } from "@/services/runtime/exercise/PatientInternalTransferService";
import { InMemorySharedWorkflowGateway } from "@/services/sharedWorkflow/InMemorySharedWorkflowGateway";
import { resetSharedWorkflowConflictMetrics, setSharedWorkflowConnectivity,
  setSharedWorkflowGateway } from "@/services/sharedWorkflow/SharedWorkflowMutationService";

const exerciseId = "demo";
const pelvicId = "PT-PELVIC-001";
const chestId = "PT-CHEST-001";
const legacyId = "PT-LEGACY-001";
const cm = Object.freeze({ id: "CM-LOCATION", name: "CM Location" });
const patient = (id: string, location: string) => ({ id, isikukood: id, name: id, triage: "P1" as const,
  status: "Active" as const, location, lastSeen: "T+0", mist: { mechanism: "Trauma", injuries: "",
    signs: "", treatment: "" } });

describe("P01-CLAIM-LOCATION-AUTHORITY-01 / LOC-AUTH", () => {
  const snapshotBefore = getCanonicalExerciseSnapshot();

  beforeEach(() => {
    resetExercise();
    exercisePackageLoader.unbind(exerciseId);
    setCurrentCaseManager(cm);
    replaceCanonicalExerciseSnapshot({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0,
      speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
    resetSharedWorkflowConflictMetrics();
    setSharedWorkflowConnectivity(true);
  });

  afterEach(() => {
    setSharedWorkflowGateway(undefined);
    resetSharedWorkflowConflictMetrics();
    resetExercise();
    exercisePackageLoader.unbind(exerciseId);
    exercisePackageLoader.bind(exerciseId, DEFAULT_EXERCISE_PACKAGE);
    replaceCanonicalExerciseSnapshot(snapshotBefore);
  });

  test("LOC-AUTH-G01..G06: claim owns P01 but preserves package-owned outdoor authority", async () => {
    exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    dataProvider.installPatients([patient(pelvicId, "NARVA_HOSPITAL_OUTDOOR"),
      patient(chestId, "NARVA_ED")]);
    const gateway = new InMemorySharedWorkflowGateway(() => ({ userId: cm.id, role: "CM",
      exerciseIds: [exerciseId] }));
    setSharedWorkflowGateway(gateway);

    const claim = await assignPatientToMeConflictSafe(pelvicId);
    expect(claim.result.status).toBe("APPLIED");
    expect(getPatientAssignment(pelvicId)).toMatchObject({ caseManagerId: cm.id });

    const location = await updatePatientLocationFromCurrentCmConflictSafe(pelvicId);
    expect(location).toMatchObject({ result: { status: "IDEMPOTENT", ownerUserId: cm.id }, value: false });
    expect(dataProvider.getPatientById(pelvicId)?.location).toBe("NARVA_HOSPITAL_OUTDOOR");
    expect(gateway.acceptedCount(exerciseId)).toBe(1);
    expect(getTimelineEvents(pelvicId).filter(event => event.title === "Patsiendi asukoht muutus"))
      .toHaveLength(0);
    expect(getAvailablePatientInternalTransfers(exerciseId, pelvicId)).toEqual([
      expect.objectContaining({ actionId: "P01-MOVE-ED", toLocationId: "NARVA_ED" }),
    ]);

    // Replays, reader refreshes, and writer takeovers all evaluate the same
    // package authority and therefore cannot synthesize a claim-location move.
    await updatePatientLocationFromCurrentCmConflictSafe(pelvicId);
    await updatePatientLocationFromCurrentCmConflictSafe(pelvicId);
    expect(dataProvider.getPatientById(pelvicId)?.location).toBe("NARVA_HOSPITAL_OUTDOOR");
    expect(gateway.acceptedCount(exerciseId)).toBe(1);
  });

  test("LOC-AUTH-G07: P02 claim creates no unintended location transition", async () => {
    exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    dataProvider.installPatients([patient(pelvicId, "NARVA_HOSPITAL_OUTDOOR"),
      patient(chestId, "NARVA_ED")]);
    const gateway = new InMemorySharedWorkflowGateway(() => ({ userId: cm.id, role: "CM",
      exerciseIds: [exerciseId] }));
    setSharedWorkflowGateway(gateway);
    expect((await assignPatientToMeConflictSafe(chestId)).result.status).toBe("APPLIED");
    expect((await updatePatientLocationFromCurrentCmConflictSafe(chestId)).value).toBe(true);
    expect(dataProvider.getPatientById(chestId)?.location).toBe("EMO triaaž");
    expect(getAvailablePatientInternalTransfers(exerciseId, chestId)).toEqual([]);
  });

  test("LOC-AUTH-G08: a package without explicit authority retains generic claim-location sync", async () => {
    exercisePackageLoader.bind(exerciseId, DEFAULT_EXERCISE_PACKAGE);
    dataProvider.installPatients([patient(legacyId, "Vastuvõtuala")]);
    const gateway = new InMemorySharedWorkflowGateway(() => ({ userId: cm.id, role: "CM",
      exerciseIds: [exerciseId] }));
    setSharedWorkflowGateway(gateway);
    expect((await assignPatientToMeConflictSafe(legacyId)).result.status).toBe("APPLIED");
    expect((await updatePatientLocationFromCurrentCmConflictSafe(legacyId)).value).toBe(true);
    expect(dataProvider.getPatientById(legacyId)?.location).toBe("EMO triaaž");
    expect(getTimelineEvents(legacyId).filter(event => event.title === "Patsiendi asukoht muutus"))
      .toHaveLength(1);
    expect(gateway.acceptedCount(exerciseId)).toBe(2);
  });
});
