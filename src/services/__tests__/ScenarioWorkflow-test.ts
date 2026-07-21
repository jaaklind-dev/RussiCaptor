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
import {
  addScenarioEvent,
  getResolvedScenarioEvents,
  getUpcomingScenarioEvents,
} from "@/repositories/ScenarioRepository";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import {
  acceptPatientTransfer,
  assignPatient,
  assignPatientToMe,
  getAllActivePatientAssignments,
  getDashboardStats,
  getMyClosedAssignments,
  getMyIncomingTakeoverRequests,
  getPatientAssignment,
  getPendingPatientTransfer,
  rejectPatientTransfer,
  requestPatientTakeover,
} from "@/services/AssignmentRepository";
import { advanceExerciseMinutes } from "@/services/ClockService";
import { resetExercise } from "@/services/ExerciseResetService";
import { placeOrder } from "@/services/OrderService";
import { revealQuestion } from "@/services/RevealService";
import { finishPatient } from "@/services/PatientCompletionService";
import {
  findPatientById,
  getAllPatients,
  setPatientStatus,
} from "@/repositories/PatientRepository";
import { triggerScenarioEventNow } from "@/services/ScenarioControlService";
import { getNotes } from "@/repositories/NoteRepository";
import { addPatientNote } from "@/services/NoteService";
import {
  getInterventions,
  getInterventionOptions,
} from "@/repositories/InterventionRepository";
import { recordIntervention } from "@/services/InterventionService";
import {
  getMedicationAdministrations,
  getMedicationOptions,
} from "@/repositories/MedicationRepository";
import { administerMedication } from "@/services/MedicationService";
import { findLocationZoneByCode } from "@/repositories/LocationRepository";
import {
  getCurrentLocationZone,
  setCurrentLocationZone,
} from "@/services/CurrentLocationService";
import { updatePatientLocationFromCurrentCm } from "@/services/PatientLocationService";
import {
  demoTransferTarget,
  getCurrentCaseManager,
} from "@/services/CurrentUserService";

const patientId = "PT-001";

