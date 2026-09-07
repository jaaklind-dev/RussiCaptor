import type { NarvaIroFaultClock, NarvaIroScenarioProjection, NarvaIroScenarioSnapshot,
  NarvaIroScenarioState, NarvaIroVasopressorStage, NarvaIroVentilationFault,
  NarvaIroVentilationStage } from "@/models/NarvaIroScenario";
import type { VitalSignContributor, VitalSignKey } from "@/models/VitalSign";

const frozen = <T>(value: T): T => Object.freeze(structuredClone(value));
const elapsed = (clock: NarvaIroFaultClock, now: number): number => Math.max(0,
  (clock.heldAtSimulationTimeSec ?? now) - clock.startedAtSimulationTimeSec - clock.accumulatedHoldSec);
const corrected = (clock?: NarvaIroFaultClock): boolean => clock?.correctedAtSimulationTimeSec !== undefined;

export class NarvaIroScenarioRuntime {
  private state?: NarvaIroScenarioState;

  reset(patientId?: string): void {
    this.state = patientId ? frozen({ schemaVersion: 1, patientId, enabled: true, hold: false,
      arrest: false, cprQuality: false, rosc: false, goNoGoRequired: false,
      lastUpdatedSimulationTimeSec: 0 }) : undefined;
  }

  triggerVasopressorFault(simulationTimeSec: number): NarvaIroScenarioProjection {
    const state = this.require();
    if (!state.vasopressorFault || corrected(state.vasopressorFault)) this.state = frozen({ ...state,
      vasopressorFault: { startedAtSimulationTimeSec: simulationTimeSec, accumulatedHoldSec: 0 },
      lastUpdatedSimulationTimeSec: simulationTimeSec });
    return this.advanceTo(simulationTimeSec);
  }

  triggerVentilationFault(type: NarvaIroVentilationFault, simulationTimeSec: number): NarvaIroScenarioProjection {
    const state = this.require();
    this.state = frozen({ ...state, ventilationFault: { type, startedAtSimulationTimeSec: simulationTimeSec,
      accumulatedHoldSec: 0 }, lastUpdatedSimulationTimeSec: simulationTimeSec });
    return this.advanceTo(simulationTimeSec);
  }

  correctVasopressor(simulationTimeSec: number): NarvaIroScenarioProjection {
    const state = this.require(); if (!state.vasopressorFault) return this.advanceTo(simulationTimeSec);
    this.state = frozen({ ...state, vasopressorFault: { ...state.vasopressorFault,
      correctedAtSimulationTimeSec: simulationTimeSec }, lastUpdatedSimulationTimeSec: simulationTimeSec });
    return this.advanceTo(simulationTimeSec);
  }

  correctVentilation(simulationTimeSec: number): NarvaIroScenarioProjection {
    const state = this.require(); if (!state.ventilationFault) return this.advanceTo(simulationTimeSec);
    this.state = frozen({ ...state, ventilationFault: { ...state.ventilationFault,
      correctedAtSimulationTimeSec: simulationTimeSec }, lastUpdatedSimulationTimeSec: simulationTimeSec });
    return this.advanceTo(simulationTimeSec);
  }

  setHold(hold: boolean, simulationTimeSec: number): NarvaIroScenarioProjection {
    const state = this.require(); if (state.hold === hold) return this.advanceTo(simulationTimeSec);
    const update = <T extends NarvaIroFaultClock | undefined>(clock: T): T => {
      if (!clock || corrected(clock)) return clock;
      return frozen(hold ? { ...clock, heldAtSimulationTimeSec: simulationTimeSec } : {
        ...clock, accumulatedHoldSec: clock.accumulatedHoldSec + Math.max(0,
          simulationTimeSec - (clock.heldAtSimulationTimeSec ?? simulationTimeSec)),
        heldAtSimulationTimeSec: undefined,
      }) as T;
    };
    this.state = frozen({ ...state, hold, vasopressorFault: update(state.vasopressorFault),
      ventilationFault: update(state.ventilationFault), lastUpdatedSimulationTimeSec: simulationTimeSec });
    return this.advanceTo(simulationTimeSec);
  }

