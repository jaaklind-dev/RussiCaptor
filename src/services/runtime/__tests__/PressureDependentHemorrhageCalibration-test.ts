import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { PRESSURE_DEPENDENT_HEMORRHAGE_FLOW_V1 } from "@/models/HemorrhagePatientProcess";
import { SEVERE_OPEN_BOOK_PELVIC_SOURCE_CONTROL_V1 } from "@/modules/pelvicInjury/PelvicInjuryReference";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture } from "@/services/exercise/CanonicalPatientDatasets";

type Treatment = "UNTREATED" | "EARLY" | "DELAYED";
type Point = Readonly<{ minute: number; lossMl: number; baseRate: number; effectiveRate: number; map: number; sbp: number;
  dbp: number; hr: number; shockIndex: number; gcs: number; spo2?: number; signal: string; clinicalState: string }>;

const patientId = "PT-PELVIC-001";
const sampleMinutes = new Set([0, 5, 10, 15, 20, 30, 45, 60]);

function fixture(baseRate: number): GoldenFixture {
  const value = structuredClone(mtpReferenceFixture);
  const initial = value.initialState as Record<string, unknown>;
  delete initial.hypoxia;
  const sources = structuredClone(initial.hemorrhageSources) as Record<string, unknown>[];
  const configuration = sources[0].configuration as Record<string, unknown>;
  sources[0].configuration = { ...configuration, baselineBleedingRateMlMin: baseRate,
    pressureDependentFlow: PRESSURE_DEPENDENT_HEMORRHAGE_FLOW_V1,
    pelvicSourceControl: { ...SEVERE_OPEN_BOOK_PELVIC_SOURCE_CONTROL_V1, openRateMlMin: baseRate },
    coagulation: { temperatureModifiers: [{ belowCelsius: 35, factor: 1.25 }, { belowCelsius: 34, factor: 1.5 }] } };
  return { ...value, fixtureId: `FX-WP48A-CAL-${baseRate}`, initialState: { ...initial, hemorrhageSources: sources,
    physiologicDecompensationEnabled: true } };
}

function event(step: number, minute: number, eventType: GoldenInputEvent["eventType"], eventId: string,
  actionId?: string, payload: Readonly<Record<string, unknown>> = {}): GoldenInputEvent {
  return { sequenceId: "WP48A-CAL", step, offsetSec: minute * 60, eventType, actor: eventType === "ENGINE_TICK" ? "ENGINE" : "EXCON",
    target: patientId, eventId, ...(actionId ? { actionId } : {}), result: "SUCCESS", payload };
}

function point(engine: ClinicalScenarioEngine, minute: number): Point {
  const state = engine.getRuntimeState();
  const hemorrhage = engine.getPatientProcesses().find(item => item.processType === "HEMORRHAGE")!;
  const clinical = hemorrhage.clinicalState as Readonly<Record<string, unknown>>;
  const vitals = state.vitalSignState!;
  return { minute, lossMl: Number(clinical.cumulativeLossMl), baseRate: Number(clinical.baseSourceRateMlMin ?? clinical.bleedingRateMlMin),
    effectiveRate: Number(clinical.bleedingRateMlMin), map: vitals.derived.meanArterialPressure,
    sbp: vitals.readings.systolicBp.current, dbp: vitals.readings.diastolicBp.current,
    hr: vitals.readings.heartRate.current, shockIndex: vitals.derived.shockIndex, gcs: vitals.readings.gcs.current,
    ...(vitals.pulseOx?.measuredSpO2 === undefined ? {} : { spo2: vitals.pulseOx.measuredSpO2 }),
    signal: vitals.pulseOx?.signalQuality ?? "UNKNOWN", clinicalState: state.physiologicDecompensation?.clinicalState ?? "ALIVE" };
}

