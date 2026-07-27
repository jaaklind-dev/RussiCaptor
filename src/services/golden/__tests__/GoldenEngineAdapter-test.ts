import type {
  GoldenAssertion,
  GoldenFixture,
  GoldenInputEvent,
} from "@/models/GoldenTest";
import {
  createGoldenEngineAdapter,
  resolveGoldenQuery,
  type GoldenEngineHarness,
} from "@/services/golden/GoldenEngineAdapter";

const fixture: GoldenFixture = {
  fixtureId: "FX-1",
  fixtureType: "PATIENT",
  patientId: "PT-001",
  seed: 42,
  clockState: "RUNNING",
  ownerCm: "CM-1",
  ownershipVersion: 1,
  initialState: {},
  activeResources: {},
  loadedModules: ["CORE_ENGINE"],
};

function assertion(
  assertionId: string,
  checkpointSec: number,
  queryOrField: string,
  assertionType = "SNAPSHOT"
): GoldenAssertion {
  return {
    assertionId,
    assertionGroupId: "AG-1",
    testId: "T-1",
    assertionType,
    checkpointSec,
    queryOrField,
    comparator: "EQ",
    expectedValue: "",
    tolerance: 0,
    severity: "FATAL",
  };
}

describe("Golden engine adapter mapping", () => {
  test("resolves patient, wildcard, dotted and filtered query forms", () => {
    const checkpoint = {
      state: {
        entities: { "PT-001": { Resp: { RR: 28 } } },
        global: { HV: { ventilationReserve: 48.2 } },
        exercise: { patientCount: 12 },
        children: { HV_NM_SEV: [{ id: "PP-HV" }] },
        activeModules: [
          { module: "CORE_ENGINE", version: "1" },
          { module: "BOTULISM_V1", version: "1" },
        ],
      },
    };
    expect(resolveGoldenQuery("PT-001::Resp::RR", checkpoint)).toBe(28);
    expect(resolveGoldenQuery("*::HV::ventilationReserve", checkpoint)).toBe(48.2);
    expect(resolveGoldenQuery("exercise.patientCount", checkpoint)).toBe(12);
    expect(resolveGoldenQuery("activeModules[module=BOTULISM_V1]", checkpoint)).toEqual([
      { module: "BOTULISM_V1", version: "1" },
    ]);
    expect(resolveGoldenQuery("children[HV_NM_SEV]", checkpoint)).toEqual([{ id: "PP-HV" }]);
    expect(resolveGoldenQuery("PT-001::Resp::RR.value", {
      state: { entities: { "PT-001": { Resp: { RR: { value: 28 } } } } },
    })).toBe(28);
  });

  test("replays a clean fixture, maps each checkpoint separately and exposes semantic outputs", async () => {
    let time = 0;
    const calls: string[] = [];
    const harness: GoldenEngineHarness = {
      reset: ({ seed }) => { calls.push(`reset:${seed}`); time = 0; },
      advanceTo: (next) => { calls.push(`advance:${next}`); time = next; },
      dispatch: (event) => { calls.push(`event:${event.eventId}`); },
      checkpoint: (checkpointSec) => ({
        state: { entities: { "PT-001": { Resp: { RR: checkpointSec === 0 ? 18 : 28 } } } },
        processTree: [{
          parentProcessType: "BOT_RESPIRATORY_MUSCLE_FAILURE",
          parentProcessId: "PP-RESP",
          childProcessType: "HYPOVENTILATION_HYPERCAPNIA",
          childTemplateId: "HV_NM_SEV",
          status: "Active",
          instanceKey: "PP-RESP:hv",
        }],
      }),
      readEvents: () => [{ eventType: "ENGINE_TICK", simulationTime: time }],
      readHashes: () => ({ stateHash: "state", eventLogHash: "events", processTreeHash: "tree" }),
    };
    const events: GoldenInputEvent[] = [{
      sequenceId: "SEQ-1", step: 1, offsetSec: 60, eventType: "ENGINE_TICK",
      actor: "ENGINE", target: "PT-001", eventId: "EV-1", result: "SUCCESS", payload: {},
    }];
    const adapter = createGoldenEngineAdapter(harness);
    const output = await adapter.execute({
      test: {
        testId: "T-1", title: "Mapping", priority: "P0", fixtureId: "FX-1",
        eventSequenceId: "SEQ-1", assertionGroupId: "AG-1", deterministic: true, automated: true,
      },
      fixture,
      events,
      checkpoints: [0, 60],
      assertions: [
        assertion("AS-1", 0, "PT-001::Resp::RR"),
        assertion("AS-2", 60, "PT-001::Resp::RR"),
        assertion("AS-E", 60, "events[type=ENGINE_TICK]", "EVENT"),
        assertion("AS-P", 60, "processTree[template=HV_NM_SEV]", "PROCESS_TREE"),
      ],
    });

    expect(output.checkpointValues).toEqual({
      "0": { "PT-001::Resp::RR": 18 },
      "60": { "PT-001::Resp::RR": 28 },
    });
    expect(output.processTree).toHaveLength(2);
    expect(output.processTree?.[1]).toMatchObject({ checkpointSec: 60, childTemplateId: "HV_NM_SEV" });
    expect(output).toMatchObject({ stateHash: "state", eventLogHash: "events", processTreeHash: "tree" });
    expect(calls).toEqual(["reset:42", "advance:0", "advance:60", "event:EV-1"]);
  });

  test("blocks explicitly when the engine snapshot cannot satisfy a mapped assertion", async () => {
    const adapter = createGoldenEngineAdapter({
      reset: () => undefined,
      advanceTo: () => undefined,
      dispatch: () => undefined,
      checkpoint: () => ({ state: {} }),
      readEvents: () => [],
    });
    await expect(adapter.execute({
      test: {
        testId: "T-1", title: "Missing", priority: "P0", fixtureId: "FX-1",
        eventSequenceId: "SEQ-1", assertionGroupId: "AG-1", deterministic: true, automated: true,
      },
      fixture,
      events: [],
      checkpoints: [0],
      assertions: [assertion("AS-MISSING", 0, "PT-001::Resp::RR")],
    })).rejects.toThrow("ENGINE_ADAPTER_MAPPING_MISSING: AS-MISSING=PT-001::Resp::RR@0");
  });
});
