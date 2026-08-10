import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { handleCardiacInterventionCommand, resetCardiacInterventionCommands } from "../CardiacInterventionCommandService";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from "../InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "../ScenarioEngineInstructorRuntimeOwner";

const exerciseId = "CARDIAC-UI";
const patientId = CARDIAC_ARREST_REFERENCE_FIXTURE.patientId!;

describe("WP-36B cardiac intervention command integration", () => {
  beforeEach(() => { clearInstructorRuntimeOwners(); resetCardiacInterventionCommands(); });

  test("CPR uses the authoritative intervention path, is idempotent and follows the snapshot", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(CARDIAC_ARREST_REFERENCE_FIXTURE);
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
    const command = { commandId: "CPR-UI-1", exerciseId, patientId, action: "START_CPR" as const, issuedBy: "Exercise Controller" };
    const first = handleCardiacInterventionCommand(command);
    const state = engine.getPatientProcesses().find(process => process.processType === "CARDIAC_ARREST");
    const eventCount = engine.getEventLog().length;
    expect(first.ok).toBe(true); expect(state).toMatchObject({ clinicalState: { cprActive: true } });
    expect(handleCardiacInterventionCommand(command)).toEqual(first);
    expect(engine.getEventLog()).toHaveLength(eventCount);
    expect(handleCardiacInterventionCommand({ ...command, commandId: "CPR-UI-DUP" })).toMatchObject({ ok: false, errorCode: "INVALID_STATE" });
  });

  test("defibrillation records the attempt and lets configured runtime decide the rhythm", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(CARDIAC_ARREST_REFERENCE_FIXTURE);
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
    const result = handleCardiacInterventionCommand({ commandId: "SHOCK-UI-1", exerciseId, patientId,
      action: "DEFIBRILLATION", issuedBy: "Exercise Controller" });
    expect(result.ok).toBe(true);
    expect(engine.getEventLog().map(event => event.eventType)).toContain("DEFIBRILLATION_ATTEMPTED");
  });
});
