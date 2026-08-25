import type { AggregationEvent, PhysiologicDecompensationConfiguration, PhysiologicDecompensationState, RuntimeStatus } from "@/models/RuntimeAggregation";
import type { PulseOxSignalQuality, VitalSignState } from "@/models/VitalSign";

export const DEFAULT_PHYSIOLOGIC_DECOMPENSATION_CONFIG: PhysiologicDecompensationConfiguration = Object.freeze({
  version: "WP-48/V1", poorSignalScore: 0.55, noSignalScore: 0.28,
  terminalFailureDurationSec: 300, deathFailureDurationSec: 600,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const deadMonitor = (source: VitalSignState): VitalSignState => {
  const monitor = structuredClone(source);
  const zero = (key: "heartRate" | "systolicBp" | "diastolicBp" | "respiratoryRate" | "spo2" | "etco2", target = 0) => {
    monitor.readings[key] = { ...monitor.readings[key], current: 0, target, trend: 0, direction: "UNCHANGED", stability: "STABLE" };
  };
  zero("heartRate"); zero("systolicBp"); zero("diastolicBp"); zero("respiratoryRate"); zero("spo2"); zero("etco2");
  monitor.readings.gcs = { ...monitor.readings.gcs, current: 3, target: 3, trend: 0, direction: "UNCHANGED", stability: "STABLE" };
  monitor.avpu = "UNRESPONSIVE"; monitor.quality = "LOST";
  monitor.derived = { meanArterialPressure: 0, pulsePressure: 0, shockIndex: 0 };
  monitor.pulseOx = { signalQuality: "NO_SIGNAL", physiologicOxygenation: 0, perfusionScore: 0 };
  return monitor;
};

export function resolvePhysiologicDecompensation(input: Readonly<{
  monitor: VitalSignState;
  previous?: PhysiologicDecompensationState;
  config: PhysiologicDecompensationConfiguration;
  simulationTimeSec: number;
  previousStatus: RuntimeStatus;
}>): { monitor: VitalSignState; state: PhysiologicDecompensationState; status: RuntimeStatus; events: AggregationEvent[] } {
  const monitor = structuredClone(input.monitor);
  const map = monitor.derived.meanArterialPressure;
  const pulsePressure = monitor.derived.pulsePressure;
  const shockIndex = monitor.derived.shockIndex;
  const oxygenation = monitor.readings.spo2.current;
  const mapScore = clamp((map - 25) / 55, 0, 1);
  const pulseScore = clamp((pulsePressure - 8) / 32, 0, 1);
  const shockScore = clamp((2.2 - shockIndex) / 1.4, 0, 1);
  const perfusionScore = round(0.55 * mapScore + 0.25 * pulseScore + 0.2 * shockScore, 3);
  const signalQuality: PulseOxSignalQuality = perfusionScore <= input.config.noSignalScore ? "NO_SIGNAL"
    : perfusionScore <= input.config.poorSignalScore ? "POOR" : "GOOD";
  monitor.pulseOx = { signalQuality, physiologicOxygenation: oxygenation, perfusionScore,
    ...(signalQuality === "NO_SIGNAL" ? {} : { measuredSpO2: oxygenation }) };

  const hypoxiaBurden = clamp((92 - oxygenation) / 42, 0, 1);
  const perfusionBurden = clamp((0.62 - perfusionScore) / 0.62, 0, 1);
  const combined = clamp(0.55 * hypoxiaBurden + 0.6 * perfusionBurden, 0, 1);
  const derivedGcs = Math.round(clamp(15 - combined * 12, 3, 15));
  // GCS is a derived, reversible physiologic projection. Do not retain the prior
  // low value as a floor when hypoxia/perfusion contributors have recovered.
  monitor.readings.gcs = { ...monitor.readings.gcs, target: derivedGcs, current: derivedGcs };
  monitor.avpu = derivedGcs >= 15 ? "ALERT" : derivedGcs >= 12 ? "VOICE" : derivedGcs >= 7 ? "PAIN" : "UNRESPONSIVE";
  const gcsCause = hypoxiaBurden > 0.15 && perfusionBurden > 0.15 ? "COMBINED" : hypoxiaBurden > 0.15 ? "HYPOXIA" : perfusionBurden > 0.15 ? "HYPOPERFUSION" : "NONE";

  const profound = (perfusionScore <= input.config.noSignalScore && oxygenation <= 70) || map <= 30;
  const previous = input.previous ?? { clinicalState: "ALIVE", gcsCause: "NONE" };
  if (previous.clinicalState === "DEAD" || input.previousStatus === "Dead") return { monitor: deadMonitor(monitor), state: { ...previous, clinicalState: "DEAD", pulseOxSignalQuality: "NO_SIGNAL" }, status: "Dead", events: [] };
  const profoundFailureSinceSec = profound ? previous.profoundFailureSinceSec ?? input.simulationTimeSec : undefined;
  const duration = profoundFailureSinceSec === undefined ? 0 : input.simulationTimeSec - profoundFailureSinceSec;
  const clinicalState = duration >= input.config.deathFailureDurationSec ? "DEAD" : duration >= input.config.terminalFailureDurationSec ? "TERMINAL"
    : combined >= 0.55 ? "CRITICAL" : "ALIVE";
  const terminalSinceSec = clinicalState === "TERMINAL" || clinicalState === "DEAD" ? previous.terminalSinceSec ?? input.simulationTimeSec : undefined;
  const state: PhysiologicDecompensationState = { profoundFailureSinceSec, terminalSinceSec, clinicalState, gcsCause, pulseOxSignalQuality: signalQuality };
  const status: RuntimeStatus = clinicalState === "DEAD" ? "Dead" : clinicalState === "TERMINAL" || clinicalState === "CRITICAL" ? "Critical" : input.previousStatus;
  const events: AggregationEvent[] = [];
  if (previous.clinicalState !== clinicalState) events.push({ eventType: clinicalState === "DEAD" ? "PATIENT_DIED" : "PHYSIOLOGIC_STATE_CHANGED", details: { from: previous.clinicalState, to: clinicalState, cause: gcsCause } });
  const oldSignal = previous.pulseOxSignalQuality ?? "GOOD";
  if (oldSignal !== signalQuality) events.push({ eventType: signalQuality === "NO_SIGNAL" ? "PULSE_OX_SIGNAL_LOST" : "PULSE_OX_SIGNAL_CHANGED", details: { from: oldSignal, to: signalQuality } });
  return { monitor: clinicalState === "DEAD" ? deadMonitor(monitor) : monitor, state, status, events };
}
