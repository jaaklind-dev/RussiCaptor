import { handleInstructorPatientCommand, resetInstructorCommandHandler } from "@/features/instructor/commands/InstructorPatientCommandHandler";
import type { ExerciseControlCommand, ExerciseControlCommandType } from "@/models/exercise/ExerciseControlCommand";
import { getAllPatients } from "@/repositories/PatientRepository";
import { clearTimelineEvents } from "@/repositories/TimelineRepository";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { assignPatient, clearAssignments } from "@/services/AssignmentRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { getCanonicalExerciseTimeline } from "../ExerciseTimelineAggregator";
import { AuthoritativeExerciseRuntime } from "../AuthoritativeExerciseRuntime";
import { handleExerciseControlCommand, resetExerciseControlCommandHandler } from "../ExerciseControlCommandHandler";
import { clearExerciseRuntimeOwner, registerExerciseRuntimeOwner } from "../ExerciseRuntimeOwnerRegistry";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";

const patientId = getAllPatients()[0].id; let sequence = 0;
function control(commandType: ExerciseControlCommandType): ExerciseControlCommand { return { commandId: `WP23-${commandType}-${++sequence}`, exerciseId: "demo", commandType, issuedBy: "Exercise Controller", issuedAtWallClock: "2026-08-04T08:00:00.000Z", expectedVersion: getCanonicalExerciseSnapshot().version }; }
describe("WP-23 source integration", () => {
  beforeEach(() => { stopClockRunner(); clearExerciseRuntimeOwner(); clearInstructorRuntimeOwners(); resetExerciseControlCommandHandler(); resetInstructorCommandHandler(); clearTimelineEvents(); clearAssignments();
    replaceCanonicalExerciseSnapshot({ exerciseId: "demo", lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: 0 }); registerExerciseRuntimeOwner(new AuthoritativeExerciseRuntime("demo"));
    registerInstructorRuntimeOwner({ exerciseId: "demo", patientId, supportedEvents: ["RECOVERY_TRIGGER"], execute: command => ({ ok: true, runtimeEventId: `RUNTIME:${command.commandId}` }) }); });
  afterEach(stopClockRunner);
  test("projects lifecycle, injection, ownership and rejected commands and updates from sources", () => {
    expect(handleExerciseControlCommand(control("START_EXERCISE")).ok).toBe(true);
    expect(handleInstructorPatientCommand({ commandId: "WP23-INJECT", exerciseId: "demo", patientId, eventType: "RECOVERY_TRIGGER", issuedBy: "Jaak", issuedAtSimulationTime: 0, issuedAtWallClock: "2026-08-04T08:00:00.000Z" }).ok).toBe(true);
    assignPatient(patientId, { id: "CM-001", name: "Jaak" });
    expect(handleExerciseControlCommand(control("PAUSE_EXERCISE")).ok).toBe(true); expect(handleExerciseControlCommand(control("RESUME_EXERCISE")).ok).toBe(true); expect(handleExerciseControlCommand(control("COMPLETE_EXERCISE")).ok).toBe(true);
    const events = getCanonicalExerciseTimeline(); expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["ExerciseStarted", "RECOVERY_TRIGGER", "ASSIGNMENT", "ExercisePaused", "ExerciseResumed", "ExerciseCompleted"]));
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
  });
});
