import type {
  GoldenAssertion,
  GoldenComparator,
  GoldenExpectedEvent,
  GoldenFixture,
  GoldenInputEvent,
  GoldenWorkbook,
} from "@/models/GoldenTest";
import { createGoldenEngineAdapter } from "@/services/golden/GoldenEngineAdapter";
import { ScenarioEngineGoldenHarness } from "@/services/golden/ScenarioEngineGoldenHarness";
import { executeGoldenTests } from "@/services/golden/GoldenTestExecutor";

const baseInitialState = {
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
};

function fixture(fixtureId: string, initialState: Record<string, unknown> = baseInitialState): GoldenFixture {
  return {
    fixtureId, fixtureType: "PROCESS", seed: 101, clockState: "RUNNING",
    ownerCm: "CM-TEST", ownershipVersion: 1, initialState, activeResources: {},
    loadedModules: ["CORE_ENGINE", "HYPOXIA_V1", "HYPOVENTILATION_HYPERCAPNIA_V1"],
  };
}

function event(
  sequenceId: string,
  step: number,
  offsetSec: number,
  eventType: string,
  target: string,
  eventId: string,
  payload: Record<string, unknown>,
  actionId?: string
): GoldenInputEvent {
  return {
    sequenceId, step, offsetSec, eventType, actor: "ENGINE", target, eventId,
    actionId, result: "SUCCESS", payload,
  };
}

function assertion(
  assertionId: string,
  testId: string,
  assertionType: string,
  checkpointSec: number,
  queryOrField: string,
  comparator: GoldenComparator,
  expectedValue: string,
  tolerance = 0
): GoldenAssertion {
  return {
    assertionId, assertionGroupId: `AG-${testId}`, testId, assertionType,
    checkpointSec, queryOrField, comparator, expectedValue, tolerance,
    severity: "FATAL", sourceRef: "RussiCaptor_Golden_Test_Pack_v1.xlsx",
  };
}

type HvCase = {
  testId: string;
  fixture: GoldenFixture;
  events: GoldenInputEvent[];
  assertions: GoldenAssertion[];
  expectedEvents?: GoldenExpectedEvent[];
};

const tick60 = (sequenceId: string) => event(
  sequenceId, 2, 60, "ENGINE_TICK", "HV-NM-SEV", `${sequenceId}-TICK`, { tickMin: 1 }
);

