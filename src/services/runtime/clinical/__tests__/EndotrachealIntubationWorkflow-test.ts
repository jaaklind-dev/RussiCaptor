import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture } from "@/services/exercise/CanonicalPatientDatasets";
import { airwayInterventionDefinitions } from "../AirwayInterventionDefinitions";
import { selectEndotrachealIntubationOptions } from "../EndotrachealIntubationSelector";
import { restoreExerciseSession, resetExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { handleEndotrachealIntubationCommand, resetEndotrachealIntubationCommands } from
  "@/services/runtime/instructor/EndotrachealIntubationCommandService";
import { clearTimelineEvents, getTimelineEvents } from "@/repositories/TimelineRepository";

const patientId = "PT-PELVIC-001";
const resource = (resourceId: string, type: string, metadata: Record<string, unknown> = {}, status = "AVAILABLE") =>
  ({ resourceId, type, status, metadata });
const fixture = (resources: object[]) => ({ ...structuredClone(mtpReferenceFixture), activeResources: { resources } });
const params = (device: "DIRECT" | "VIDEO" = "DIRECT") =>
  ({ device, tubeSize: 7.5, cuff: true, confirmation: true });
function engine(resources = [resource("ETT-75", "endotrachealTube", { tubeSize: 7.5, cuffed: true }),
  resource("DL-1", "directLaryngoscope"), resource("VL-1", "videoLaryngoscope"), resource("CO2-1", "capnography")]) {
  const value = new ClinicalScenarioEngine(); value.reset(fixture(resources)); return value;
}
function start(value: ClinicalScenarioEngine, commandId = "CMD-1", scope = "DL-1", device: "DIRECT" | "VIDEO" = "DIRECT",
  extra: string[] = []) {
  return value.startResourceAwareClinicalIntervention({ sourceInterventionId: commandId,
    definitionId: "ENDOTRACHEAL_INTUBATION", patientId, resourceIds: ["ETT-75", scope, ...extra],
    parameters: params(device) });
}

describe("resource-aware canonical endotracheal intubation", () => {
  beforeEach(() => { clearInstructorRuntimeOwners(); resetEndotrachealIntubationCommands(); resetExerciseSession(); clearTimelineEvents(); });
  afterEach(() => { clearInstructorRuntimeOwners(); resetEndotrachealIntubationCommands(); resetExerciseSession(); clearTimelineEvents(); });
  test("uses one generic alternative laryngoscope requirement", () => {
    const definition = airwayInterventionDefinitions.find(item => item.definitionId === "ENDOTRACHEAL_INTUBATION")!;
    expect(definition.requiredResources).toContainEqual({ oneOfResourceTypes: ["directLaryngoscope", "videoLaryngoscope"], quantity: 1 });
    expect(airwayInterventionDefinitions.some(item => item.definitionId === "VIDEO_ENDOTRACHEAL_INTUBATION")).toBe(false);
  });
  test("selector exposes one action for direct or video equipment", () => {
    const snapshot = engine().getResourcePoolSnapshot(); const options = selectEndotrachealIntubationOptions(snapshot);
    expect(options.available).toBe(true); expect(options.tubes).toHaveLength(1); expect(options.laryngoscopes).toHaveLength(2);
  });
  test("selector is unavailable without a tube or compatible scope", () => {
    expect(selectEndotrachealIntubationOptions([resource("D", "directLaryngoscope") as never]).available).toBe(false);
    expect(selectEndotrachealIntubationOptions([resource("T", "endotrachealTube") as never]).available).toBe(false);
  });
  test("starts canonical ETT with direct laryngoscope and derives secured airway", () => {
    const value = engine(); const result = start(value);
    expect(result).toMatchObject({ definitionId: "ENDOTRACHEAL_INTUBATION", status: "RUNNING",
      resourceIds: ["DL-1", "ETT-75"], parameters: { device: "DIRECT", confirmation: true } });
    expect(value.getAirwayState(patientId)).toMatchObject({ activeAirway: "ENDOTRACHEAL", confirmed: true });
  });
  test("starts the same canonical ETT with a video laryngoscope", () => {
    const value = engine(); expect(start(value, "VIDEO", "VL-1", "VIDEO").definitionId).toBe("ENDOTRACHEAL_INTUBATION");
    expect(value.getAssignedResources(patientId).map(item => item.resourceId).sort()).toEqual(["ETT-75", "VL-1"]);
  });
  test("reserves optional capnography with the intervention", () => {
    const value = engine(); expect(start(value, "CAPNO", "DL-1", "DIRECT", ["CO2-1"]).resourceIds)
      .toEqual(["CO2-1", "DL-1", "ETT-75"]);
  });
  test("rejects wrong device before reserving anything", () => {
    const value = engine(); expect(() => start(value, "WRONG", "VL-1", "DIRECT")).toThrow("Seadme valik");
    expect(value.getAssignedResources(patientId)).toEqual([]); expect(value.getInterventionInstances()).toEqual([]);
  });
  test("rejects tube-size and cuff contradictions before mutation", () => {
    const value = engine();
    expect(() => value.startResourceAwareClinicalIntervention({ sourceInterventionId: "SIZE", definitionId: "ENDOTRACHEAL_INTUBATION",
      patientId, resourceIds: ["ETT-75", "DL-1"], parameters: { ...params(), tubeSize: 8 } })).toThrow("Toru suurus");
    expect(value.getAssignedResources(patientId)).toEqual([]);
  });
  test("requires positive confirmation before authoritative airway mutation", () => {
    const value = engine(); expect(() => value.startResourceAwareClinicalIntervention({ sourceInterventionId: "NO-CONFIRM",
      definitionId: "ENDOTRACHEAL_INTUBATION", patientId, resourceIds: ["ETT-75", "DL-1"],
      parameters: { ...params(), confirmation: false } })).toThrow("kinnitus");
    expect(value.getAirwayState(patientId).activeAirway).toBe("NONE");
  });
  test("missing and unavailable resources fail without a leaked reservation", () => {
    const value = engine([resource("ETT-75", "endotrachealTube", { tubeSize: 7.5, cuffed: true }),
      resource("DL-1", "directLaryngoscope", {}, "RESERVED")]);
    expect(() => start(value)).toThrow("enam saadaval"); expect(value.getAssignedResources(patientId)).toEqual([]);
  });
  test("wrong patient scope fails before any resource mutation", () => {
    const value = engine(); expect(() => value.startResourceAwareClinicalIntervention({ sourceInterventionId: "WRONG-PATIENT",
      definitionId: "ENDOTRACHEAL_INTUBATION", patientId: "PT-OTHER", resourceIds: ["ETT-75", "DL-1"],
      parameters: params() })).toThrow("patsiendikontekst");
    expect(value.getAssignedResources(patientId)).toEqual([]);
  });
  test("a competing command cannot reuse the same tube", () => {
    const value = engine(); start(value, "WINNER");
    expect(() => start(value, "LOSER", "VL-1", "VIDEO")).toThrow("enam saadaval");
    expect(value.getInterventionInstances().filter(item => item.definitionId === "ENDOTRACHEAL_INTUBATION")).toHaveLength(1);
  });
  test("duplicate command is idempotent and creates one evidence instance", () => {
    const value = engine(); expect(start(value, "SAME")).toEqual(start(value, "SAME"));
    expect(value.getInterventionInstances()).toHaveLength(1); expect(value.getAssignedResources(patientId)).toHaveLength(2);
  });
  test("supported command boundary is idempotent and records one timeline event", () => {
    const exerciseId = "EX-ETT"; const value = engine();
    restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0, speed: 1,
      version: 1, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(value, exerciseId, patientId));
    const command = { commandId: "ETT-COMMAND", exerciseId, patientId, tubeResourceId: "ETT-75",
      laryngoscopeResourceId: "DL-1", device: "DIRECT" as const, tubeSize: 7.5, cuff: true,
      confirmation: true, issuedBy: "Case Manager" };
    expect(handleEndotrachealIntubationCommand(command)).toEqual(handleEndotrachealIntubationCommand(command));
    expect(value.getInterventionInstances()).toHaveLength(1); expect(getTimelineEvents(patientId)).toHaveLength(1);
  });
  test("stop releases the selected resources and removes secured airway", () => {
    const value = engine(); start(value, "STOP"); value.stopClinicalIntervention("STOP");
    expect(value.getAssignedResources(patientId)).toEqual([]); expect(value.getAirwayState(patientId).activeAirway).toBe("NONE");
  });
  test("checkpoint round trip preserves intervention, resources and airway", () => {
    const source = engine(); start(source, "PERSIST", "VL-1", "VIDEO", ["CO2-1"]);
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(source.captureRuntimePayload());
    expect(restored.getInterventionInstances()).toEqual(source.getInterventionInstances());
    expect(restored.getResourcePoolSnapshot()).toEqual(source.getResourcePoolSnapshot());
    expect(restored.getAirwayState(patientId)).toEqual(source.getAirwayState(patientId));
  });
  test("existing mechanical ventilation prerequisite accepts the canonical secured airway", () => {
    const value = engine(); const airway = start(value, "VENT-AIRWAY");
    const result = value.executeMechanicalVentilationCommand({ commandId: "VENT-START", action: "START",
      supportId: "VENT-1", patientId, simulationTimeSec: 0, securedAirwayId: airway.instanceId,
      settings: { mode: "VOLUME_CONTROL", respiratoryRate: 14, respiratoryRateUnit: "BREATHS_MIN",
        tidalVolumeMl: 500, tidalVolumeUnit: "ML", fio2: 0.6, peepCmH2O: 5, peepUnit: "CM_H2O" } });
    expect(result.status).toBe("APPLIED");
  });
  test("mechanical ventilation remains fail-closed without an ETT", () => {
    const value = engine();
    const result = value.executeMechanicalVentilationCommand({ commandId: "VENT-NO-AIRWAY", action: "START",
      supportId: "VENT-1", patientId, simulationTimeSec: 0, securedAirwayId: "MISSING",
      settings: { mode: "VOLUME_CONTROL", respiratoryRate: 14, respiratoryRateUnit: "BREATHS_MIN",
        tidalVolumeMl: 500, tidalVolumeUnit: "ML", fio2: 0.6, peepCmH2O: 5, peepUnit: "CM_H2O" } });
    expect(result.status).toBe("REJECTED");
  });
  test("no-ETT baseline capture is unchanged by the optional capability", () => {
    const value = engine(); const before = value.captureRuntimePayload();
    expect(value.captureRuntimePayload()).toEqual(before); expect(value.getAirwayState(patientId).activeAirway).toBe("NONE");
  });
});
