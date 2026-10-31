import { NarvaIroScenarioRuntime } from "../NarvaIroScenarioRuntime";

const runtime = () => { const value = new NarvaIroScenarioRuntime(); value.reset("PT-IRO-001"); return value; };

describe("WP-NARVA-02 deterministic IRO fault and recovery process", () => {
  test("combined faults freeze during HOLD and cross the boundary only after RESUME", () => {
    const value = runtime(); value.triggerVasopressorFault(0);
    value.triggerVentilationFault("HIGH_PRESSURE_KINK", 10); value.setHold(true, 40);
    expect(value.advanceTo(200)).toMatchObject({ hold: true, arrest: false });
    value.setHold(false, 200);
    expect(value.advanceTo(260).arrest).toBe(false);
    expect(value.advanceTo(261)).toMatchObject({ arrest: true, arrestCause: "COMBINED" });
  });

  test.each([30, 60, 120])("vasopressor recovery from %ss freezes across repeated HOLD and restore", correction => {
    const value = runtime(); value.triggerVasopressorFault(0); value.correctVasopressor(correction);
    const before = value.setHold(true, correction + 10);
    const restored = runtime(); restored.restore(value.snapshot());
    expect(restored.advanceTo(1000).vasopressorStage).toBe(before.vasopressorStage);
    restored.setHold(false, 1000); restored.setHold(true, 1010); restored.setHold(false, 2000);
    const duration = correction < 60 ? 120 : correction < 120 ? 180 : 300;
    expect(restored.advanceTo(2000 + duration - 21).vasopressorStage).toBe(before.vasopressorStage);
    expect(restored.advanceTo(2000 + duration - 20).vasopressorStage).toBe("S0");
  });

  test.each(["CIRCUIT_DISCONNECT", "HIGH_PRESSURE_KINK", "OXYGEN_DEPLETION", "VENTILATOR_STOP"] as const)(
    "%s recovery excludes HOLD and restores deterministically", fault => {
      const value = runtime(); value.triggerVentilationFault(fault, 0); value.correctVentilation(40);
      value.setHold(true, 60); const restored = runtime(); restored.restore(value.snapshot());
      expect(restored.advanceTo(500).ventilationStage).toBe("RECOVERING");
      restored.setHold(false, 500);
      expect(restored.advanceTo(659).ventilationStage).toBe("RECOVERING");
      expect(restored.advanceTo(660).ventilationStage).toBe("NORMAL");
    });

  test("a fault started and corrected while held cannot advance either clock", () => {
    const value = runtime(); value.setHold(true, 0); value.triggerVasopressorFault(10);
    expect(value.advanceTo(1000)).toMatchObject({ arrest: false, vasopressorStage: "S0" });
    value.correctVasopressor(1000);
    expect(value.advanceTo(2000).vasopressorStage).toBe("S1R");
    value.setHold(false, 2000);
    expect(value.advanceTo(2119).vasopressorStage).toBe("S1R");
    expect(value.advanceTo(2120).vasopressorStage).toBe("S0");
  });

  test("post-ROSC stabilization excludes HOLD and retains the GO decision requirement", () => {
    const value = runtime(); value.triggerVasopressorFault(0); value.advanceTo(181);
    value.correctVasopressor(182); value.setCprQuality(true, 182); value.attemptRosc(182);
    value.setHold(true, 200); const restored = runtime(); restored.restore(value.snapshot());
    expect(restored.advanceTo(1000)).toMatchObject({ heartRate: 105, goNoGoRequired: true });
    restored.setHold(false, 1000);
    expect(restored.advanceTo(1101).heartRate).toBe(105);
    expect(restored.advanceTo(1102)).toMatchObject({ heartRate: 100, goNoGoRequired: true });
  });

  test("legacy corrected snapshots with no recovery HOLD fields retain their original timing", () => {
    const value = runtime(); value.restore({ schemaVersion: 1, state: { schemaVersion: 1,
      patientId: "PT-IRO-001", enabled: true, hold: false, arrest: false, rosc: false,
      cprQuality: false, goNoGoRequired: false, lastUpdatedSimulationTimeSec: 45,
      vasopressorFault: { startedAtSimulationTimeSec: 0, accumulatedHoldSec: 0,
        correctedAtSimulationTimeSec: 45 } } });
    expect(value.advanceTo(164).vasopressorStage).toBe("S1R");
    expect(value.advanceTo(165).vasopressorStage).toBe("S0");
  });
  test.each([[0, "S0"], [30, "S1"], [60, "S2"], [120, "S3"], [181, "PEA"]] as const)(
    "vasopressor interruption at %ss reaches %s", (time, stage) => {
      const value = runtime(); value.triggerVasopressorFault(0);
      expect(value.advanceTo(time).vasopressorStage).toBe(stage);
    });

  test.each([[30, "S1R", 150], [60, "S2R", 240], [120, "S3R", 420]] as const)(
    "correction from %ss enters %s and deterministically returns to S0", (correctionAt, recovery, normalAt) => {
      const value = runtime(); value.triggerVasopressorFault(0); value.advanceTo(correctionAt);
      expect(value.correctVasopressor(correctionAt).vasopressorStage).toBe(recovery);
      expect(value.advanceTo(normalAt).vasopressorStage).toBe("S0");
    });

  test.each([
    ["CIRCUIT_DISCONNECT", 121], ["OXYGEN_DEPLETION", 121], ["VENTILATOR_STOP", 121],
    ["HIGH_PRESSURE_KINK", 181],
  ] as const)("%s reaches PEA only after its configured interval", (fault, arrestAt) => {
    const value = runtime(); value.triggerVentilationFault(fault, 0);
    expect(value.advanceTo(arrestAt - 1).ventilationStage).not.toBe("PEA");
    expect(value.advanceTo(arrestAt).ventilationStage).toBe("PEA");
  });

  test.each([
    ["CIRCUIT_DISCONNECT", "LOW_VOLUME", false, true, true],
    ["HIGH_PRESSURE_KINK", "HIGH_PRESSURE", true, true, true],
    ["OXYGEN_DEPLETION", "OXYGEN_SUPPLY", true, false, true],
    ["VENTILATOR_STOP", "APNOEA", false, true, false],
  ] as const)("%s exposes its own alarm and effective-support evidence", (fault, alarm, waveform,
    oxygen, running) => {
    const value = runtime(); value.triggerVentilationFault(fault, 0);
    expect(value.advanceTo(30)).toMatchObject({ ventilationAlarm: alarm,
      etco2WaveformPresent: waveform, oxygenSourceAdequate: oxygen, ventilatorRunning: running });
  });

  test("high-pressure and oxygen-depletion branches retain distinct observed physiology", () => {
    const highPressure = runtime(); highPressure.triggerVentilationFault("HIGH_PRESSURE_KINK", 0);
    expect(highPressure.advanceTo(30)).toMatchObject({ ventilationStage: "DETERIORATING", spo2: 92, etco2: 6 });
    const oxygen = runtime(); oxygen.triggerVentilationFault("OXYGEN_DEPLETION", 0);
    expect(oxygen.advanceTo(30)).toMatchObject({ ventilationStage: "DETERIORATING", heartRate: 105, spo2: 92 });
  });

  test("combined faults accelerate to PEA after 90 seconds from the second fault", () => {
    const value = runtime(); value.triggerVasopressorFault(0); value.triggerVentilationFault("CIRCUIT_DISCONNECT", 20);
    expect(value.advanceTo(110).arrest).toBe(false); expect(value.advanceTo(111).arrest).toBe(true);
  });

  test("HOLD freezes and RESUME continues scenario-specific elapsed fault time", () => {
    const value = runtime(); value.triggerVasopressorFault(0); value.advanceTo(40); value.setHold(true, 40);
    expect(value.advanceTo(500).vasopressorStage).toBe("S1"); value.setHold(false, 500);
    expect(value.advanceTo(520).vasopressorStage).toBe("S2");
  });

  test.each([0, 1, 2, 5, 10, 30, 60])(
    "honors a valid B19 ventilation CORRECT intent after %ss materialization latency", delaySec => {
      const value = runtime(); value.triggerVentilationFault("CIRCUIT_DISCONNECT", 988);
      value.advanceTo(1106); value.setHold(true, 1106); value.advanceTo(1780); value.setHold(false, 1780);
      const intentTime = 1781;
      expect(value.ventilationCorrectionIntentAt(intentTime)).toEqual({ accepted: true,
        faultEffectiveElapsedSec: 119, irreversibleThresholdSec: 120 });
      value.advanceTo(intentTime + delaySec);
      const corrected = value.correctVentilation(intentTime, intentTime + delaySec);
      expect(corrected).toMatchObject({ arrest: false, ventilationStage: "RECOVERING",
        ventilationFault: { startedAtSimulationTimeSec: 988, accumulatedHoldSec: 674,
          correctedAtSimulationTimeSec: intentTime } });
    });

  test.each([[110, true], [115, true], [118, true], [119, true], [120, true], [121, false]] as const)(
    "defines the ventilation correction intent boundary at %ss as accepted=%s", (intentTime, accepted) => {
      const value = runtime(); value.triggerVentilationFault("CIRCUIT_DISCONNECT", 0);
      value.advanceTo(Math.max(121, intentTime + 5));
      expect(value.ventilationCorrectionIntentAt(intentTime).accepted).toBe(accepted);
      if (accepted) expect(value.correctVentilation(intentTime, Math.max(121, intentTime + 5)).arrest).toBe(false);
      else expect(value.correctVentilation(intentTime, 130)).toMatchObject({ arrest: true, ventilationStage: "PEA" });
    });

  test("still reaches irreversible PEA after RESUME when no correction intent exists", () => {
    const value = runtime(); value.triggerVentilationFault("CIRCUIT_DISCONNECT", 988);
    value.advanceTo(1106); value.setHold(true, 1106); value.advanceTo(1780); value.setHold(false, 1780);
    expect(value.advanceTo(1782)).toMatchObject({ arrest: false, ventilationStage: "CRITICAL" });
    expect(value.advanceTo(1783)).toMatchObject({ arrest: true, ventilationStage: "PEA",
      arrestAtSimulationTimeSec: 1783, arrestCause: "VENTILATION" });
  });

  test("keeps authoritative arrest when a genuinely late correction fixes only its cause", () => {
    const value = runtime(); value.triggerVentilationFault("CIRCUIT_DISCONNECT", 0); value.advanceTo(121);
    expect(value.ventilationCorrectionIntentAt(121)).toMatchObject({ accepted: false,
      faultEffectiveElapsedSec: 121, irreversibleThresholdSec: 120,
      reason: "IRREVERSIBLE_THRESHOLD_CROSSED" });
    expect(value.correctVentilation(121, 130)).toMatchObject({ arrest: true, ventilationStage: "PEA",
      ventilationFault: { correctedAtSimulationTimeSec: 121 } });
    expect(value.projectionAt(130)).toMatchObject({ arrest: true, ventilationStage: "PEA" });
  });

  test.each([
    ["CIRCUIT_DISCONNECT", 120], ["OXYGEN_DEPLETION", 120], ["VENTILATOR_STOP", 120],
    ["HIGH_PRESSURE_KINK", 180],
  ] as const)("honors the exact pre-threshold intent boundary for %s", (fault, threshold) => {
    const value = runtime(); value.triggerVentilationFault(fault, 0); value.advanceTo(threshold + 30);
    expect(value.ventilationCorrectionIntentAt(threshold)).toEqual({ accepted: true,
      faultEffectiveElapsedSec: threshold, irreversibleThresholdSec: threshold });
    expect(value.correctVentilation(threshold, threshold + 30)).toMatchObject({ arrest: false,
      ventilationStage: "RECOVERING" });
  });

  test("applies the same accepted-intent rule to vasopressor correction", () => {
    const value = runtime(); value.triggerVasopressorFault(0); value.advanceTo(220);
    expect(value.vasopressorCorrectionIntentAt(180)).toEqual({ accepted: true,
      faultEffectiveElapsedSec: 180, irreversibleThresholdSec: 180 });
    expect(value.correctVasopressor(180, 220)).toMatchObject({ arrest: false, vasopressorStage: "S3R" });
    const late = runtime(); late.triggerVasopressorFault(0); late.advanceTo(181);
    expect(late.correctVasopressor(181, 220)).toMatchObject({ arrest: true, vasopressorStage: "PEA",
      vasopressorFault: { correctedAtSimulationTimeSec: 181 } });
  });

  test("ROSC remains cause-gated and adrenaline/timer alone cannot grant it", () => {
    const value = runtime(); value.triggerVasopressorFault(0); value.advanceTo(181); value.setCprQuality(true, 181);
    expect(value.attemptRosc(181).status).toBe("REJECTED");
    value.correctVasopressor(182);
    const result = value.attemptRosc(182);
    expect(result).toMatchObject({ status: "APPLIED", projection: { rosc: true, goNoGoRequired: true,
      pulsePresent: true, heartRate: 105, systolicBp: 85, diastolicBp: 50 } });
  });

  test("stabilizes deterministically after two post-ROSC simulation minutes", () => {
    const value = runtime(); value.triggerVasopressorFault(0); value.advanceTo(181);
    value.setCprQuality(true, 181); value.correctVasopressor(181);
    expect(value.attemptRosc(181)).toMatchObject({ status: "APPLIED", projection: {
      heartRate: 105, systolicBp: 85, diastolicBp: 50, spo2: 94, etco2: 4.2,
      pulsePresent: true, goNoGoRequired: true,
    } });
    expect(value.advanceTo(301)).toMatchObject({ heartRate: 100, systolicBp: 100,
      diastolicBp: 60, spo2: 96, etco2: 4.5, pulsePresent: true, goNoGoRequired: true });
  });

  test("checkpoint round-trip preserves active fault, frozen time, correction and arrest evidence", () => {
    const source = runtime(); source.triggerVasopressorFault(0); source.triggerVentilationFault("HIGH_PRESSURE_KINK", 10);
    source.setHold(true, 70); const snapshot = source.snapshot(); const restored = runtime(); restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot); expect(restored.advanceTo(500)).toEqual(source.advanceTo(500));
  });
});
