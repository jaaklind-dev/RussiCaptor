import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const fixture: GoldenFixture = {
  fixtureId: "FX-LONG-RUN", fixtureType: "PROCESS", seed: 801,
  clockState: "RUNNING", ownershipVersion: 1, activeResources: {},
  loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
  initialState: {
    hv: { templateId: "HV_NM_SEV", ventilationReserve: 70, co2Burden: 20 },
    hypoxia: { templateId: "HYP_HYPOVENT_MOD", oxygenationReserve: 70, spo2: 94 },
  },
};

function runTicks(count: number): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  for (let index = 1; index <= count; index += 1) {
    engine.advanceTo(index);
    const event: GoldenInputEvent = {
      sequenceId: "SEQ-LONG", step: index, offsetSec: index, eventType: "ENGINE_TICK",
      actor: "ENGINE", target: "HV-LONG", eventId: `TICK-${index}`,
      result: "SUCCESS", payload: { tickMin: 1 / 60 },
    };
    engine.dispatch(event);
  }
  return engine;
}

describe("WP-8A runtime hardening", () => {
  jest.setTimeout(30_000);

  test("10 000 ticks remain deterministic within memory and performance budgets", () => {
    const runtimeProcess = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } }).process;
    const beforeHeap = runtimeProcess?.memoryUsage?.().heapUsed ?? 0;
    const started = Date.now();
    const first = runTicks(10_000);
    const firstDurationMs = Date.now() - started;
    const afterFirstHeap = runtimeProcess?.memoryUsage?.().heapUsed ?? beforeHeap;
    const second = runTicks(10_000);
    const totalDurationMs = Date.now() - started;

    expect(second.getRuntimeState()).toEqual(first.getRuntimeState());
    expect(second.getPatientProcesses()).toEqual(first.getPatientProcesses());
    expect(second.getEventLog()).toEqual(first.getEventLog());
    expect(second.getHashes()).toEqual(first.getHashes());
    expect(first.getEventLog()).toHaveLength(20_000);
    expect(firstDurationMs).toBeLessThan(15_000);
    expect(totalDurationMs).toBeLessThan(30_000);
    expect(afterFirstHeap - beforeHeap).toBeLessThan(128 * 1024 * 1024);
  });

  test("canonical replay hash input is independent of object insertion order", () => {
    const left = { z: 1, a: { y: [3, 2, 1], x: "Ω" } };
    const right = { a: { x: "Ω", y: [3, 2, 1] }, z: 1 };
    const expected = "ce6d0655e26f55b0b031a33a34c6a29862bb84ae9033b03d7585b915c357e554";
    expect(sha256Text(stableJson(left))).toBe(expected);
    expect(sha256Text(stableJson(right))).toBe(expected);
  });
});
