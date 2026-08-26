import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import { PRESSURE_DEPENDENT_HEMORRHAGE_FLOW_V1, type HemorrhageConfiguration } from "@/models/HemorrhagePatientProcess";
import { SEVERE_OPEN_BOOK_PELVIC_SOURCE_CONTROL_V1 } from "@/modules/pelvicInjury/PelvicInjuryReference";
import { bootstrapHemorrhagePatientProcess, pressureDependentHemorrhageFactor, setHemorrhageEffects,
  tickHemorrhagePatientProcess } from "@/services/runtime/HemorrhagePatientProcess";

const configuration = (thoracic = false): HemorrhageConfiguration => ({
  baselineBleedingRateMlMin: thoracic ? 400 / 60 : 100,
  ...(thoracic ? { bleedingRateAfterPleuralDrainageMlMin: 400 / 60 } : { pelvicSourceControl: SEVERE_OPEN_BOOK_PELVIC_SOURCE_CONTROL_V1 }),
  pressureDependentFlow: PRESSURE_DEPENDENT_HEMORRHAGE_FLOW_V1,
  coagulation: { temperatureModifiers: [{ belowCelsius: 35, factor: 1.25 }, { belowCelsius: 34, factor: 1.5 }] },
  tourniquetEfficiency: 0.9, binderEfficiency: 0.6, infusionOffsetMlMin: 0, bloodProductOffsetMlMin: 0,
  severityThresholdsMl: [300, 700, 1200, 1800], perfusionThresholdsMl: [600, 1100, 1700],
  compensationThresholdsMl: [900, 1600], trendThresholdsMlMin: { worsening: 80, improving: 30 },
  vitalResponsePer1000Ml: { heartRateDelta: 35, systolicBpDelta: -35, diastolicBpDelta: -20, crtDelta: 2 },
});
const effect = (position: "CORRECT" | "INCORRECT" | "LOOSENED", timestamp = 0, id: string = position): ClinicalEffect => ({
  effectId: id, effectType: "PELVIC_STABILIZATION", encounterId: "PT-WP48A", patientId: "PT-WP48A", timestamp,
  sourceInterventionInstanceId: id, parameters: { position },
});
const start = (initialLoss = 0, thoracic = false) => bootstrapHemorrhagePatientProcess("PT-WP48A", {
  sourceId: thoracic ? "THORACIC" : "PELVIC", sourceType: thoracic ? "THORACIC" : "PELVIC",
  estimatedBloodLossMl: initialLoss, configuration: configuration(thoracic),
});
const rate = (process = start(), sbp = 100, temp = 36.8) =>
  tickHemorrhagePatientProcess(process, 0, sbp, temp).process.clinicalState.bleedingRateMlMin;