  setCprQuality(quality: boolean, simulationTimeSec: number): NarvaIroScenarioProjection {
    this.state = frozen({ ...this.require(), cprQuality: quality, lastUpdatedSimulationTimeSec: simulationTimeSec });
    return this.advanceTo(simulationTimeSec);
  }

  attemptRosc(simulationTimeSec: number): Readonly<{ status: "APPLIED" | "REJECTED"; projection: NarvaIroScenarioProjection }> {
    const projection = this.advanceTo(simulationTimeSec);
    if (!projection.roscEligible) return frozen({ status: "REJECTED", projection });
    this.state = frozen({ ...this.require(), arrest: false, rosc: true,
      roscAtSimulationTimeSec: simulationTimeSec, goNoGoRequired: true,
      lastUpdatedSimulationTimeSec: simulationTimeSec });
    return frozen({ status: "APPLIED", projection: this.projectionAt(simulationTimeSec) });
  }

  advanceTo(simulationTimeSec: number): NarvaIroScenarioProjection {
    const state = this.require();
    const projected = this.projectionAt(simulationTimeSec);
    if (projected.vasopressorStage === "PEA" || projected.ventilationStage === "PEA") {
      this.state = frozen({ ...state, arrest: true, lastUpdatedSimulationTimeSec: simulationTimeSec });
    } else this.state = frozen({ ...state, lastUpdatedSimulationTimeSec: simulationTimeSec });
    return this.projectionAt(simulationTimeSec);
  }

  projectionAt(simulationTimeSec: number): NarvaIroScenarioProjection {
    const state = this.require();
    const vasopressorStage = this.vasopressorStage(simulationTimeSec);
    const ventilationStage = this.ventilationStage(simulationTimeSec);
    const combined = this.combinedCritical(simulationTimeSec);
    const arrest = state.arrest || vasopressorStage === "PEA" || ventilationStage === "PEA" || combined;
    const causesCorrected = (!state.vasopressorFault || corrected(state.vasopressorFault)) &&
      (!state.ventilationFault || corrected(state.ventilationFault));
    const vital = this.vitals(vasopressorStage, ventilationStage, arrest, state.rosc,
      simulationTimeSec - (state.roscAtSimulationTimeSec ?? state.lastUpdatedSimulationTimeSec));
    return frozen({ ...state, arrest, vasopressorStage: arrest && !state.rosc ? "PEA" : vasopressorStage,
      ventilationStage: arrest && !state.rosc ? "PEA" : ventilationStage, ...vital,
      causesCorrected, roscEligible: arrest && state.cprQuality && causesCorrected });
  }

  vitalContributorsAt(simulationTimeSec: number): readonly VitalSignContributor[] {
    if (!this.state) return [];
    const projection = this.projectionAt(simulationTimeSec);
    const values: readonly [VitalSignKey, number | undefined][] = [["heartRate", projection.heartRate],
      ["systolicBp", projection.systolicBp], ["diastolicBp", projection.diastolicBp],
      ["spo2", projection.spo2], ["etco2", projection.etco2]];
    return Object.freeze(values.filter(([, value]) => value !== undefined).map(([vital, value]) => frozen({
      contributorId: `NARVA_IRO:${projection.patientId}:${vital}`, sourceType: "PATIENT_PROCESS" as const,
      sourceId: "NARVA_IRO_FAULT_PROCESS", layer: "PROCESS" as const,
      vital, operation: "TARGET" as const, value: value!,
    })));
  }

  snapshot(): NarvaIroScenarioSnapshot | undefined {
    return this.state ? frozen({ schemaVersion: 1, state: this.state }) : undefined;
  }

  vasopressorDeliveryInterrupted(): boolean {
    return Boolean(this.state?.vasopressorFault && !corrected(this.state.vasopressorFault));
  }

  ventilationDeliveryInterrupted(): boolean {
    return Boolean(this.state?.ventilationFault && !corrected(this.state.ventilationFault));
  }