const cases: HvCase[] = [
  {
    testId: "HV-001",
    fixture: fixture("FX-HV-NM-SEV"),
    events: [event("SEQ-TICK-60", 1, 60, "ENGINE_TICK", "HV-NM-SEV", "EV-HV-TICK-001", { tickMin: 1 })],
    assertions: [
      assertion("AS-0016", "HV-001", "SNAPSHOT", 60, "*::HV::ventilationReserve", "NEAR", "48.2", 0.001),
      assertion("AS-0017", "HV-001", "SNAPSHOT", 60, "*::HV::co2Burden", "NEAR", "42.0", 0.001),
    ],
  },
  {
    testId: "HV-002",
    fixture: fixture("FX-HV-NM-SEV"),
    events: [
      event("SEQ-HV-O2", 1, 0, "ACTION", "HV-NM-SEV", "EV-HV-O2-001", {}, "OXYGEN_HIGH_FLOW"),
      tick60("SEQ-HV-O2"),
    ],
    assertions: [
      assertion("AS-0018", "HV-002", "SNAPSHOT", 60, "*::HV::ventilationReserve", "NEAR", "48.2", 0.001),
      assertion("AS-0019", "HV-002", "SNAPSHOT", 60, "*::HV::co2Burden", "NEAR", "42.0", 0.001),
      assertion("AS-0154", "HV-002", "OWNERSHIP", 60, "HV.directOxygenEffectOnCO2", "EQ", "0"),
    ],
  },
  {
    testId: "HV-003",
    fixture: fixture("FX-HV-NM-SEV"),
    events: [
      event("SEQ-HV-INTUBATE", 1, 0, "ACTION", "HV-NM-SEV", "EV-HV-INT-001", {}, "INTUBATION"),
      tick60("SEQ-HV-INTUBATE"),
    ],
    assertions: [
      assertion("AS-0020", "HV-003", "SNAPSHOT", 60, "*::HV::airwayProtected", "EQ", "TRUE"),
      assertion("AS-0021", "HV-003", "SNAPSHOT", 60, "*::HV::ventilationReserve", "NEAR", "48.2", 0.001),
      assertion("AS-0022", "HV-003", "SNAPSHOT", 60, "*::HV::co2Burden", "NEAR", "42.0", 0.001),
      assertion("AS-0155", "HV-003", "ACTION", 60, "airwayProtected", "EQ", "TRUE"),
      assertion("AS-0156", "HV-003", "ACTION", 60, "effectiveVentilationActive", "EQ", "FALSE"),
    ],
  },
  {
    testId: "HV-004",
    fixture: fixture("FX-HV-NM-SEV"),
    events: [
      event("SEQ-HV-BVM", 1, 0, "ACTION", "HV-NM-SEV", "EV-HV-BVM-001", {}, "BVM_VENTILATION"),
      tick60("SEQ-HV-BVM"),
    ],
    assertions: [
      assertion("AS-0023", "HV-004", "SNAPSHOT", 60, "*::HV::ventilationReserve", "NEAR", "53.62", 0.001),
      assertion("AS-0024", "HV-004", "SNAPSHOT", 60, "*::HV::co2Burden", "NEAR", "34.4", 0.001),
      assertion("AS-0157", "HV-004", "ACTION", 60, "ventilationEffectCount", "EQ", "1"),
    ],
  },
  {
    testId: "HV-005",
    fixture: fixture("FX-HV-NM-SEV"),
    events: [
      event("SEQ-HV-VENT", 1, 0, "ACTION", "HV-NM-SEV", "EV-HV-VENT-001", {}, "MECHANICAL_VENTILATION"),
      tick60("SEQ-HV-VENT"),
    ],
    assertions: [
      assertion("AS-0025", "HV-005", "SNAPSHOT", 60, "*::HV::ventilationReserve", "NEAR", "54.0", 0.001),
      assertion("AS-0026", "HV-005", "SNAPSHOT", 60, "*::HV::co2Burden", "NEAR", "33.5", 0.001),
      assertion("AS-0027", "HV-005", "SNAPSHOT", 60, "*::HV::causeControlled", "EQ", "TRUE"),
      assertion("AS-0100", "HV-005", "EVENT", 1, "events[type=PROCESS_CONTROLLED;target=HV-NM-SEV]", "COUNT_EQ", "1"),
      assertion("AS-0158", "HV-005", "ACTION", 60, "definitiveControl", "EQ", "TRUE"),
    ],
    expectedEvents: [{
      testId: "HV-005", expectedOrder: 1, eventType: "PROCESS_CONTROLLED", expectedCount: 1,
      sourceModule: "HYPOVENTILATION_HYPERCAPNIA_V1", target: "HV-NM-SEV",
      required: true, mustNotExist: false, attributionRule: "ProcessID",
    }],
  },
  {
    testId: "HV-007",
    fixture: fixture("FX-HV-CO2-76", {
      processType: "HYPOVENTILATION_HYPERCAPNIA", ventilationReserve: 35,
      co2Burden: 76, status: "Active",
    }),
    events: [event(
      "SEQ-HV-CO2-76", 1, 0, "THRESHOLD_HOLD", "HV-CO2-76", "EV-HV-CO2-001",
      { field: "co2Burden", value: 76, durationSec: 60 }
    )],
    assertions: [
      assertion("AS-0030", "HV-007", "SNAPSHOT", 60, "*::RuntimeState::mentalStatusSourceModule", "EQ", "HYPOVENTILATION_HYPERCAPNIA_V1"),
      assertion("AS-0102", "HV-007", "EVENT", 1, "events[type=CO2_NARCOSIS_TRIGGERED;target=HV-CO2-76]", "COUNT_EQ", "1"),
      assertion("AS-0160", "HV-007", "OWNERSHIP", 60, "mentalStatusSourceProcessType", "EQ", "HYPOVENTILATION_HYPERCAPNIA"),
    ],
    expectedEvents: [{
      testId: "HV-007", expectedOrder: 1, eventType: "CO2_NARCOSIS_TRIGGERED", expectedCount: 1,
      sourceModule: "HYPOVENTILATION_HYPERCAPNIA_V1", target: "HV-CO2-76",
      required: true, mustNotExist: false, attributionRule: "HV sourceProcessID",
    }],
  },
  {
    testId: "HV-008",
    fixture: fixture("FX-HV-RESERVE-0", {
      processType: "HYPOVENTILATION_HYPERCAPNIA", ventilationReserve: 0,
      co2Burden: 100, zeroSinceSec: 0, status: "Active",
    }),
    events: [event(
      "SEQ-HV-ARREST", 1, 0, "THRESHOLD_HOLD", "HV-RESERVE-0", "EV-HV-ARREST-001",
      { field: "ventilationReserve", value: 0, durationSec: 60 }
    )],
    assertions: [
      assertion("AS-0031", "HV-008", "SNAPSHOT", 59, "*::HV::respiratoryArrest", "EQ", "FALSE"),
      assertion("AS-0032", "HV-008", "SNAPSHOT", 60, "*::HV::respiratoryArrest", "EQ", "TRUE"),
      assertion("AS-0103", "HV-008", "EVENT", 1, "events[type=RESPIRATORY_ARREST;target=HV-RESERVE-0]", "COUNT_EQ", "1"),
      assertion("AS-0161", "HV-008", "EVENT", 59, "events[type=RESPIRATORY_ARREST]", "COUNT_EQ", "0"),
    ],
    expectedEvents: [{
      testId: "HV-008", expectedOrder: 1, eventType: "RESPIRATORY_ARREST", expectedCount: 1,
      sourceModule: "HYPOVENTILATION_HYPERCAPNIA_V1", target: "HV-RESERVE-0",
      required: true, mustNotExist: false, attributionRule: "HV sourceProcessID",
    }],
  },
];

