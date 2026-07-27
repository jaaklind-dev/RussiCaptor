import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { ScenarioEngineGoldenHarness } from "@/services/golden/ScenarioEngineGoldenHarness";

const fixture: GoldenFixture = {
  fixtureId: "FX-BOT-ROOT", fixtureType: "PATIENT", patientId: "PT-BOT", seed: 207,
  clockState: "RUNNING", ownershipVersion: 1, activeResources: {},
  loadedModules: ["BOTULISM_V1", "HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
  initialState: {
    PatientID: "PT-BOT",
    processAssignments: [
      { PatientProcessID: "PP-TOX", TemplateID: "BOT_TOX_VHIGH", ProcessType: "BOT_TOXIN_ACTIVITY", Status: "Active", InitialReserve: 95, ProgressionRate: 1.7, ParentProcessID: null, InstanceKey: "toxin" },
      { PatientProcessID: "PP-CRAN", TemplateID: "BOT_CRANIAL_SEV", ProcessType: "BOT_CRANIAL_BULBAR", Status: "Active", InitialReserve: 28, ProgressionRate: 2.4, ParentProcessID: "PP-TOX", InstanceKey: "cranial" },
      { PatientProcessID: "PP-RESP", TemplateID: "BOT_RESP_SEV", ProcessType: "BOT_RESPIRATORY_MUSCLE_FAILURE", Status: "Active", InitialReserve: 18, ProgressionRate: 3.8, ParentProcessID: "PP-TOX", InstanceKey: "resp" },
    ],
  },
};

function event(eventId: string, eventType: string, actionId?: string): GoldenInputEvent {
  return { sequenceId: "SEQ-BOT", step: 1, offsetSec: 0, eventType, actor: "ENGINE", target: "PT-BOT", eventId, actionId, result: "SUCCESS", payload: {} };
}

function replay(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  engine.advanceTo(120);
  engine.dispatch(event("ACTIVATE", "ENCOUNTER_ACTIVATE"));
  engine.advanceTo(240);
  engine.dispatch(event("PROGRESS", "PROGRESSION_CHECK"));
  return engine;
}

describe("WP-8 minimal Botulism root runtime", () => {
  test("bootstraps fixture-defined root and child lifecycle", () => {
    const engine = replay();
    const root = engine.getBotulismRoot();
    expect(root).toMatchObject({ processType: "BOTULISM_ROOT", state: "Active", elapsedTime: 240 });
    expect(root?.children.map(child => child.processId)).toEqual(["PP-CRAN", "PP-RESP", "PP-TOX"]);
    expect(root?.outputs.runtimeContributions).toEqual({});
    expect(engine.getPatientProcesses().map(process => process.processType)).toEqual([
      "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA",
    ]);
  });

  test("keeps orchestration, process tree and replay deterministic", () => {
    const first = replay();
    const second = replay();
    expect(second.getBotulismRoot()).toEqual(first.getBotulismRoot());
    expect(second.getPatientProcesses()).toEqual(first.getPatientProcesses());
    expect(second.getRuntimeState()).toEqual(first.getRuntimeState());
    expect(second.getEventLog()).toEqual(first.getEventLog());
    expect(second.getHashes()).toEqual(first.getHashes());
    expect(new ScenarioEngineGoldenHarness(second).checkpoint(240).processTree)
      .toEqual(new ScenarioEngineGoldenHarness(first).checkpoint(240).processTree);
  });

  test("preserves ownership and event attribution invariants", () => {
    const engine = replay();
    expect(engine.getRuntimeState().runtimeFields).toMatchObject({ SpO2Owner: "HYPOXIA_V1" });
    expect(engine.getRuntimeState().runtimeFields).not.toHaveProperty("directBotulismSpO2");
    expect(engine.getEventLog().every(item => item.payload && typeof item.payload === "object" &&
      "sourceProcessId" in item.payload && "instanceKey" in item.payload)).toBe(true);
  });
});
