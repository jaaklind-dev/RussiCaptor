import type { RuntimeVitalTargets } from "@/models/RuntimeAggregation";
import type { VitalSignState } from "@/models/VitalSign";

export type VitalSignCompatibilityProjection = {
  readonly targetVitals: Readonly<RuntimeVitalTargets>;
  readonly displayedVitals: Readonly<RuntimeVitalTargets>;
  readonly mapCalculated: number;
  readonly gcsTarget: number;
};

/** Read-only compatibility projection. VitalSignState remains the only owner. */
export function projectVitalSignState(state: VitalSignState): VitalSignCompatibilityProjection {
  return {
    targetVitals: Object.freeze({
      hr: state.readings.heartRate.target, sbp: state.readings.systolicBp.target,
      dbp: state.readings.diastolicBp.target, rr: state.readings.respiratoryRate.target,
      spo2: state.readings.spo2.target, temperature: state.readings.temperature.target,
      crt: state.readings.crt.target,
    }),
    displayedVitals: Object.freeze({
      hr: state.readings.heartRate.current, sbp: state.readings.systolicBp.current,
      dbp: state.readings.diastolicBp.current, rr: state.readings.respiratoryRate.current,
      spo2: state.readings.spo2.current, temperature: state.readings.temperature.current,
      crt: state.readings.crt.current,
    }),
    mapCalculated: state.derived.meanArterialPressure,
    gcsTarget: state.readings.gcs.target,
  };
}
