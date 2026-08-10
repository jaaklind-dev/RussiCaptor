import type { GoldenFixture } from "@/models/GoldenTest";
import type {
  CardiacArrestConfiguration, CardiacArrestPatientProcessRuntime, CardiacProcessEvidence,
  CardiacRhythm, CardiacRhythmClassification, CardiacRhythmTransition, CardiacState,
} from "@/models/PatientProcessRuntime";
import type { ProcessOutput } from "@/models/RuntimeAggregation";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";

export type CardiacArrestDiagnosticCode =
  | "INVALID_CONFIGURATION" | "INVALID_INITIAL_STATE" | "DUPLICATE_TRANSITION"
  | "AMBIGUOUS_TRANSITION" | "INVALID_TRANSITION";

export class CardiacArrestConfigurationError extends Error {
  constructor(readonly code: CardiacArrestDiagnosticCode, message: string) {
    super(message); this.name = "CardiacArrestConfigurationError";
  }
}

const moduleId = "CARDIAC_ARREST_V1";
const rhythms: readonly CardiacRhythm[] = ["ASYSTOLE", "PEA", "PERFUSING", "PULSELESS_VT", "VF"];
const states: readonly CardiacState[] = ["ARREST", "PERFUSING", "ROSC"];

export const defaultCardiacArrestConfiguration: CardiacArrestConfiguration = Object.freeze({
  version: "WP-36/V1",
  initialState: "ARREST",
  initialRhythm: "VF",
  initialCprActive: false,
  vitalTargets: Object.freeze({
    arrestWithoutCpr: Object.freeze({ heartRate: 0, systolicBp: 0, diastolicBp: 0, respiratoryRate: 0, gcs: 3 }),
    arrestWithCpr: Object.freeze({ heartRate: 100, systolicBp: 40, diastolicBp: 20, respiratoryRate: 0, gcs: 3 }),
    perfusing: Object.freeze({ heartRate: 80, systolicBp: 110, diastolicBp: 70, respiratoryRate: 16, gcs: 15 }),
    rosc: Object.freeze({ heartRate: 90, systolicBp: 90, diastolicBp: 55, respiratoryRate: 10, gcs: 6 }),
  }),
  transitions: Object.freeze([]),
});

export function classifyCardiacRhythm(rhythm: CardiacRhythm): CardiacRhythmClassification {
  if (rhythm === "VF" || rhythm === "PULSELESS_VT") return "SHOCKABLE";
  if (rhythm === "PEA" || rhythm === "ASYSTOLE") return "NON_SHOCKABLE";
  return "PERFUSING";
}

function fail(code: CardiacArrestDiagnosticCode, message: string): never {
  throw new CardiacArrestConfigurationError(code, message);
}

function isRhythm(value: unknown): value is CardiacRhythm { return rhythms.includes(value as CardiacRhythm); }
function isState(value: unknown): value is CardiacState { return states.includes(value as CardiacState); }
function compatible(state: CardiacState, rhythm: CardiacRhythm): boolean {
  return state === "ARREST" ? classifyCardiacRhythm(rhythm) !== "PERFUSING" : rhythm === "PERFUSING";
}

function transitionKey(value: CardiacRhythmTransition): string {
  const triggerValue = value.trigger === "TIME" ? value.atSec : value.trigger === "SHOCK" ? value.shockAttempt : value.transitionId;
  return `${value.trigger}:${value.fromRhythm}:${triggerValue}:${value.priority}`;
}

export function validateCardiacArrestConfiguration(configuration: CardiacArrestConfiguration): CardiacArrestConfiguration {
  if (!configuration.version || !isState(configuration.initialState) || !isRhythm(configuration.initialRhythm)) {
    fail("INVALID_CONFIGURATION", "Cardiac arrest configuration identity or initial value is invalid.");
  }
  if (!compatible(configuration.initialState, configuration.initialRhythm)) {
    fail("INVALID_INITIAL_STATE", `State ${configuration.initialState} is incompatible with rhythm ${configuration.initialRhythm}.`);
  }
  const ids = new Set<string>(); const keys = new Set<string>();
  for (const item of configuration.transitions) {
    if (!item.transitionId || !isRhythm(item.fromRhythm) || !isRhythm(item.toRhythm) || !Number.isFinite(item.priority)) {
      fail("INVALID_TRANSITION", "Cardiac rhythm transition is malformed.");
    }
    if (ids.has(item.transitionId)) fail("DUPLICATE_TRANSITION", `Duplicate transition ${item.transitionId}.`);
    ids.add(item.transitionId);
    const key = transitionKey(item);
    if (keys.has(key)) fail("AMBIGUOUS_TRANSITION", `Ambiguous transition ${key}.`);
    keys.add(key);
    if (item.trigger === "TIME" && (!Number.isFinite(item.atSec) || Number(item.atSec) < 0)) fail("INVALID_TRANSITION", `${item.transitionId} requires non-negative atSec.`);
    if (item.trigger === "SHOCK" && (!Number.isInteger(item.shockAttempt) || Number(item.shockAttempt) < 1)) fail("INVALID_TRANSITION", `${item.transitionId} requires positive shockAttempt.`);
    if (item.trigger === "SHOCK" && classifyCardiacRhythm(item.fromRhythm) !== "SHOCKABLE" && item.toRhythm !== item.fromRhythm) {
      fail("INVALID_TRANSITION", `${item.transitionId} cannot convert a non-shockable rhythm.`);
    }
  }
  for (const targets of Object.values(configuration.vitalTargets)) for (const value of Object.values(targets)) {
    if (!Number.isFinite(value)) fail("INVALID_CONFIGURATION", "Cardiac vital target must be finite.");
  }
  return structuredClone(configuration);
}

