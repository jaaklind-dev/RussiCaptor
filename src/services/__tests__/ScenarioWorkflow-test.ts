import {
  getExerciseSession,
  pauseExerciseSession,
  setExerciseSpeed,
  startExerciseSession,
} from "@/repositories/ExerciseSessionRepository";
import { getImagingStudies } from "@/repositories/ImagingRepository";
import { getLabResults } from "@/repositories/LabRepository";
import { getOrders } from "@/repositories/OrderRepository";
import { getQuestions } from "@/repositories/QuestionRepository";
import { getUpcomingScenarioEvents } from "@/repositories/ScenarioRepository";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import { assignPatientToMe, getDashboardStats } from "@/services/AssignmentRepository";
import { advanceExerciseMinutes } from "@/services/ClockService";
import { resetExercise } from "@/services/ExerciseResetService";
import { placeOrder } from "@/services/OrderService";
import { revealQuestion } from "@/services/RevealService";

const patientId = "PT-001";

describe("order-driven scenario workflow", () => {
  beforeEach(() => {
    resetExercise();
  });

  test("completes an imaging order when its scenario event becomes due", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-003");

    expect(order).toBeDefined();
    placeOrder(order!);

    expect(order!.status).toBe("processing");
    expect(getUpcomingScenarioEvents()).toEqual([
      expect.objectContaining({
        action: "imaging.available",
        orderId: "ORD-003",
        targetId: "IMG-001",
        triggerMinute: 3,
      }),
    ]);

    advanceExerciseMinutes(2);
    expect(order!.status).toBe("processing");

    advanceExerciseMinutes(1);
    expect(order!.status).toBe("completed");
    expect(getUpcomingScenarioEvents()).toHaveLength(0);
    expect(
      getImagingStudies(patientId).find((study) => study.id === "IMG-001")
        ?.status
    ).toBe("available");
    expect(getTimelineEvents(patientId).map((event) => event.title)).toEqual([
      "KT pea tellitud",
      "KT pea täitmisel",
      "KT pea valmis",
    ]);
  });

  test("Stop restores the complete demo exercise state", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-001")!;

    assignPatientToMe(patientId);
    revealQuestion(patientId, "Q-001");
    placeOrder(order);
    startExerciseSession();
    setExerciseSpeed(5);
    advanceExerciseMinutes(3);

    resetExercise();

    expect(getExerciseSession()).toEqual({
      exerciseId: "demo",
      state: "stopped",
      currentMinute: 0,
      speed: 1,
    });
    expect(getDashboardStats().active).toBe(0);
    expect(getUpcomingScenarioEvents()).toHaveLength(0);
    expect(getTimelineEvents(patientId)).toHaveLength(0);
    expect(getOrders(patientId).every((item) => item.status === "available")).toBe(true);
    expect(getQuestions(patientId).every((item) => item.visibility === "hidden")).toBe(true);
    expect(getLabResults(patientId).every((item) => item.status === "processing")).toBe(true);
    expect(getImagingStudies(patientId).every((item) => item.status === "processing")).toBe(true);
  });

  test("Pause preserves exercise progress and pending events", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-004")!;

    placeOrder(order);
    startExerciseSession();
    advanceExerciseMinutes(2);
    pauseExerciseSession();

    expect(getExerciseSession()).toEqual(
      expect.objectContaining({
        state: "paused",
        currentMinute: 2,
      })
    );
    expect(order.status).toBe("processing");
    expect(getUpcomingScenarioEvents()).toEqual([
      expect.objectContaining({
        orderId: "ORD-004",
        triggerMinute: 4,
      }),
    ]);
  });
});
