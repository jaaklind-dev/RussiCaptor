import type {
  Avpu, VitalSignConfiguration, VitalSignContributor, VitalSignEvent,
  VitalSignKey, VitalSignResolutionInput, VitalSignResolutionResult, VitalSignState,
} from "@/models/VitalSign";

export const defaultVitalSignConfiguration: VitalSignConfiguration = {
  version: "WP-16/V1",
  signs: {
    heartRate: { baseline: 80, min: 20, max: 220, maxChangePerTick: 25, responseFactor: 0.35, roundingDigits: 2, unstableChangeThreshold: 15 },
    systolicBp: { baseline: 120, min: 30, max: 250, maxChangePerTick: 30, responseFactor: 0.4, roundingDigits: 2, unstableChangeThreshold: 20 },
    diastolicBp: { baseline: 75, min: 15, max: 160, maxChangePerTick: 20, responseFactor: 0.35, roundingDigits: 2, unstableChangeThreshold: 15 },
    respiratoryRate: { baseline: 16, min: 0, max: 60, maxChangePerTick: 10, responseFactor: 0.4, roundingDigits: 2, unstableChangeThreshold: 8 },
    spo2: { baseline: 98, min: 40, max: 100, maxChangePerTick: 12, responseFactor: 0.45, roundingDigits: 2, unstableChangeThreshold: 5 },
    etco2: { baseline: 40, min: 0, max: 150, maxChangePerTick: 15, responseFactor: 0.4, roundingDigits: 1, unstableChangeThreshold: 10 },
    temperature: { baseline: 36.8, min: 25, max: 43, maxChangePerTick: 0.5, responseFactor: 0.2, roundingDigits: 2, unstableChangeThreshold: 0.5 },
    gcs: { baseline: 15, min: 3, max: 15, maxChangePerTick: 3, responseFactor: 1, roundingDigits: 0, unstableChangeThreshold: 2 },
  },
  avpuThresholds: { alertMinGcs: 15, voiceMinGcs: 12, painMinGcs: 7 },
};

const keys = Object.keys(defaultVitalSignConfiguration.signs) as VitalSignKey[];
const layerOrder = { PERMANENT: 0, PROCESS: 1, MEDICATION: 2, TEMPORARY: 3 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits: number) => Number(value.toFixed(digits));

function avpu(gcs: number, config: VitalSignConfiguration): Avpu {
  if (gcs >= config.avpuThresholds.alertMinGcs) return "ALERT";
  if (gcs >= config.avpuThresholds.voiceMinGcs) return "VOICE";
  if (gcs >= config.avpuThresholds.painMinGcs) return "PAIN";
  return "UNRESPONSIVE";
}

function ordered(values: VitalSignContributor[]): VitalSignContributor[] {
  return [...values].sort((a, b) =>
    layerOrder[a.layer] - layerOrder[b.layer] || a.vital.localeCompare(b.vital) ||
    a.sourceId.localeCompare(b.sourceId) || a.contributorId.localeCompare(b.contributorId)
  );
}

export class VitalSignEngine {
  resolve(input: VitalSignResolutionInput): VitalSignResolutionResult {
    const config = input.configuration;
    const baseline = Object.fromEntries(keys.map(key => [key, config.signs[key].baseline])) as Record<VitalSignKey, number>;
    const contributors = ordered(input.contributors).filter(item => Number.isFinite(item.value));
    const readings = {} as VitalSignState["readings"];
    const events: VitalSignEvent[] = [];

    for (const key of keys) {
      const rule = config.signs[key];
      let target = baseline[key];
      for (const item of contributors.filter(value => value.vital === key)) {
        target = item.operation === "TARGET" ? item.value : target + item.value;
      }
      target = round(clamp(target, rule.min, rule.max), rule.roundingDigits);
      const previous = input.previous?.readings[key]?.current;
      const desired = previous === undefined ? target : previous + (target - previous) * rule.responseFactor;
      const current = round(clamp(previous === undefined ? desired : clamp(desired, previous - rule.maxChangePerTick, previous + rule.maxChangePerTick), rule.min, rule.max), rule.roundingDigits);
      const change = round(current - (previous ?? current), rule.roundingDigits);
      const direction = change > 0 ? "RISING" : change < 0 ? "FALLING" : "UNCHANGED";
      readings[key] = { current, target, trend: change, direction, stability: Math.abs(change) > rule.unstableChangeThreshold ? "UNSTABLE" : "STABLE" };
      if (previous !== undefined && current !== previous) events.push({ eventType: "VitalSignChanged", timestamp: input.timestamp, vital: key, from: previous, to: current, sourceProcessId: "VITAL_SIGN_ENGINE" });
      const oldDirection = input.previous?.readings[key]?.direction;
      if (oldDirection !== undefined && oldDirection !== direction) events.push({ eventType: "TrendChanged", timestamp: input.timestamp, vital: key, from: oldDirection, to: direction, sourceProcessId: "VITAL_SIGN_ENGINE" });
    }

    const quality = input.monitorQuality ?? input.previous?.quality ?? "VALID";
    if (input.previous && quality !== input.previous.quality) events.push({ eventType: "MonitorStateChanged", timestamp: input.timestamp, from: input.previous.quality, to: quality, sourceProcessId: "VITAL_SIGN_ENGINE" });
    const sbp = readings.systolicBp.current;
    const dbp = readings.diastolicBp.current;
    const state: VitalSignState = {
      timestamp: input.timestamp, quality, baseline, readings,
      avpu: avpu(readings.gcs.current, config),
      derived: {
        meanArterialPressure: round((sbp + 2 * dbp) / 3, 2),
        shockIndex: round(sbp === 0 ? 0 : readings.heartRate.current / sbp, 3),
        pulsePressure: round(sbp - dbp, 2),
      },
      activeContributors: contributors,
    };
    return { state, events };
  }
}