function configured(override?: Partial<CardiacArrestConfiguration>): CardiacArrestConfiguration {
  return validateCardiacArrestConfiguration({
    ...defaultCardiacArrestConfiguration, ...override,
    vitalTargets: {
      arrestWithoutCpr: { ...defaultCardiacArrestConfiguration.vitalTargets.arrestWithoutCpr, ...override?.vitalTargets?.arrestWithoutCpr },
      arrestWithCpr: { ...defaultCardiacArrestConfiguration.vitalTargets.arrestWithCpr, ...override?.vitalTargets?.arrestWithCpr },
      perfusing: { ...defaultCardiacArrestConfiguration.vitalTargets.perfusing, ...override?.vitalTargets?.perfusing },
      rosc: { ...defaultCardiacArrestConfiguration.vitalTargets.rosc, ...override?.vitalTargets?.rosc },
    },
    transitions: [...(override?.transitions ?? defaultCardiacArrestConfiguration.transitions)],
  });
}

function output(process: Omit<CardiacArrestPatientProcessRuntime, "outputs">): ProcessOutput {
  const { clinicalState, configuration } = process;
  const targets = clinicalState.cardiacState === "ARREST"
    ? clinicalState.cprActive ? configuration.vitalTargets.arrestWithCpr : configuration.vitalTargets.arrestWithoutCpr
    : clinicalState.cardiacState === "ROSC" ? configuration.vitalTargets.rosc : configuration.vitalTargets.perfusing;
  return {
    processId: process.processId, encounterId: process.encounterId, moduleId,
    status: process.state, globalSeverityScore: clinicalState.cardiacState === "ARREST" ? 1 : clinicalState.cardiacState === "ROSC" ? 0.7 : 0,
    vitalPriority: 1000, respiratoryPriority: 1000, neurologicPriority: 1000, statusPriority: 1000,
    vitalContributions: [
      { vital: "heartRate", operation: "TARGET", value: targets.heartRate },
      { vital: "systolicBp", operation: "TARGET", value: targets.systolicBp },
      { vital: "diastolicBp", operation: "TARGET", value: targets.diastolicBp },
      { vital: "respiratoryRate", operation: "TARGET", value: targets.respiratoryRate },
      { vital: "gcs", operation: "TARGET", value: targets.gcs },
    ],
    statusProposal: clinicalState.cardiacState === "ARREST" ? "Arrest" : "Critical",
    observedAtSec: process.elapsedTime,
  };
}

function withOutput(process: Omit<CardiacArrestPatientProcessRuntime, "outputs">): CardiacArrestPatientProcessRuntime {
  return { ...process, outputs: output(process) };
}

export function bootstrapCardiacArrestPatientProcess(
  fixture: Pick<GoldenFixture, "fixtureId" | "patientId">,
  initial: Record<string, unknown>,
  configurationOverride?: Partial<CardiacArrestConfiguration>
): CardiacArrestPatientProcessRuntime {
  const configuration = configured(configurationOverride);
  const processId = String(initial.processId ?? "CARDIAC_ARREST");
  const process = {
    processId, encounterId: fixture.patientId ?? `GOLDEN-${fixture.fixtureId}`,
    instanceKey: String(initial.instanceKey ?? `${processId}:primary`), processType: "CARDIAC_ARREST" as const,
    templateId: String(initial.templateId ?? "CARDIAC_ARREST_V1"), state: "Active" as const, elapsedTime: 0,
    clinicalState: {
      cardiacState: configuration.initialState, rhythm: configuration.initialRhythm,
      rhythmClassification: classifyCardiacRhythm(configuration.initialRhythm), cprActive: configuration.initialCprActive,
      oxygenTherapyActive: false as const, shockAttemptCount: 0, appliedEffectIds: [],
    },
    configuration, nextTick: Number(initial.nextTick ?? 1), pendingEvidence: [],
  };
  return withOutput(process);
}

