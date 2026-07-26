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
  restoreSharedExerciseState,
} from "@/services/StatePersistenceService";
import {
  demoTransferTarget,
  setCurrentCaseManager,
} from "@/services/CurrentUserService";
import { notifySync, subscribeToSync } from "@/services/SyncService";

const patientId = "PT-001";

describe("remote clinical state sync", () => {
  beforeEach(() => resetExercise());

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
});
