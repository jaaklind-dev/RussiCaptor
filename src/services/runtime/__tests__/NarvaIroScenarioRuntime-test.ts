import { NarvaIroScenarioRuntime } from "../NarvaIroScenarioRuntime";

const runtime = () => { const value = new NarvaIroScenarioRuntime(); value.reset("PT-IRO-001"); return value; };

describe("WP-NARVA-02 deterministic IRO fault and recovery process", () => {
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