  restore(snapshot?: NarvaIroScenarioSnapshot): void {
    if (!snapshot) { this.state = undefined; return; }
    if (snapshot.schemaVersion !== 1 || snapshot.state.schemaVersion !== 1 || !snapshot.state.patientId) {
      throw new Error("NARVA_IRO_SNAPSHOT_INVALID");
    }
    this.state = frozen(snapshot.state);
  }

  private vasopressorStage(now: number): NarvaIroVasopressorStage {
    const state = this.require(); const clock = state.vasopressorFault;
    if (state.rosc) return "ROSC"; if (!clock) return "S0";
    if (corrected(clock)) {
      const atCorrection = elapsed(clock, clock.correctedAtSimulationTimeSec!);
      const recoveryElapsed = Math.max(0, now - clock.correctedAtSimulationTimeSec!);
      if (atCorrection < 60) return recoveryElapsed >= 120 ? "S0" : "S1R";
      if (atCorrection < 120) return recoveryElapsed >= 180 ? "S0" : "S2R";
      return recoveryElapsed >= 300 ? "S0" : "S3R";
    }
    const age = elapsed(clock, now); return age > 180 ? "PEA" : age >= 120 ? "S3" : age >= 60 ? "S2" : age >= 30 ? "S1" : "S0";
  }

  private ventilationStage(now: number): NarvaIroVentilationStage {
    const clock = this.require().ventilationFault; if (!clock) return "NORMAL";
    if (corrected(clock)) return now - clock.correctedAtSimulationTimeSec! >= 180 ? "NORMAL" : "RECOVERING";
    const age = elapsed(clock, now);
    const arrestAt = clock.type === "HIGH_PRESSURE_KINK" ? 180 : 120;
    return age > arrestAt ? "PEA" : age >= 60 ? "CRITICAL" : age >= 30 ? "DETERIORATING" : "EARLY";
  }

  private combinedCritical(now: number): boolean {
    const state = this.require(); if (!state.vasopressorFault || !state.ventilationFault ||
      corrected(state.vasopressorFault) || corrected(state.ventilationFault)) return false;
    const secondStart = Math.max(state.vasopressorFault.startedAtSimulationTimeSec,
      state.ventilationFault.startedAtSimulationTimeSec);
    return now - secondStart > 90;
  }

  private vitals(vaso: NarvaIroVasopressorStage, vent: NarvaIroVentilationStage, arrest: boolean, rosc: boolean,
    roscElapsedSec: number):
  Readonly<{ heartRate: number; systolicBp?: number; diastolicBp?: number; spo2: number; etco2?: number; pulsePresent: boolean }> {
    if (rosc) return roscElapsedSec >= 120
      ? { heartRate: 100, systolicBp: 100, diastolicBp: 60, spo2: 96, etco2: 4.5, pulsePresent: true }
      : { heartRate: 105, systolicBp: 85, diastolicBp: 50, spo2: 94, etco2: 4.2, pulsePresent: true };
    if (arrest) return { heartRate: 40, spo2: vent === "PEA" ? 75 : 90, pulsePresent: false };
    const vasoValues = vaso === "S3" ? [130, 55, 30, 3] : vaso === "S2" ? [120, 75, 40, 4] :
      vaso === "S1" ? [105, 90, 50, 4.5] : vaso === "S3R" ? [115, 78, 45, 3.8] :
        vaso === "S2R" ? [110, 85, 48, 4.2] : vaso === "S1R" ? [98, 100, 58, 4.6] : [92, 105, 62, 4.8];
    const ventValues = vent === "CRITICAL" ? [120, 82, 3] : vent === "DETERIORATING" ? [110, 90, 4] :
      vent === "EARLY" ? [100, 95, 4.3] : vent === "RECOVERING" ? [100, 94, 4.4] : [92, 96, 4.8];
    return { heartRate: Math.max(vasoValues[0], ventValues[0]), systolicBp: vasoValues[1],
      diastolicBp: vasoValues[2], spo2: ventValues[1], etco2: ventValues[2], pulsePresent: true };
  }

  private require(): NarvaIroScenarioState {
    if (!this.state) throw new Error("NARVA_IRO_SCENARIO_NOT_ENABLED"); return this.state;
  }
}