function trajectory(baseRate: number, treatment: Treatment): readonly Point[] {
  const engine = new ClinicalScenarioEngine(); engine.reset(fixture(baseRate));
  engine.scheduleIntervention({ interventionId: "PIV-CAL", patientId, resourceId: "PIV-1", action: "APPLY", timestamp: 0,
    definitionId: "PERIPHERAL_IV_ACCESS", parameters: { location: "arm", gauge: 18, attempts: 1 } });
  engine.scheduleIntervention({ interventionId: "PIV-CAL-2", patientId, resourceId: "PIV-2", action: "APPLY", timestamp: 0,
    definitionId: "PERIPHERAL_IV_ACCESS", parameters: { location: "arm", gauge: 16, attempts: 1 } });
  engine.applyScheduledResourceInterventionsAtCurrentTime();
  const treatmentMinute = treatment === "EARLY" ? 10 : treatment === "DELAYED" ? 30 : undefined;
  const result: Point[] = [point(engine, 0)];
  for (let minute = 1; minute <= 60; minute += 1) {
    if (minute === treatmentMinute) {
      engine.scheduleIntervention({ interventionId: `BINDER-${treatment}`, patientId, resourceId: "PB-1", action: "APPLY",
        timestamp: minute * 60, definitionId: "PELVIC_BINDER_APPLICATION", parameters: {} });
      engine.applyScheduledResourceInterventionsAtCurrentTime();
      engine.dispatch(event(minute * 10 + 1, minute, "ACTION", `MTP-${treatment}`, "MTP_ACTIVATION"));
    }
    if (treatmentMinute !== undefined && [treatmentMinute, treatmentMinute + 10, treatmentMinute + 20].includes(minute)) {
      engine.dispatch(event(minute * 10 + 2, minute, "ACTION", `RBC-${treatment}-${minute}`, "RBC_ADMINISTRATION",
        { units: 1, deliveryMode: "RAPID_INFUSER", vascularAccessLineId: "IV-1" }));
      engine.dispatch(event(minute * 10 + 4, minute, "ACTION", `PLASMA-${treatment}-${minute}`, "PLASMA_ADMINISTRATION",
        { units: 1, deliveryMode: "RAPID_INFUSER", vascularAccessLineId: "IV-2" }));
    }
    engine.advanceTo(minute * 60);
    engine.dispatch(event(minute * 10 + 3, minute, "ENGINE_TICK", `TICK-${minute}`, undefined, { tickMin: 1 }));
    if (sampleMinutes.has(minute)) result.push(point(engine, minute));
  }
  return result;
}

describe("WP-48A pelvic candidate calibration", () => {
  test("approved base 100 produces deterministic untreated, early and delayed trajectories", () => {
    const base = 100;
    for (const treatment of ["UNTREATED", "EARLY", "DELAYED"] as const) {
      const first = trajectory(base, treatment); const replay = trajectory(base, treatment);
      expect(replay).toEqual(first);
      expect(first.every((item, index) => Number.isFinite(item.lossMl) && (index === 0 || item.lossMl >= first[index - 1].lossMl))).toBe(true);
    }
  });

  test("same early treatment improves perfusion while cumulative loss remains monotonic", () => {
    for (const base of [100]) {
      const untreated = trajectory(base, "UNTREATED").at(-1)!;
      const earlyTrajectory = trajectory(base, "EARLY"); const early = earlyTrajectory.at(-1)!;
      expect(early.lossMl).toBeGreaterThanOrEqual(earlyTrajectory.at(-2)!.lossMl);
      expect(early.map).toBeGreaterThanOrEqual(untreated.map);
    }
  });

  test("transfusion and source control compose without changing the configured base source rate", () => {
    const early = trajectory(100, "EARLY");
    const before = early.find(item => item.minute === 10)!;
    const after = early.find(item => item.minute === 15)!;
    expect(after.baseRate).toBe(before.baseRate);
    expect(after.effectiveRate).toBeLessThan(after.baseRate);
    expect(early.at(-1)!.clinicalState).not.toBe("DEAD");
  });

  test("calibration matrix remains inspectable without changing the Narva package", () => {
    const matrix = [100].flatMap(base => (["UNTREATED", "EARLY", "DELAYED"] as const)
      .map(treatment => ({ base, treatment, points: trajectory(base, treatment) })));
    expect(matrix).toHaveLength(3);
    expect(matrix.every(row => row.points.map(item => item.minute).join(",") === "0,5,10,15,20,30,45,60")).toBe(true);
  });
});
