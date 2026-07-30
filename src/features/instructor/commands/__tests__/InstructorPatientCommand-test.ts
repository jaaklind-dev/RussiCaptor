import { instructorEventCatalogue } from "@/features/instructor/commands/InstructorEventCatalogue";
import { validateInstructorPatientCommand } from "@/features/instructor/commands/InstructorPatientCommandValidator";
import type { InstructorPatientCommand } from "@/models/InstructorCommand";
import type { InstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";

const command: InstructorPatientCommand = { commandId: "CMD-1", exerciseId: "demo", patientId: "PT-001", eventType: "RESPIRATORY_DETERIORATION", issuedBy: "Instructor", issuedAtSimulationTime: 0, issuedAtWallClock: "2026-07-30T10:00:00.000Z" };
const owner: InstructorRuntimeOwner = { exerciseId: "demo", patientId: "PT-001", supportedEvents: ["RESPIRATORY_DETERIORATION"], execute: () => ({ ok: true, runtimeEventId: "EVENT-1" }) };
const context = { activeExerciseId: "demo", patientExists: true, patientBelongsToExercise: true, runtimeOwner: owner };

describe("Instructor patient command contract", () => {
  it("keeps all six stable catalogue identifiers", () => expect(instructorEventCatalogue.map(item => item.eventType)).toEqual([
    "RESPIRATORY_DETERIORATION", "AIRWAY_OBSTRUCTION", "VOMITING", "HYPOTENSION", "REDUCED_CONSCIOUSNESS", "RECOVERY_TRIGGER",
  ]));
  it("accepts a supported command", () => expect(validateInstructorPatientCommand(command, context)).toBeUndefined());
  it("rejects direct vital payloads", () => expect(validateInstructorPatientCommand({ ...command, payload: { spo2: 70 } }, context)).toMatchObject({ ok: false, errorCode: "INVALID_PAYLOAD" }));
  it("rejects wrong exercise and missing patient", () => {
    expect(validateInstructorPatientCommand(command, { ...context, activeExerciseId: "OTHER" })).toMatchObject({ errorCode: "EXERCISE_NOT_ACTIVE" });
    expect(validateInstructorPatientCommand(command, { ...context, patientExists: false })).toMatchObject({ errorCode: "PATIENT_NOT_FOUND" });
  });
  it("rejects an event without a registered runtime handler", () => expect(validateInstructorPatientCommand({ ...command, eventType: "VOMITING" }, context)).toMatchObject({ errorCode: "UNSUPPORTED_STATE" }));
});
