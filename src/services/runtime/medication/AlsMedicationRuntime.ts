import type { CirculationState } from "@/models/CirculationState";
import type {
  AlsMedicationAdministrationState,
  AlsMedicationCommand,
  AlsMedicationCommandResult,
  AlsMedicationCourseProjection,
  AlsMedicationFeatureProjection,
  AlsMedicationRejectionReason,
  AlsMedicationRuntimeEvent,
  AlsMedicationRuntimeSnapshot,
  AlsProtocolClassification,
  AlsRhythmContext,
} from "@/models/AlsMedication";
import { ERC_2025_ADULT_ALS_PROFILE_ID } from "@/models/AlsMedication";
import type { VitalSignContributor } from "@/models/VitalSign";
import { ERC_2025_ADULT_ALS_PROFILE, erc2025AdultAlsProductById } from "./Erc2025AdultAlsProfile";

const precise = (value: number): number => Number(value.toFixed(6));
const eligible = (value: AlsProtocolClassification): boolean =>
  value === "GUIDELINE_ELIGIBLE" || value === "OVERDUE_GUIDELINE_ELIGIBLE";

function sameDose(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function validAccess(command: AlsMedicationCommand, circulation?: CirculationState): boolean {
  if (!circulation || circulation.patientId !== command.patientId) return false;
  return circulation.vascularAccess.some(item => item.interventionInstanceId === command.vascularAccessId &&
    (command.route === "IO" ? item.type === "IO" : item.type !== "IO"));
}

export class AlsMedicationRuntime {
  private readonly administrations = new Map<string, AlsMedicationAdministrationState>();
  private readonly commandResults = new Map<string, AlsMedicationCommandResult>();
  private readonly events: AlsMedicationRuntimeEvent[] = [];

  reset(): void {
    this.administrations.clear(); this.commandResults.clear(); this.events.length = 0;
  }

  execute(command: AlsMedicationCommand, circulation: CirculationState | undefined,
    context: AlsRhythmContext | undefined): AlsMedicationCommandResult {
    const duplicate = this.commandResults.get(command.commandId);
    if (duplicate) return structuredClone({ ...duplicate, status: "IDEMPOTENT" as const });
    const rejection = this.validate(command, circulation, context);
    if (rejection) return this.remember(command, this.reject(command, rejection));
    const product = erc2025AdultAlsProductById.get(command.drugId)!;
    const classification = this.classify(command, context!);
    const physiologyStatus = product.modeledEffect === "DEFERRED_SUBSTRATE"
      ? "DEFERRED_NO_SUBSTRATE" as const
      : eligible(classification) ? "ACTIVE" as const : "NO_DIRECT_EFFECT" as const;
    const state: AlsMedicationAdministrationState = Object.freeze({
      schemaVersion: 1,
      profileId: ERC_2025_ADULT_ALS_PROFILE_ID,
      administrationId: command.administrationId,
      commandId: command.commandId,
      patientId: command.patientId,
      drugId: command.drugId,
      route: command.route,
      vascularAccessId: command.vascularAccessId,
      dose: command.dose,
      doseUnit: command.doseUnit,
      ...(command.concentrationId ? { concentrationId: command.concentrationId } : {}),
      simulationTimeSec: command.simulationTimeSec,
      cardiacStateAtAdministration: context!.cardiacState,
      rhythmAtAdministration: context!.rhythm,
      rhythmClassificationAtAdministration: context!.rhythmClassification,
      shockCountAtAdministration: context!.shockAttemptCount,
      cprActiveAtAdministration: context!.cprActive,
      ...(context!.adverseSigns === undefined ? {} : { adverseSignsAtAdministration: context!.adverseSigns }),
      hyperkalaemiaSubstrateAtAdministration: context!.hyperkalaemiaSubstrate,
      protocolClassification: classification,
      modeledEffect: product.modeledEffect,
      ...(physiologyStatus === "ACTIVE" ? {
        effectActiveUntilSimulationTimeSec: command.simulationTimeSec + product.effectDurationSec,
      } : {}),
      physiologyStatus,
    });
    this.administrations.set(state.administrationId, state);
    const event: AlsMedicationRuntimeEvent = Object.freeze({ eventType: "AlsMedicationAdministered",
      commandId: command.commandId, administrationId: command.administrationId, patientId: command.patientId,
      drugId: command.drugId, timestamp: command.simulationTimeSec, protocolClassification: classification });
    this.events.push(event);
    return this.remember(command, Object.freeze({ status: "APPLIED", commandId: command.commandId,
      state: structuredClone(state) }));
  }

  projectionsAt(simulationTimeSec: number, patientId?: string): readonly AlsMedicationFeatureProjection[] {
    return this.ordered().filter(item => !patientId || item.patientId === patientId).map(item => {
      const active = item.physiologyStatus === "ACTIVE" &&
        simulationTimeSec >= item.simulationTimeSec && simulationTimeSec < (item.effectActiveUntilSimulationTimeSec ?? 0);
      const product = erc2025AdultAlsProductById.get(item.drugId)!;
      const duration = Math.max(1, product.effectDurationSec);
      const remaining = active ? Math.max(0, Math.min(1,
        ((item.effectActiveUntilSimulationTimeSec ?? simulationTimeSec) - simulationTimeSec) / duration)) : 0;
      const currentEffect = {
        arrestVasoactiveSupport: item.modeledEffect === "ARREST_VASOACTIVE" ? precise(remaining) : 0,
        antiarrhythmicSupport: item.modeledEffect === "ANTIARRHYTHMIC" ? precise(remaining) : 0,
        heartRateIncreaseBpm: item.modeledEffect === "BRADYCARDIA_RATE" ? precise(20 * remaining) : 0,
        avNodalEffect: item.modeledEffect === "TRANSIENT_AV_NODAL" ? precise(remaining) : 0,
        torsadesSusceptibilityReduction: item.modeledEffect === "TORSADES_SUSCEPTIBILITY"
          ? precise(0.5 * remaining) : 0,
      };
      return Object.freeze({ ...structuredClone(item), featureId: item.drugId, category: "ALS_MEDICATION" as const,
        effectActive: active, currentEffect: Object.freeze(currentEffect), course: this.courseFor(item.patientId) });
    });
  }

  courseFor(patientId: string): AlsMedicationCourseProjection {
    const values = this.ordered().filter(item => item.patientId === patientId);
    const adrenaline = values.filter(item => item.drugId === "ADRENALINE");
    const amiodarone = values.filter(item => item.drugId === "AMIODARONE");
    const lidocaine = values.filter(item => item.drugId === "LIDOCAINE");
    const strategies = [amiodarone.length ? "AMIODARONE" : undefined,
      lidocaine.length ? "LIDOCAINE" : undefined].filter(Boolean);
    return Object.freeze({ patientId,
      ...(adrenaline.length ? { lastAdrenalineSimulationTimeSec: adrenaline.at(-1)!.simulationTimeSec } : {}),
      cumulativeAdrenalineMg: precise(adrenaline.reduce((sum, item) => sum + item.dose, 0)),
      ...(strategies.length ? { antiarrhythmicStrategy: strategies.length === 2 ? "MIXED" as const :
        strategies[0] as "AMIODARONE" | "LIDOCAINE" } : {}),
      amiodaroneDosesMg: Object.freeze(amiodarone.map(item => item.dose)),
      lidocaineDosesMg: Object.freeze(lidocaine.map(item => item.dose)),
      atropineCumulativeMcg: precise(values.filter(item => item.drugId === "ATROPINE")
        .reduce((sum, item) => sum + item.dose, 0)),
      adenosineDosesMg: Object.freeze(values.filter(item => item.drugId === "ADENOSINE").map(item => item.dose)),
    });
  }

  vitalContributorsAt(simulationTimeSec: number): readonly VitalSignContributor[] {
    const maximumByPatient = new Map<string, number>();
    for (const item of this.projectionsAt(simulationTimeSec)) {
      if (!item.effectActive || item.currentEffect.heartRateIncreaseBpm <= 0) continue;
      maximumByPatient.set(item.patientId, Math.max(maximumByPatient.get(item.patientId) ?? 0,
        item.currentEffect.heartRateIncreaseBpm));
    }
    return [...maximumByPatient.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([patientId, value]) => Object.freeze({
        contributorId: `ALS:ATROPINE:${patientId}:HEART_RATE`, sourceType: "CLINICAL_EFFECT" as const,
        sourceId: "ATROPINE", layer: "MEDICATION" as const, vital: "heartRate" as const,
        operation: "DELTA" as const, value: precise(Math.min(20, value)),
      }));
  }

  eventForCommand(commandId: string): AlsMedicationRuntimeEvent | undefined {
    return structuredClone(this.events.findLast(item => item.commandId === commandId));
  }

  snapshot(): AlsMedicationRuntimeSnapshot | undefined {
    if (!this.administrations.size && !this.commandResults.size && !this.events.length) return undefined;
    return Object.freeze({ schemaVersion: 1, profileId: ERC_2025_ADULT_ALS_PROFILE_ID,
      administrations: this.ordered().map(item => structuredClone(item)),
      commandResults: [...this.commandResults.values()].sort((a, b) => a.commandId.localeCompare(b.commandId))
        .map(item => structuredClone(item)), events: structuredClone(this.events) });
  }

  restore(snapshot?: AlsMedicationRuntimeSnapshot): void {
    this.reset();
    if (!snapshot) return;
    if (snapshot.schemaVersion !== 1 || snapshot.profileId !== ERC_2025_ADULT_ALS_PROFILE_ID) {
      throw new Error("ALS_MEDICATION_PROFILE_MISMATCH");
    }
    snapshot.administrations.forEach(item => this.administrations.set(item.administrationId, structuredClone(item)));
    snapshot.commandResults.forEach(item => this.commandResults.set(item.commandId, structuredClone(item)));
    this.events.push(...structuredClone(snapshot.events));
  }

  private validate(command: AlsMedicationCommand, circulation: CirculationState | undefined,
    context: AlsRhythmContext | undefined): AlsMedicationRejectionReason | undefined {
    if (!command.commandId || !command.administrationId || !command.patientId ||
      !Number.isFinite(command.simulationTimeSec) || command.simulationTimeSec < 0) return "INVALID_COMMAND";
    const product = erc2025AdultAlsProductById.get(command.drugId);
    if (!product) return "UNKNOWN_DRUG";
    if (!Number.isFinite(command.dose) || command.dose <= 0) return "INVALID_DOSE";
    if (command.doseUnit !== product.doseUnit ||
      (product.concentrationId && command.concentrationId !== product.concentrationId)) return "INVALID_UNIT";
    if (!product.routes.includes(command.route)) return "INVALID_ROUTE";
    if (!context) return "MISSING_RHYTHM_CONTEXT";
    if (context.patientId !== command.patientId || circulation?.patientId !== command.patientId) return "INVALID_PATIENT";
    if (!validAccess(command, circulation)) return "MISSING_VASCULAR_ACCESS";
    if (this.administrations.has(command.administrationId)) return "DUPLICATE_ADMINISTRATION";
    return undefined;
  }

  private classify(command: AlsMedicationCommand, context: AlsRhythmContext): AlsProtocolClassification {
    const previous = this.ordered().filter(item => item.patientId === command.patientId);
    if (command.drugId === "ADRENALINE") {
      if (context.cardiacState !== "ARREST") return "OUTSIDE_CARDIAC_ARREST_CONTEXT";
      if (!sameDose(command.dose, ERC_2025_ADULT_ALS_PROFILE.adrenaline.doseMg)) return "WRONG_DOSE";
      const doses = previous.filter(item => item.drugId === "ADRENALINE");
      if (doses.length) {
        const elapsed = command.simulationTimeSec - doses.at(-1)!.simulationTimeSec;
        if (elapsed < ERC_2025_ADULT_ALS_PROFILE.adrenaline.repeatMinSec) return "REPEAT_TOO_SOON";
        return elapsed > ERC_2025_ADULT_ALS_PROFILE.adrenaline.repeatMaxSec
          ? "OVERDUE_GUIDELINE_ELIGIBLE" : "GUIDELINE_ELIGIBLE";
      }
      if (context.rhythmClassification === "NON_SHOCKABLE") return "GUIDELINE_ELIGIBLE";
      if (context.rhythmClassification === "SHOCKABLE") return context.shockAttemptCount < 3
        ? "TOO_EARLY_FOR_SHOCKABLE_ALGORITHM" : "GUIDELINE_ELIGIBLE";
      return "WRONG_RHYTHM";
    }
    if (command.drugId === "AMIODARONE" || command.drugId === "LIDOCAINE") {
      if (context.cardiacState !== "ARREST") return "OUTSIDE_CARDIAC_ARREST_CONTEXT";
      if (context.rhythmClassification !== "SHOCKABLE") return "WRONG_RHYTHM";
      const alternative = command.drugId === "AMIODARONE" ? "LIDOCAINE" : "AMIODARONE";
      if (previous.some(item => item.drugId === alternative)) return "ANTIARRHYTHMIC_STRATEGY_CONFLICT";
      const doses = previous.filter(item => item.drugId === command.drugId);
      if (doses.length >= 2) return "DUPLICATE_COURSE_DOSE";
      const profile = command.drugId === "AMIODARONE" ? ERC_2025_ADULT_ALS_PROFILE.amiodarone :
        ERC_2025_ADULT_ALS_PROFILE.lidocaine;
      const index = doses.length;
      if (!sameDose(command.dose, profile.doseSequenceMg[index])) return doses.some(item => sameDose(item.dose, command.dose))
        ? "DUPLICATE_COURSE_DOSE" : "WRONG_DOSE";
      return context.shockAttemptCount < profile.shockSequence[index] ? "WRONG_SHOCK_COUNT" : "GUIDELINE_ELIGIBLE";
    }
    if (command.drugId === "ATROPINE") {
      if (context.cardiacState === "ARREST") return "INAPPROPRIATE_IN_CARDIAC_ARREST";
      if (context.rhythm !== "SINUS_BRADYCARDIA") return "WRONG_RHYTHM";
      if (!context.adverseSigns) return "BRADYCARDIA_ADVERSE_SIGNS_REQUIRED";
      if (!sameDose(command.dose, ERC_2025_ADULT_ALS_PROFILE.atropine.doseMcg)) return "WRONG_DOSE";
      const doses = previous.filter(item => item.drugId === "ATROPINE");
      if (doses.reduce((sum, item) => sum + item.dose, 0) + command.dose >
        ERC_2025_ADULT_ALS_PROFILE.atropine.maximumCumulativeMcg) return "CUMULATIVE_DOSE_EXCEEDED";
      if (doses.length && command.simulationTimeSec - doses.at(-1)!.simulationTimeSec <
        ERC_2025_ADULT_ALS_PROFILE.atropine.repeatMinSec) return "REPEAT_TOO_SOON";
      return "GUIDELINE_ELIGIBLE";
    }
    if (command.drugId === "ADENOSINE") {
      if (context.cardiacState === "ARREST") return "INAPPROPRIATE_IN_CARDIAC_ARREST";
      if (context.rhythm !== "REGULAR_NARROW_COMPLEX_SVT") return "WRONG_RHYTHM";
      const doses = previous.filter(item => item.drugId === "ADENOSINE");
      if (doses.length >= ERC_2025_ADULT_ALS_PROFILE.adenosine.doseSequenceMg.length) {
        return "DUPLICATE_COURSE_DOSE";
      }
      return sameDose(command.dose, ERC_2025_ADULT_ALS_PROFILE.adenosine.doseSequenceMg[doses.length])
        ? "GUIDELINE_ELIGIBLE" : "SEQUENCE_MISMATCH";
    }
    if (command.drugId === "MAGNESIUM_SULFATE") {
      if (!sameDose(command.dose, ERC_2025_ADULT_ALS_PROFILE.magnesium.doseMg)) return "WRONG_DOSE";
      return context.rhythm === "TORSADES_DE_POINTES" ? "GUIDELINE_ELIGIBLE" : "WRONG_RHYTHM";
    }
    const referenceDose = command.drugId === "CALCIUM_CHLORIDE"
      ? ERC_2025_ADULT_ALS_PROFILE.calciumChloride.doseMl
      : ERC_2025_ADULT_ALS_PROFILE.sodiumBicarbonate.doseMmol;
    if (!sameDose(command.dose, referenceDose)) return "WRONG_DOSE";
    if (context.hyperkalaemiaSubstrate === "UNMODELED") return "SUBSTRATE_UNMODELED";
    if (context.hyperkalaemiaSubstrate === "HYPERKALAEMIA_WITH_ECG_CHANGES") return "GUIDELINE_ELIGIBLE";
    return "SPECIFIC_INDICATION_REQUIRED";
  }

  private reject(command: AlsMedicationCommand,
    rejectionReason: AlsMedicationRejectionReason): AlsMedicationCommandResult {
    this.events.push(Object.freeze({ eventType: "AlsMedicationCommandRejected", commandId: command.commandId,
      administrationId: command.administrationId, patientId: command.patientId, drugId: command.drugId,
      timestamp: command.simulationTimeSec, rejectionReason }));
    return Object.freeze({ status: "REJECTED", commandId: command.commandId, rejectionReason });
  }

  private remember(command: AlsMedicationCommand, result: AlsMedicationCommandResult): AlsMedicationCommandResult {
    this.commandResults.set(command.commandId, structuredClone(result));
    return structuredClone(result);
  }

  private ordered(): AlsMedicationAdministrationState[] {
    return [...this.administrations.values()].sort((a, b) => a.simulationTimeSec - b.simulationTimeSec ||
      a.administrationId.localeCompare(b.administrationId));
  }
}
