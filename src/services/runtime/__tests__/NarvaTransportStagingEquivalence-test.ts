import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { NARVA_TRAUMA_OXYGEN_PATIENT_DATASET } from "@/services/exercise/NarvaPatientDatasets";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";

const configuration = NARVA_TRAUMA_EXERCISE_PACKAGE.transportConfiguration!;
const initialLocations = Object.fromEntries(NARVA_TRAUMA_OXYGEN_PATIENT_DATASET.patients
  .map(item => [item.patient.id, item.patient.location]));
const fresh = () => new PatientTransportEngine(configuration, initialLocations);
const restore = (source: PatientTransportEngine) =>
  new PatientTransportEngine(configuration, {}, source.snapshot());
const onboardCount = (engine: PatientTransportEngine) => engine.snapshot().evidence
  .filter(item => item.type === "PATIENT_ONBOARD").length;
const arrivalCount = (engine: PatientTransportEngine) => engine.snapshot().evidence
  .filter(item => item.type === "TRANSPORT_ARRIVED").length;

describe("NARVA-TRANSPORT-STAGING-EQUIVALENCE-GUARDS-01 / TRANS-G17..G24", () => {
  test("loading materializes once through TRANSPORT_START and replay cannot duplicate authority", () => {
    const engine = fresh();
    const first = engine.start("P02-STAGING", "PT-CHEST-001", "NARVA-REANIMOBILE-01", "IVKH", 0);
    expect(engine.start("P02-STAGING", "PT-CHEST-001", "NARVA-REANIMOBILE-01", "IVKH", 0))
      .toEqual(first);
    expect(engine.snapshot()).toMatchObject({ patientLocations: { "PT-CHEST-001": "REANIMOBILE" },
      transports: [{ transportId: "TRANSPORT-P02-STAGING", state: "IN_TRANSIT" }],
      resources: [{ state: "OUTBOUND", phaseEndsAtSec: 1800 }] });
    expect(engine.snapshot().transports).toHaveLength(1);
    expect(onboardCount(engine)).toBe(1);
  });

  test("the stationary monitoring equivalence has one 1800-second phase deadline", () => {
    const engine = fresh();
    engine.start("P02-MONITOR", "PT-CHEST-001", "NARVA-REANIMOBILE-01", "IVKH", 0);
    engine.advanceTo(1799);
    expect(engine.snapshot()).toMatchObject({ currentSimulationTimeSec: 1799,
      patientLocations: { "PT-CHEST-001": "REANIMOBILE" },
      transports: [{ state: "IN_TRANSIT" }], resources: [{ state: "OUTBOUND", phaseEndsAtSec: 1800 }] });
    expect(arrivalCount(engine)).toBe(0);
    engine.advanceTo(1800);
    expect(engine.snapshot()).toMatchObject({ patientLocations: { "PT-CHEST-001": "IVKH" },
      transports: [{ state: "ARRIVED", arrivedAtSec: 1800 }] });
    expect(arrivalCount(engine)).toBe(1);
  });

  test("restart during stationary monitoring preserves identity, deadline and evidence cardinality", () => {
    const source = fresh();
    source.start("P02-RESTART", "PT-CHEST-001", "NARVA-REANIMOBILE-01", "IVKH", 0);
    source.advanceTo(900);
    const restarted = restore(source);
    expect(restarted.snapshot()).toMatchObject({ currentSimulationTimeSec: 900,
      patientLocations: { "PT-CHEST-001": "REANIMOBILE" },
      transports: [{ transportId: "TRANSPORT-P02-RESTART", state: "IN_TRANSIT" }],
      resources: [{ state: "OUTBOUND", phaseEndsAtSec: 1800 }] });
    expect(onboardCount(restarted)).toBe(1);
    restarted.advanceTo(1800);
    expect(arrivalCount(restarted)).toBe(1);
  });

  test("writer takeover crosses the stationary monitoring threshold exactly once", () => {
    const writer = fresh();
    writer.start("P02-TAKEOVER", "PT-CHEST-001", "NARVA-REANIMOBILE-01", "IVKH", 0);
    writer.advanceTo(1799);
    const takeover = restore(writer);
    takeover.advanceTo(1800);
    takeover.advanceTo(1800);
    expect(onboardCount(takeover)).toBe(1);
    expect(arrivalCount(takeover)).toBe(1);
    expect(takeover.snapshot().transports).toHaveLength(1);
  });

  test("P01 keeps the accepted ED-start policy and no duplicate staging authority exists", () => {
    expect(initialLocations["PT-PELVIC-001"]).toBe("NARVA_ED");
    const commandModel = readFileSync(resolve(process.cwd(), "src/models/RuntimePatientCommand.ts"), "utf8");
    const transportModel = readFileSync(resolve(process.cwd(), "src/models/PatientTransport.ts"), "utf8");
    const engineSource = readFileSync(resolve(process.cwd(),
      "src/services/runtime/PatientTransportEngine.ts"), "utf8");
    for (const source of [commandModel, transportModel, engineSource]) {
      expect(source).not.toContain("LOAD_REANIMOBILE");
      expect(source).not.toContain("TRANSPORT_MONITOR");
      expect(source).not.toContain("P01_MOVE_ED");
    }
    expect(commandModel.match(/"TRANSPORT_START"/g)).toHaveLength(1);
    expect(engineSource).toContain("phaseEndsAtSec: atSec + destination.travelDurationSec");
    expect(engineSource).not.toContain("ClinicalScenarioEngine");
  });
});