function chooseTransition(process: CardiacArrestPatientProcessRuntime, trigger: "TIME" | "SHOCK", value: number): CardiacRhythmTransition | undefined {
  return [...process.configuration.transitions].filter(item => item.trigger === trigger && item.fromRhythm === process.clinicalState.rhythm &&
    (trigger === "TIME" ? Number(item.atSec) <= value : item.shockAttempt === value))
    .sort((a, b) => b.priority - a.priority || a.transitionId.localeCompare(b.transitionId))[0];
}

export function applyExplicitCardiacRhythmTransition(
  process: CardiacArrestPatientProcessRuntime,
  transitionId: string
): CardiacArrestPatientProcessRuntime {
  const selected = process.configuration.transitions.find(item => item.trigger === "EXPLICIT" &&
    item.transitionId === transitionId && item.fromRhythm === process.clinicalState.rhythm);
  if (!selected) fail("INVALID_TRANSITION", `Explicit transition ${transitionId} is not valid from ${process.clinicalState.rhythm}.`);
  return transition(process, selected);
}

function transition(process: CardiacArrestPatientProcessRuntime, item: CardiacRhythmTransition): CardiacArrestPatientProcessRuntime {
  const fromRhythm = process.clinicalState.rhythm;
  const toState: CardiacState = item.toRhythm === "PERFUSING" ? "ROSC" : "ARREST";
  const evidence: CardiacProcessEvidence[] = [{ eventType: "CARDIAC_RHYTHM_TRANSITION", details: { transitionId: item.transitionId, fromRhythm, toRhythm: item.toRhythm, trigger: item.trigger } }];
  if (toState === "ROSC" && process.clinicalState.cardiacState === "ARREST") evidence.push({ eventType: "ROSC_ACHIEVED", details: { fromRhythm } });
  if (toState === "ARREST" && process.clinicalState.cardiacState !== "ARREST") evidence.push({ eventType: "CARDIAC_REARREST", details: { toRhythm: item.toRhythm } });
  const next = { ...process, state: toState === "ARREST" ? "Active" as const : "Controlled" as const,
    clinicalState: { ...process.clinicalState, cardiacState: toState, rhythm: item.toRhythm,
      rhythmClassification: classifyCardiacRhythm(item.toRhythm), cprActive: toState === "ARREST" && process.clinicalState.cprActive },
    pendingEvidence: [...process.pendingEvidence, ...evidence] };
  return withOutput(next);
}

export function applyCardiacArrestClinicalEffect(previous: CardiacArrestPatientProcessRuntime, effect: ClinicalEffect): CardiacArrestPatientProcessRuntime {
  if (previous.clinicalState.appliedEffectIds.includes(effect.effectId)) return previous;
  let next = { ...previous, clinicalState: { ...previous.clinicalState, appliedEffectIds: [...previous.clinicalState.appliedEffectIds, effect.effectId].sort() }, pendingEvidence: [...previous.pendingEvidence] };
  if (effect.effectType === "CPR_STARTED" && !next.clinicalState.cprActive) {
    next.clinicalState.cprActive = true; next.pendingEvidence.push({ eventType: "CPR_STARTED", details: {} });
  } else if (effect.effectType === "CPR_STOPPED" && next.clinicalState.cprActive) {
    next.clinicalState.cprActive = false; next.pendingEvidence.push({ eventType: "CPR_STOPPED", details: {} });
  } else if (effect.effectType === "DEFIBRILLATION_ATTEMPT") {
    const attempt = next.clinicalState.shockAttemptCount + 1; next.clinicalState.shockAttemptCount = attempt;
    next.pendingEvidence.push({ eventType: "DEFIBRILLATION_ATTEMPTED", details: { attempt, rhythm: next.clinicalState.rhythm, shockable: next.clinicalState.rhythmClassification === "SHOCKABLE" } });
    const selected = next.clinicalState.rhythmClassification === "SHOCKABLE" ? chooseTransition(next, "SHOCK", attempt) : undefined;
    if (selected) next = transition(withOutput(next), selected);
  }
  return withOutput(next);
}

export function tickCardiacArrestPatientProcess(previous: CardiacArrestPatientProcessRuntime, tickSeconds: number): CardiacArrestPatientProcessRuntime {
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) throw new CardiacArrestConfigurationError("INVALID_CONFIGURATION", "Cardiac tick duration must be positive.");
  const elapsedTime = previous.elapsedTime + tickSeconds;
  let next = withOutput({ ...previous, elapsedTime, nextTick: previous.nextTick + tickSeconds });
  const selected = chooseTransition(next, "TIME", elapsedTime);
  if (selected) next = transition(next, selected);
  return next;
}

export function drainCardiacEvidence(previous: CardiacArrestPatientProcessRuntime): { process: CardiacArrestPatientProcessRuntime; evidence: CardiacProcessEvidence[] } {
  return { process: { ...previous, pendingEvidence: [] }, evidence: structuredClone(previous.pendingEvidence) };
}
