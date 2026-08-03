import { validateInstructorPatientCommand } from "../InstructorPatientCommandValidator";
import type { InstructorPatientCommand } from "@/models/InstructorCommand";

const command: InstructorPatientCommand = { commandId: "I-1", exerciseId: "demo", patientId: "PT-001", eventType: "VOMITING", issuedBy: "Instructor", issuedAtSimulationTime: 0, issuedAtWallClock: "2026-08-03T10:00:00.000Z" };
const context = { activeExerciseId: "demo", patientExists: true, patientBelongsToExercise: true };
describe("WP-22 patient event lifecycle gate", () => {
  it.each([["READY", "EXERCISE_NOT_RUNNING"], ["PAUSED", "EXERCISE_PAUSED"], ["COMPLETED", "EXERCISE_COMPLETED"]] as const)("rejects injection while %s", (exerciseLifecycleState, errorCode) => {
    expect(validateInstructorPatientCommand(command, { ...context, exerciseLifecycleState })).toMatchObject({ ok: false, errorCode });
  });
});