describe("order-driven scenario workflow", () => {
  beforeEach(() => {
    resetExercise();
  });

  test("completes an imaging order when its scenario event becomes due", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-003");

    expect(order).toBeDefined();
    assignPatientToMe(patientId);
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
    expect(getResolvedScenarioEvents()).toEqual([
      expect.objectContaining({
        orderId: "ORD-003",
        executed: true,
        resolvedAtMinute: 3,
      }),
    ]);
    expect(
      getImagingStudies(patientId).find((study) => study.id === "IMG-001")
        ?.status
    ).toBe("available");
    expect(getTimelineEvents(patientId).map((event) => event.title)).toEqual([
      "Patsient määratud Case Managerile",
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
    expect(getResolvedScenarioEvents()).toHaveLength(0);
    expect(getTimelineEvents(patientId)).toHaveLength(0);
    expect(getOrders(patientId).every((item) => item.status === "available")).toBe(true);
    expect(getQuestions(patientId).every((item) => item.visibility === "hidden")).toBe(true);
    expect(getLabResults(patientId).every((item) => item.status === "processing")).toBe(true);
    expect(getImagingStudies(patientId).every((item) => item.status === "processing")).toBe(true);
  });

  test("patient assignment is audited once and activates an incoming patient", () => {
    setPatientStatus(patientId, "Incoming");

    expect(assignPatientToMe(patientId).status).toBe("assigned");
    expect(assignPatientToMe(patientId).status).toBe("already-assigned");
    expect(findPatientById(patientId)?.status).toBe("Active");
    expect(getDashboardStats()).toEqual(
      expect.objectContaining({ active: 1, incoming: 0 })
    );
    expect(getTimelineEvents(patientId)).toEqual([
      expect.objectContaining({
        type: "assignment",
        title: "Patsient määratud Case Managerile",
      }),
    ]);
  });

  test("a second Case Manager receives the existing assignment owner", () => {
    expect(assignPatientToMe(patientId).status).toBe("assigned");

    const result = assignPatient(patientId, {
      id: "CM-002",
      name: "Mari",
    });

    expect(result).toEqual({
      status: "assigned-to-other",
      assignment: expect.objectContaining({
        patientId,
        caseManagerId: "CM-001",
        caseManagerName: "Jaak",
      }),
    });
    expect(getPatientAssignment(patientId)?.caseManagerName).toBe("Jaak");
    expect(getAllActivePatientAssignments()).toEqual([
      expect.objectContaining({
        assignment: expect.objectContaining({ caseManagerName: "Jaak" }),
        patient: expect.objectContaining({ id: patientId }),
      }),
    ]);
    expect(getTimelineEvents(patientId)).toHaveLength(1);
  });

  test("patient transfer changes owner and preserves an audit trail", () => {
    expect(assignPatientToMe(patientId).status).toBe("assigned");

    expect(requestPatientTakeover(patientId, demoTransferTarget)).toBe(true);
    expect(getPatientAssignment(patientId)?.caseManagerName).toBe("Jaak");
    expect(getDashboardStats()).toEqual(
      expect.objectContaining({ active: 1, transferred: 0 })
    );
    expect(getPendingPatientTransfer(patientId)).toEqual(
      expect.objectContaining({
        fromCaseManagerName: "Jaak",
        toCaseManagerName: "Mari",
        status: "pending",
      })
    );
    expect(getMyIncomingTakeoverRequests()).toEqual([
      expect.objectContaining({
        patientId,
        fromCaseManagerName: "Jaak",
        toCaseManagerName: "Mari",
      }),
    ]);

    expect(acceptPatientTransfer(patientId, getCurrentCaseManager())).toBe(true);
    expect(getMyIncomingTakeoverRequests()).toHaveLength(0);
    expect(findPatientById(patientId)?.status).toBe("Active");
    expect(getPatientAssignment(patientId)).toEqual(
      expect.objectContaining({
        caseManagerId: "CM-002",
        caseManagerName: "Mari",
      })
    );
    expect(getPatientAssignment(patientId)?.endedAt).toBeUndefined();
    expect(getAllActivePatientAssignments()).toEqual([
      expect.objectContaining({
        assignment: expect.objectContaining({ caseManagerName: "Mari" }),
        patient: expect.objectContaining({ id: patientId }),
      }),
    ]);
    expect(getDashboardStats()).toEqual(
      expect.objectContaining({ active: 0, transferred: 1 })
    );
    expect(getMyClosedAssignments()).toEqual([
      expect.objectContaining({
        patientId,
        endReason: "transferred",
        transferredToCaseManagerName: "Mari",
      }),
    ]);
    expect(assignPatient(patientId, demoTransferTarget).status).toBe(
      "already-assigned"
    );
    expect(getTimelineEvents(patientId).map((event) => event.title)).toEqual([
      "Patsient määratud Case Managerile",
      "Ülevõtmistaotlus saadetud",
      "Patsiendi üleandmine vastu võetud",
    ]);

    const blockedOrder = getOrders(patientId).find((item) => item.id === "ORD-001")!;
    placeOrder(blockedOrder);
    expect(blockedOrder.status).toBe("available");
    expect(addPatientNote(patientId, "Jaak ei tohi seda lisada.")).toBe(false);
    revealQuestion(patientId, "Q-001");
    expect(
      getQuestions(patientId).find((question) => question.id === "Q-001")
        ?.visibility
    ).toBe("hidden");
  });

  test("current owner can reject a takeover request", () => {
    assignPatientToMe(patientId);
    expect(requestPatientTakeover(patientId, demoTransferTarget)).toBe(true);

    expect(rejectPatientTransfer(patientId, getCurrentCaseManager())).toBe(true);
    expect(getPendingPatientTransfer(patientId)).toBeUndefined();
    expect(getPatientAssignment(patientId)?.caseManagerName).toBe("Jaak");
    expect(getDashboardStats()).toEqual(
      expect.objectContaining({ active: 1, transferred: 0 })
    );
    expect(getTimelineEvents(patientId).at(-1)?.title).toBe(
      "Ülevõtmistaotlus tagasi lükatud"
    );
  });

  test("Finish cancels a pending patient transfer", () => {
    assignPatientToMe(patientId);
    expect(requestPatientTakeover(patientId, demoTransferTarget)).toBe(true);

    expect(finishPatient(patientId)).toBe(true);
    expect(getPendingPatientTransfer(patientId)).toBeUndefined();
    expect(acceptPatientTransfer(patientId, getCurrentCaseManager())).toBe(false);
    expect(findPatientById(patientId)?.status).toBe("Completed");
  });

  test("Pause preserves exercise progress and pending events", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-004")!;

    assignPatientToMe(patientId);
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

  test("EXCON can trigger a pending result immediately", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-002")!;

    assignPatientToMe(patientId);
    placeOrder(order);
    const event = getUpcomingScenarioEvents()[0];

    expect(event.triggerMinute).toBe(5);
    expect(triggerScenarioEventNow(event.id, 0)).toBe(true);
    expect(order.status).toBe("completed");
    expect(getUpcomingScenarioEvents()).toHaveLength(0);
    expect(getResolvedScenarioEvents()).toEqual([
      expect.objectContaining({ executed: true, resolvedAtMinute: 0 }),
    ]);
    expect(
      getLabResults(patientId)
        .filter((lab) => lab.panel === "CBC")
        .every((lab) => lab.status === "available")
    ).toBe(true);
    expect(getTimelineEvents(patientId).at(-1)?.title).toBe(
      "Täisvere analüüs valmis"
    );
  });

  test("executes the remaining supported scenario actions", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-001")!;

    addScenarioEvent({
      id: "EVT-PROCESSING",
      exerciseId: "demo",
      patientId,
      triggerMinute: 1,
      action: "imaging.processing",
      targetId: "IMG-001",
      title: "KT pea töötlemisel",
      description: "KT pea uuring on töötlemisel.",
      executed: false,
    });
    addScenarioEvent({
      id: "EVT-ORDER",
      exerciseId: "demo",
      patientId,
      triggerMinute: 2,
      action: "order.completed",
      targetId: order.id,
      title: "Tellimus lõpetatud",
      description: "Tellimuse töövoog lõpetati.",
      executed: false,
    });
    addScenarioEvent({
      id: "EVT-NOTE",
      exerciseId: "demo",
      patientId,
      triggerMinute: 3,
      action: "note.available",
      targetId: "NOTE-SYSTEM-001",
      title: "EXCON teade",
      description: "Patsient vajab uut hindamist.",
      executed: false,
    });

    advanceExerciseMinutes(3);

    expect(order.status).toBe("completed");
    expect(getNotes(patientId)).toEqual([
      expect.objectContaining({
        id: "NOTE-SYSTEM-001",
        text: "Patsient vajab uut hindamist.",
        author: "System",
      }),
    ]);
    expect(getResolvedScenarioEvents()).toHaveLength(3);
    expect(getResolvedScenarioEvents().every((event) => event.executed)).toBe(true);
    expect(getTimelineEvents(patientId).map((event) => event.title)).toEqual([
      "KT pea töötlemisel",
      "Tellimus lõpetatud",
      "EXCON teade",
    ]);
  });

  test("CM notes survive Finish and are cleared by Stop", () => {
    assignPatientToMe(patientId);

    expect(addPatientNote(patientId, "  Patsient vajab kordushindamist.  ")).toBe(true);
    expect(getNotes(patientId)).toEqual([
      expect.objectContaining({
        text: "Patsient vajab kordushindamist.",
        author: "Jaak",
      }),
    ]);
    expect(getTimelineEvents(patientId).at(-1)?.title).toBe("CM märge lisatud");

    finishPatient(patientId);
    expect(getNotes(patientId)).toHaveLength(1);
    expect(addPatientNote(patientId, "Seda ei lisata.")).toBe(false);

    resetExercise();
    expect(getNotes(patientId)).toHaveLength(0);
  });

  test("records responder interventions with ownership and reset rules", () => {
    assignPatientToMe(patientId);

    expect(getInterventionOptions(patientId).map((option) => option.type)).toEqual([
      "airway",
      "iv_access",
    ]);
    expect(recordIntervention(patientId, "INTOPT-001")).toBe(true);
    expect(recordIntervention(patientId, "INTOPT-002")).toBe(true);
    expect(recordIntervention(patientId, "not-expected")).toBe(false);
    expect(getInterventions(patientId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "iv_access",
          label: "Veenitee rajamine",
          performedBy: "Jaak",
          status: "completed",
        }),
        expect.objectContaining({ type: "airway", label: "Hingamistee tagamine" }),
      ])
    );
    expect(getTimelineEvents(patientId).map((event) => event.title)).toEqual([
      "Patsient määratud Case Managerile",
      "Hingamistee tagamine",
      "Veenitee rajamine",
    ]);

    finishPatient(patientId);
    expect(recordIntervention(patientId, "INTOPT-001")).toBe(false);
    expect(getInterventions(patientId)).toHaveLength(2);

    resetExercise();
    expect(getInterventions(patientId)).toHaveLength(0);
  });

  test("shows and records only configured medication options", () => {
    assignPatientToMe(patientId);

    expect(getMedicationOptions(patientId).map((option) => option.id)).toEqual([
      "MEDOPT-001",
      "MEDOPT-002",
    ]);
    expect(administerMedication(patientId, "MEDOPT-001")).toBe(true);
    expect(administerMedication(patientId, "not-expected")).toBe(false);
    expect(getMedicationAdministrations(patientId)).toEqual([
      expect.objectContaining({
        name: "Botulismi antitoksiin",
        dose: "1 viaal",
        route: "IV",
        administeredBy: "Jaak",
      }),
    ]);
    expect(getTimelineEvents(patientId).at(-1)).toEqual(
      expect.objectContaining({
        type: "medication",
        title: "Botulismi antitoksiin",
      })
    );

    resetExercise();
    expect(getMedicationAdministrations(patientId)).toHaveLength(0);
  });

  test("updates patient location from the current CM zone", () => {
    assignPatientToMe(patientId);
    const intensiveCare = findLocationZoneByCode("loc-icu-2")!;

    setCurrentLocationZone(intensiveCare);
    expect(getCurrentLocationZone()?.name).toBe("Intensiivravi");
    expect(updatePatientLocationFromCurrentCm(patientId)).toBe(true);
    expect(findPatientById(patientId)?.location).toBe("Intensiivravi");
    expect(getTimelineEvents(patientId).at(-1)).toEqual(
      expect.objectContaining({
        title: "Patsiendi asukoht muutus",
        description: "EMO triaaž → Intensiivravi",
      })
    );
    expect(updatePatientLocationFromCurrentCm(patientId)).toBe(false);

    resetExercise();
    expect(findPatientById(patientId)?.location).toBe("EMO triaaž");
    expect(getCurrentLocationZone()?.name).toBe("EMO triaaž");
  });

  test("Finish completes one patient without resetting their history", () => {
    const order = getOrders(patientId).find((item) => item.id === "ORD-003")!;

    assignPatientToMe(patientId);
    placeOrder(order);

    expect(finishPatient(patientId)).toBe(true);
    expect(findPatientById(patientId)?.status).toBe("Completed");
    expect(getPatientAssignment(patientId)).toEqual(
      expect.objectContaining({
        caseManagerName: "Jaak",
        endedAt: expect.any(String),
      })
    );
    expect(
      getAllPatients().filter((patient) => patient.status === "Completed")
    ).toEqual([expect.objectContaining({ id: patientId })]);
    expect(getDashboardStats()).toEqual(
      expect.objectContaining({ active: 0, completed: 1 })
    );
    expect(getMyClosedAssignments()).toEqual([
      expect.objectContaining({ patientId, endReason: "completed" }),
    ]);
    expect(getUpcomingScenarioEvents()).toHaveLength(0);
    expect(getResolvedScenarioEvents()).toEqual([
      expect.objectContaining({ cancelled: true, resolvedAtMinute: 0 }),
    ]);
    expect(order.status).toBe("processing");
    expect(getTimelineEvents(patientId).map((event) => event.title)).toEqual([
      "Patsient määratud Case Managerile",
      "KT pea tellitud",
      "KT pea täitmisel",
      "Patsiendi käsitlus lõpetatud",
    ]);

    const blockedOrder = getOrders(patientId).find((item) => item.id === "ORD-001")!;
    placeOrder(blockedOrder);
    expect(blockedOrder.status).toBe("available");

    resetExercise();
    expect(findPatientById(patientId)?.status).toBe("Active");
    expect(getDashboardStats().completed).toBe(0);
  });
});
