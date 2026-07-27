import type {
  GoldenAssertion,
  GoldenFixture,
  GoldenInputEvent,
  GoldenWorkbook,
} from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { createGoldenEngineAdapter } from "@/services/golden/GoldenEngineAdapter";
import { goldenReportJson } from "@/services/golden/GoldenReportWriter";
import { ScenarioEngineGoldenHarness } from "@/services/golden/ScenarioEngineGoldenHarness";
import { executeGoldenTests } from "@/services/golden/GoldenTestExecutor";

const fixture: GoldenFixture = {
  fixtureId: "FX-HV-NM-SEV",
  fixtureType: "PROCESS",
  seed: 101,
  clockState: "RUNNING",
  ownerCm: "CM-TEST",
  ownershipVersion: 1,
  initialState: {
    processType: "HYPOVENTILATION_HYPERCAPNIA",
    templateId: "HV_NM_SEV",
    responseProfile: "RESP_NEUROMUSCULAR",
    ventilationReserve: 52,
    reserveLossPerMin: 3.8,
    co2Burden: 38,
    co2GainPerMin: 4,
    causeControlled: false,
    definitiveControl: false,
    airwayOpen: true,
    status: "Active",
  },
  activeResources: {},
  loadedModules: [
    "CORE_ENGINE", "HYPOXIA_V1", "HYPOVENTILATION_HYPERCAPNIA_V1",
    "BOTULISM_V1", "BOTULISM_EXERCISE_V1_4",
  ],
};

const tick: GoldenInputEvent = {
  sequenceId: "SEQ-TICK-60",
  step: 1,
  offsetSec: 60,
  eventType: "ENGINE_TICK",
  actor: "ENGINE",
  target: "HV-NM-SEV",
  eventId: "EV-HV-TICK-001",
  result: "SUCCESS",
  payload: { tickMin: 1 },
};

const assertions: GoldenAssertion[] = [{
  assertionId: "AS-0016",
  assertionGroupId: "AG-HV-001",
  testId: "HV-001",
  assertionType: "SNAPSHOT",
  checkpointSec: 60,
  queryOrField: "*::HV::ventilationReserve",
  comparator: "NEAR",
  expectedValue: "48.2",
  tolerance: 0.001,
  severity: "FATAL",
  sourceRef: "NumericGolden",
}, {
  assertionId: "AS-0017",
  assertionGroupId: "AG-HV-001",
  testId: "HV-001",
  assertionType: "SNAPSHOT",
  checkpointSec: 60,
  queryOrField: "*::HV::co2Burden",
  comparator: "NEAR",
  expectedValue: "42.0",
  tolerance: 0.001,
  severity: "FATAL",
  sourceRef: "NumericGolden",
}];

function workbook(): GoldenWorkbook {
  return {
    packId: "RC-GOLDEN-TEST-PACK-001",
    packVersion: "1.0",
    tests: [{
      testId: "HV-001",
      title: "HV_NM_SEV untreated 1 min",
      priority: "P0",
      fixtureId: fixture.fixtureId,
      eventSequenceId: tick.sequenceId,
      assertionGroupId: "AG-HV-001",
      deterministic: true,
      automated: true,
    }],
    fixtures: [fixture],
    eventSequences: [tick],
    assertions,
    expectedSnapshots: [],
    expectedEvents: [],
    expectedProcessTree: [],
    sheets: {},
  };
}

function executeEngine(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  engine.advanceTo(60);
  engine.dispatch(tick);
  return engine;
}

describe("WP-5 first clinical golden run", () => {
  test("HV-001 passes through ScenarioEngine, aggregation, adapter and GoldenRunner", async () => {
    const report = await executeGoldenTests(
      workbook(),
      createGoldenEngineAdapter(new ScenarioEngineGoldenHarness()),
      {
        runId: "RUN-HV-001",
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      }
    );

    expect(report.tests).toHaveLength(1);
    expect(report.tests[0].status).toBe("PASS");
    expect(report.tests[0].assertionResults).toEqual([
      expect.objectContaining({ assertionId: "AS-0016", status: "PASS", actual: 48.2 }),
      expect.objectContaining({ assertionId: "AS-0017", status: "PASS", actual: 42 }),
    ]);
    expect(report.tests[0].replayComparison).toEqual({ status: "PASS", failures: [] });
    expect(goldenReportJson(report)).toContain('"testId": "HV-001"');
  });

  test("two clean replays have identical state, PatientProcess, event log and hashes", () => {
    const first = executeEngine();
    const second = executeEngine();

    expect(second.getRuntimeState()).toEqual(first.getRuntimeState());
    expect(second.getPatientProcess()).toEqual(first.getPatientProcess());
    expect(second.getEventLog()).toEqual(first.getEventLog());
    expect(second.getHashes()).toEqual(first.getHashes());
    expect(first.getHashes().replayHash).toHaveLength(64);
  });

  test("keeps PatientProcess and aggregation invariants", () => {
    const engine = executeEngine();
    const process = engine.getPatientProcess();
    const state = engine.getRuntimeState();

    expect(process).toMatchObject({
      processId: "HV_NM_SEV",
      instanceKey: "HV_NM_SEV:primary",
      state: "Active",
      elapsedTime: 60,
      nextTick: 120,
      clinicalState: { ventilationReserve: 48.2, co2Burden: 42 },
      outputs: {
        moduleId: "HYPOVENTILATION_HYPERCAPNIA_V1",
        runtimeContributions: { ventilationReserve: 48.2, co2Burden: 42 },
      },
    });
    expect(state).toMatchObject({
      stateVersion: 1,
      exerciseTimeSec: 60,
      globalStatus: "Stable",
      dominantProcessId: "HV_NM_SEV",
      runtimeFields: { ventilationReserve: 48.2, co2Burden: 42 },
      aggregationConfigVersion: "WP-6/HV-P0",
    });
    expect(engine.getEventLog()).toEqual([expect.objectContaining({
      eventType: "ENGINE_TICK_APPLIED",
      sourceModule: "HYPOVENTILATION_HYPERCAPNIA_V1",
      target: "HV_NM_SEV",
      simulationTime: 60,
      sequence: 1,
      payload: expect.objectContaining({ sourceProcessId: "HV_NM_SEV" }),
    })]);
  });
});