function workbookFor(item: HvCase): GoldenWorkbook {
  return {
    packId: "RC-GOLDEN-TEST-PACK-001", packVersion: "1.0",
    tests: [{
      testId: item.testId, title: item.testId, priority: "P0",
      fixtureId: item.fixture.fixtureId, eventSequenceId: item.events[0].sequenceId,
      assertionGroupId: `AG-${item.testId}`, deterministic: true, automated: true,
    }],
    fixtures: [item.fixture], eventSequences: item.events, assertions: item.assertions,
    expectedSnapshots: [], expectedEvents: item.expectedEvents ?? [], expectedProcessTree: [], sheets: {},
  };
}

describe("WP-6 complete HV P0 Golden suite", () => {
  test.each(cases.map((item) => [item.testId, item] as const))(
    "%s passes with deterministic replay and content hashes",
    async (_testId, item) => {
      const report = await executeGoldenTests(
        workbookFor(item), createGoldenEngineAdapter(new ScenarioEngineGoldenHarness()),
        { runId: `RUN-${item.testId}`, now: () => new Date("2026-07-27T13:00:00.000Z") }
      );
      const result = report.tests[0];
      expect(result.status).toBe("PASS");
      expect(result.assertionResults.every((assertionResult) => assertionResult.status === "PASS")).toBe(true);
      expect(result.eventComparison.status).toBe("PASS");
      expect(result.replayComparison).toEqual({ status: "PASS", failures: [] });
      expect(result.stateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.eventLogHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.processTreeHash).toMatch(/^[a-f0-9]{64}$/);
    }
  );
});
