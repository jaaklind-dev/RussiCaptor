import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { ScenarioEngineGoldenHarness } from "@/services/golden/ScenarioEngineGoldenHarness";

const fixture: GoldenFixture = {
  fixtureId: "FX-HV-MASKING", fixtureType: "PROCESS", seed: 101,
  clockState: "RUNNING", ownershipVersion: 1, activeResources: {},
  loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
  initialState: {
    hv: { templateId: "HV_NM_SEV", ventilationReserve: 52, co2Burden: 38 },
    hypoxia: { templateId: "HYP_HYPOVENT_MOD", oxygenationReserve: 58, spo2: 90 },
  },
};

function input(eventId: string, eventType: string, offsetSec: number, payload: Record<string, unknown>, actionId?: string): GoldenInputEvent {
  return { sequenceId: "SEQ-WP7", step: 1, offsetSec, eventType, actor: "ENGINE", target: "HV-MASKING", eventId, actionId, result: "SUCCESS", payload };
}

function replay(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  engine.advanceTo(0);
  engine.dispatch(input("O2", "ACTION", 0, {}, "OXYGEN_HIGH_FLOW"));
  engine.advanceTo(300);
  engine.dispatch(input("TICK", "ENGINE_TICK", 300, { elapsedMin: 5 }));
  return engine;
}

describe("WP-7 HV + Hypoxia integrated runtime", () => {
  test("ticks two independent processes and applies ownership once", () => {
    const engine = replay();
    const processes = engine.getPatientProcesses();
    expect(processes).toHaveLength(2);
    expect(processes.map(process => process.elapsedTime)).toEqual([300, 300]);
    expect(engine.getRuntimeState().runtimeFields).toMatchObject({
      CO2Trend: "WORSENING", SpO2Trend: "IMPROVING", SpO2Owner: "HYPOXIA_V1",
    });
    expect(engine.getRuntimeState().targetVitals.spo2).toBe(100);
    expect(engine.getEventLog().filter(event => event.eventType === "OXYGEN_MASKING_WARNING")).toHaveLength(1);
    expect(new Set(engine.getEventLog().map(event => event.sourceModule))).toEqual(new Set([
      "HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1",
    ]));
  });

  test("replay, process tree and event streams are deterministic", () => {
    const first = replay();
    const second = replay();
    expect(second.getRuntimeState()).toEqual(first.getRuntimeState());
    expect(second.getPatientProcesses()).toEqual(first.getPatientProcesses());
    expect(second.getEventLog()).toEqual(first.getEventLog());
    expect(second.getHashes()).toEqual(first.getHashes());
    expect(first.getEventLog().every(event => event.payload && typeof event.payload === "object" &&
      "sourceProcessId" in event.payload && "instanceKey" in event.payload)).toBe(true);
  });

  test("fixture process declaration order does not affect aggregation", () => {
    const reversed: GoldenFixture = {
      ...fixture,
      initialState: {
        hypoxia: { templateId: "HYP_HYPOVENT_MOD", oxygenationReserve: 58, spo2: 90 },
        hv: { templateId: "HV_NM_SEV", ventilationReserve: 52, co2Burden: 38 },
      },
    };
    const first = replay();
    const second = new ClinicalScenarioEngine();
    second.reset(reversed);
    second.advanceTo(0);
    second.dispatch(input("O2", "ACTION", 0, {}, "OXYGEN_HIGH_FLOW"));
    second.advanceTo(300);
    second.dispatch(input("TICK", "ENGINE_TICK", 300, { elapsedMin: 5 }));
    expect(second.getRuntimeState()).toEqual(first.getRuntimeState());
    expect(second.getHashes()).toEqual(first.getHashes());
  });

  test("creates one Hypoxia child despite repeated reevaluation", () => {
    const engine = new ClinicalScenarioEngine();
    engine.reset({ ...fixture, fixtureId: "FX-XMOD", initialState: {
      processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV_NM_SEV",
      ventilationReserve: 60, co2Burden: 50,
    }});
    engine.dispatch(input("HOLD", "THRESHOLD_HOLD", 0, { field: "ventilationReserve", value: 60, durationSec: 120 }));
    engine.dispatch(input("REEVAL-1", "TRIGGER_REEVALUATION", 30, {}));
    engine.dispatch(input("REEVAL-2", "TRIGGER_REEVALUATION", 90, {}));
    engine.advanceTo(180);
    expect(engine.getPatientProcesses().filter(process => process.processType === "HYPOXIA")).toHaveLength(1);
    expect(engine.getEventLog().filter(event => event.eventType === "HYPOVENTILATION_HYPOXIA_TRIGGERED")).toHaveLength(1);
    const checkpoint = new ScenarioEngineGoldenHarness(engine).checkpoint(180);
    expect(checkpoint.processTree).toHaveLength(1);
  });
});
