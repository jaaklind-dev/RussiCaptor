import { getInstructorCommandAudit, handleInstructorPatientCommand, resetInstructorCommandHandler } from "@/features/instructor/commands/InstructorPatientCommandHandler";
import type { InstructorPatientCommand } from "@/models/InstructorCommand";
import type { GoldenFixture } from "@/models/GoldenTest";
import { getAllPatients } from "@/repositories/PatientRepository";
import { clearTimelineEvents, getTimelineEvents } from "@/repositories/TimelineRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";

const patientId = getAllPatients()[0].id;
const fixture: GoldenFixture = { fixtureId: "FX-IC3", fixtureType: "Runtime", patientId, seed: 17, clockState: "Running", ownershipVersion: 1,
  initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", processId: "HV-IC3", ventilationReserve: 60, reserveLossPerMin: 2, co2Burden: 55, co2GainPerMin: 2 }, activeResources: {}, loadedModules: ["HV"] };
const command: InstructorPatientCommand = { commandId: "CMD-IC3-1", exerciseId: "demo", patientId, eventType: "RESPIRATORY_DETERIORATION", issuedBy: "Instructor", issuedAtSimulationTime: 0, issuedAtWallClock: "2026-07-30T10:00:00.000Z" };

function setup() { const engine = new ClinicalScenarioEngine(); engine.reset(fixture); registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, "demo", patientId)); return engine; }

describe("IC-3 authoritative runtime integration", () => {
  beforeEach(() => { clearInstructorRuntimeOwners(); resetInstructorCommandHandler(); clearTimelineEvents(); });
  it("applies once through PatientProcess aggregation and creates one timeline entry", () => {
    const engine = setup(); const before = engine.getRuntimeState().stateVersion;
    const first = handleInstructorPatientCommand(command);
    const afterFirst = { stateVersion: engine.getRuntimeState().stateVersion, events: engine.getEventLog(), hashes: engine.getHashes() };
    const second = handleInstructorPatientCommand(command);
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    expect(engine.getRuntimeState().stateVersion).toBe(before + 1);
    expect({ stateVersion: engine.getRuntimeState().stateVersion, events: engine.getEventLog(), hashes: engine.getHashes() }).toEqual(afterFirst);
    expect(engine.getEventLog().filter(event => event.eventType === "INSTRUCTOR_EVENT_APPLIED")).toHaveLength(1);
    expect(engine.getRuntimeState().gcsTarget).toBeLessThanOrEqual(15);
    expect(getTimelineEvents(patientId)).toHaveLength(1);
    expect(getInstructorCommandAudit()).toHaveLength(1);
  });
  it("does not mutate runtime when validation fails", () => {
    const engine = setup(); const before = engine.getHashes();
    const result = handleInstructorPatientCommand({ ...command, commandId: "BAD", payload: { spo2: 60 } });
    expect(result).toMatchObject({ ok: false, errorCode: "INVALID_PAYLOAD" }); expect(engine.getHashes()).toEqual(before);
  });
  it("replays identical commands to identical snapshots, events and hashes", () => {
    const first = setup(); expect(handleInstructorPatientCommand(command).ok).toBe(true);
    const firstResult = { state: first.getRuntimeState(), events: first.getEventLog(), hash: first.getHashes().replayHash };
    clearInstructorRuntimeOwners(); resetInstructorCommandHandler(); clearTimelineEvents();
    const second = setup(); expect(handleInstructorPatientCommand(command).ok).toBe(true);
    expect({ state: second.getRuntimeState(), events: second.getEventLog(), hash: second.getHashes().replayHash }).toEqual(firstResult);
  });
});
