import type { InstructorEventType, InstructorPatientCommand } from "@/models/InstructorCommand";

/** Nondeterministic metadata is created once at the UI boundary, before runtime processing. */
export function createInstructorPatientCommand(input: {
  exerciseId: string; patientId: string; eventType: InstructorEventType; issuedBy: string; simulationTime: number;
}): InstructorPatientCommand {
  return {
    commandId: `IC3-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    exerciseId: input.exerciseId, patientId: input.patientId, eventType: input.eventType, issuedBy: input.issuedBy,
    issuedAtSimulationTime: input.simulationTime, issuedAtWallClock: new Date().toISOString(),
  };
}