describe("WP-48A severe pelvic hemorrhage flow", () => {
  test.each([[100, 1], [90, 1], [80, 0.8], [70, 0.8], [60, 0.55], [50, 0.55], [40, 0.3], [30, 0.3]])
  ("SBP %s resolves deterministic factor %s", (sbp, expected) => {
    expect(pressureDependentHemorrhageFactor(configuration(), sbp)).toBe(expected);
  });

  test("pressure interpolation is continuous and resuscitation restores uncontrolled flow", () => {
    expect(pressureDependentHemorrhageFactor(configuration(), 65)).toBe(0.675);
    expect(Math.abs(pressureDependentHemorrhageFactor(configuration(), 64.99) - pressureDependentHemorrhageFactor(configuration(), 65.01))).toBeLessThan(0.001);
    const shock = tickHemorrhagePatientProcess(start(), 60, 60, 36.8).process;
    const resuscitated = tickHemorrhagePatientProcess(shock, 60, 100, 36.8).process;
    expect(shock.clinicalState.bleedingRateMlMin).toBe(55);
    expect(resuscitated.clinicalState.bleedingRateMlMin).toBe(100);
  });

  test("source-control states and maturation use canonical correct-application time", () => {
    const open = start();
    expect(rate(open)).toBe(100);
    expect(rate(setHemorrhageEffects(open, [effect("INCORRECT")]))).toBe(60);
    expect(rate(setHemorrhageEffects(open, [effect("LOOSENED")]))).toBe(50);
    let controlled = setHemorrhageEffects(tickHemorrhagePatientProcess(open, 600, 100, 36.8).process, [effect("CORRECT", 600)]);
    expect(rate(controlled)).toBe(20);
    controlled = tickHemorrhagePatientProcess(controlled, 1800, 100, 36.8).process; expect(rate(controlled)).toBe(12);
    controlled = tickHemorrhagePatientProcess(controlled, 3600, 100, 36.8).process; expect(rate(controlled)).toBe(8);
    controlled = tickHemorrhagePatientProcess(controlled, 5400, 100, 36.8).process; expect(rate(controlled)).toBe(6);
    expect(controlled.clinicalState.correctStabilizationStartedAtSec).toBe(600);
  });

  test("removal and loosening increase flow; correct reapplication resets maturation", () => {
    let process = setHemorrhageEffects(start(), [effect("CORRECT")]);
    process = tickHemorrhagePatientProcess(process, 5400, 100, 36.8).process;
    expect(rate(process)).toBe(8);
    process = setHemorrhageEffects(process, []); expect(rate(process)).toBe(100);
    process = setHemorrhageEffects(process, [effect("LOOSENED", 5400, "LOOSE")]); expect(rate(process)).toBe(50);
    process = setHemorrhageEffects(process, [effect("CORRECT", 5400, "REAPPLIED")]); expect(rate(process)).toBe(20);
    expect(process.clinicalState.correctStabilizationStartedAtSec).toBe(5400);
  });

  test("temperature is the only available canonical coagulation contributor", () => {
    expect(rate(start(), 100, 36.8)).toBe(100);
    expect(rate(start(), 100, 34.5)).toBe(125);
    expect(rate(start(), 100, 33.5)).toBe(150);
  });

  test("timer is deterministic across restart/takeover without history growth", () => {
    const applied = setHemorrhageEffects(start(), [effect("CORRECT", 0)]);
    const first = tickHemorrhagePatientProcess(applied, 1800, 100, 36.8).process;
    const continuous = tickHemorrhagePatientProcess(first, 60, 100, 36.8).process;
    const resumed = tickHemorrhagePatientProcess(structuredClone(first), 60, 100, 36.8).process;
    expect(resumed).toEqual(continuous);
    expect(resumed.clinicalState.activeEffects).toHaveLength(1);
    expect(resumed.clinicalState.correctStabilizationStartedAtSec).toBe(0);
  });

  test("thoracic 400 ml/h and initial 1450 ml remain unchanged", () => {
    const thoracic = start(1450, true);
    const adequate = tickHemorrhagePatientProcess(thoracic, 60, 100, 36.8).process;
    expect(adequate.clinicalState).toMatchObject({ cumulativeLossMl: 1456.666667, bleedingRateMlMin: 6.666667 });
    expect(thoracic.clinicalState.cumulativeLossMl).toBe(1450);
  });

  test("legacy configurations remain pressure and source-control independent", () => {
    const legacy = { ...configuration(), pressureDependentFlow: undefined, pelvicSourceControl: undefined, coagulation: undefined };
    const process = bootstrapHemorrhagePatientProcess("PT-LEGACY", { configuration: legacy });
    expect(tickHemorrhagePatientProcess(process, 60, 30, 33).process.clinicalState.bleedingRateMlMin).toBe(100);
  });

  test("an old WP-48A prototype checkpoint cannot crash revised SBP processing", () => {
    const restored = structuredClone(start());
    restored.configuration.pressureDependentFlow = { fullFlowMapMmHg: 80, floorMapMmHg: 20, minimumFlowFraction: 0.15 };
    expect(tickHemorrhagePatientProcess(restored, 60, 60, 36.8).process.clinicalState.bleedingRateMlMin).toBe(100);
  });
});
