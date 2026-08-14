import { getImagingStudies } from "@/repositories/ImagingRepository";
import { getOrders } from "@/repositories/OrderRepository";
import { getQuestions } from "@/repositories/QuestionRepository";
import { assignPatientToMe } from "@/services/AssignmentRepository";
import { openImagingReport } from "@/services/ImagingService";
import { placeOrder } from "@/services/OrderService";
import { revealQuestion } from "@/services/RevealService";
import { resetExercise } from "@/services/ExerciseResetService";
import {
  createSharedExerciseSnapshot,
  restoreRemoteExerciseIdentity,
  restoreSharedExerciseState,
} from "@/services/StatePersistenceService";
import {
  demoTransferTarget,
  setCurrentCaseManager,
} from "@/services/CurrentUserService";
import { notifySync, subscribeToSync } from "@/services/SyncService";
import { installCurrentExercise } from "@/repositories/ExerciseRepository";
import {
  getCanonicalExerciseSnapshot,
  restoreExerciseSession,
} from "@/repositories/ExerciseSessionRepository";
import {
  ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE,
  DEFAULT_EXERCISE_PACKAGE,
} from "@/services/exercise/CanonicalExercisePackages";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { shouldIgnoreActiveSharedProjection } from "@/services/CloudSyncService";
import { startClockRunner, stopClockRunner } from "@/services/ClockRunner";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";

const patientId = "PT-001";

describe("remote clinical state sync", () => {
  beforeEach(() => resetExercise());
  afterEach(() => { stopClockRunner(); setRuntimeWriterAuthorityState("UNRESOLVED"); jest.useRealTimers(); });

  test("a writer self-echo preserves RUNNING clock progression", () => {
    jest.useFakeTimers();
    restoreExerciseSession({ exerciseId: "demo", lifecycleState: "RUNNING", simulationTimeSec: 10,
      speed: 1, version: 1, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    const projection = createSharedExerciseSnapshot();
    setRuntimeWriterAuthorityState("WRITER");
    startClockRunner();

    restoreRemoteExerciseIdentity(projection);
    jest.advanceTimersByTime(1_000);

    expect(getCanonicalExerciseSnapshot().simulationTimeSec).toBe(11);
  });

  test("an active shared projection cannot roll back its own writer or a completed exercise", () => {
    expect(shouldIgnoreActiveSharedProjection("EX-1", "RUNNING", "EX-1", "WRITER")).toBe(true);
    expect(shouldIgnoreActiveSharedProjection("EX-1", "COMPLETED", "EX-1", "READER")).toBe(true);
    expect(shouldIgnoreActiveSharedProjection("EX-1", "RUNNING", "EX-1", "READER")).toBe(false);
    expect(shouldIgnoreActiveSharedProjection("EX-1", "COMPLETED", "EX-2", "READER")).toBe(false);
  });

  test("a second CM refreshes questions, imaging studies and orders", () => {
    assignPatientToMe(patientId);

    const localSources: string[] = [];
    const stopLocalListener = subscribeToSync((source) => {
      localSources.push(source);
    });

    revealQuestion(patientId, "Q-001");
    expect(localSources).toEqual(["local"]);

    openImagingReport(patientId, "IMG-001", "KT pea");
    placeOrder(getOrders(patientId).find((order) => order.id === "ORD-001")!);
    stopLocalListener();

    const remoteSnapshot = createSharedExerciseSnapshot();
    resetExercise();
    setCurrentCaseManager(demoTransferTarget);

    let secondCmView:
      | {
          questionVisibility?: string;
          reportVisibility?: string;
          orderStatus?: string;
        }
      | undefined;
    const stopRemoteListener = subscribeToSync((source) => {
      if (source !== "remote") return;

      secondCmView = {
        questionVisibility: getQuestions(patientId).find(
          (question) => question.id === "Q-001"
        )?.visibility,
        reportVisibility: getImagingStudies(patientId).find(
          (study) => study.id === "IMG-001"
        )?.reportVisibility,
        orderStatus: getOrders(patientId).find(
          (order) => order.id === "ORD-001"
        )?.status,
      };
    });

    restoreSharedExerciseState(remoteSnapshot);
    notifySync("remote");

    expect(secondCmView).toEqual({
      questionVisibility: "revealed",
      reportVisibility: "revealed",
      orderStatus: "processing",
    });

    stopRemoteListener();
  });

  test("restores the exact READY exercise package binding", () => {
    installCurrentExercise(
      "EX-PERSISTED",
      "ALS reference",
      ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE
    );
    restoreExerciseSession({
      exerciseId: "EX-PERSISTED",
      lifecycleState: "READY",
      simulationTimeSec: 0,
      speed: 1,
      version: 8,
      clockVersion: 2,
      clockInitializedAtSimulationTimeSec: 0,
    });
    const persisted = createSharedExerciseSnapshot();

    installCurrentExercise("EX-OTHER", "Other", DEFAULT_EXERCISE_PACKAGE);
    restoreSharedExerciseState(persisted);

    expect(getCanonicalExerciseSnapshot()).toMatchObject({
      exerciseId: "EX-PERSISTED",
      lifecycleState: "READY",
    });
    expect(getExercisePackage("EX-PERSISTED")).toMatchObject({
      packageId: ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE.packageId,
      packageVersion: ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE.packageVersion,
    });
  });
});
