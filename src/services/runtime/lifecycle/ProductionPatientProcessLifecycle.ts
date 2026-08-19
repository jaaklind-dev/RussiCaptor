import type { ClinicalProcessRuntime } from "@/models/ClinicalIntegration";
import type { CanonicalLifecycleProcess, PatientProcessLifecycleDescriptor, PatientProcessLifecycleResult } from "@/models/PatientProcessLifecycle";
import type { BotulismRootPatientProcessRuntime, CardiacArrestConfiguration, CardiacArrestPatientProcessRuntime, HypoxiaPatientProcessRuntime, PatientProcessRuntime, PleuralInjuryPatientProcessRuntime, RespiratoryFailurePatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import { bootstrapBotulismRoot, tickBotulismRoot } from "@/services/runtime/BotulismRootPatientProcess";
import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, tickHemorrhagePatientProcess } from "@/services/runtime/HemorrhagePatientProcess";
import { applyHvTimedTransition, bootstrapHvPatientProcess, markOxygenMaskingWarning, tickHvPatientProcess,
  type HvTimedTransition } from "@/services/runtime/HvPatientProcess";
import { bootstrapHypoxiaPatientProcess, tickHypoxiaPatientProcess } from "@/services/runtime/HypoxiaPatientProcess";
import { PatientProcessLifecycleRegistry } from "./PatientProcessLifecycleRegistry";
import { bootstrapCardiacArrestPatientProcess, drainCardiacEvidence, tickCardiacArrestPatientProcess } from "@/services/runtime/CardiacArrestPatientProcess";
import { bootstrapPleuralInjuryPatientProcess, tickPleuralInjuryPatientProcess } from "@/services/runtime/PleuralInjuryPatientProcess";
import { bootstrapRespiratoryFailurePatientProcess, tickRespiratoryFailurePatientProcess } from "@/services/runtime/RespiratoryFailurePatientProcess";
import type { MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { activateMassiveTransfusion, bootstrapMassiveTransfusionPatientProcess, drainMassiveTransfusionEvidence, startBloodProductAdministration, tickMassiveTransfusionPatientProcess } from "@/services/runtime/MassiveTransfusionPatientProcess";

const respiratoryImpairment = (processes: readonly CanonicalLifecycleProcess[]) => Math.max(1, ...processes.map(process => Number(process.outputs.runtimeContributions?.respiratoryImpairmentMultiplier ?? 1)));

const unchanged = (process: CanonicalLifecycleProcess): PatientProcessLifecycleResult => ({ processes: [process], events: [], aggregationRequested: false });
const initial = (fixture: { initialState: unknown }) => fixture.initialState as Record<string, unknown>;

const botulism: PatientProcessLifecycleDescriptor = {
  processType: "BOTULISM_ROOT", kind: "ROOT", requiredPhases: ["BOOTSTRAP", "ADVANCE", "HANDLE_INPUT"],
  order: { bootstrapOrder: 100, advanceOrder: 100, inputOrder: 50,
    serializationSlot: "SEPARATE_ROOT", siblingOrder: "SINGLETON" },
  bootstrap({ fixture }) {
    const source = initial(fixture); const applicable = Array.isArray(source.processAssignments) || Array.isArray(source.botulismProcesses);
    return { processes: applicable ? [bootstrapBotulismRoot(fixture)] : [], events: [], aggregationRequested: applicable };
  },
  advance(process, context) {
    return { processes: [tickBotulismRoot(process as BotulismRootPatientProcessRuntime, context.simulationTimeSec)], events: [], aggregationRequested: false };
  },
  handleInput(process, context) {
    const root = process as BotulismRootPatientProcessRuntime;
    const event = context.event;
    const primary = context.existingProcesses.find(item => item.processType === "HYPOVENTILATION_HYPERCAPNIA") as PatientProcessRuntime | undefined;
    if (event.eventType === "ENCOUNTER_ACTIVATE") return { processes: [root], aggregationRequested: false, events: [{
      eventType: "ENCOUNTER_ACTIVATED", target: event.target, details: { parentProcessId: root.processId }, recordPhase: "FINALIZE",
    }] };
    if (event.eventType === "PROGRESSION_CHECK") {
      const processes: CanonicalLifecycleProcess[] = [root];
      if (primary && primary.clinicalState.co2Burden >= 76 && !primary.clinicalState.mentalStatusSourceModule) {
        processes.push(applyHvTimedTransition(primary, "CO2_NARCOSIS_TRIGGERED"));
      }
      return { processes, aggregationRequested: processes.length > 1, events: [{ eventType: "PROGRESSION_CHECKED",
        target: event.target, details: { parentProcessId: root.processId }, recordPhase: "FINALIZE" }] };
    }
    if (event.eventType === "ASPIRATION_EVENT") {
      const cranial = root.children.find(child => child.processType === "BOT_CRANIAL_BULBAR");
      if (!cranial) throw new Error("Botulism cranial child puudub aspiratsiooni käivitamiseks.");
      const child = bootstrapHypoxiaPatientProcess({
        fixtureId: root.encounterId, fixtureType: "Runtime", patientId: root.encounterId,
        seed: Number(context.runtimeState.randomSeed), clockState: "Running", ownershipVersion: 1,
        initialState: {}, activeResources: {}, loadedModules: ["BOTULISM_V1", "HYPOXIA_V1"],
      }, { templateId: "HYP_ASP_MOD", processId: `${cranial.processId}:HYP_ASP_MOD`, instanceKey: `${root.encounterId}:asp` }, {
        processId: cranial.processId, processType: cranial.processType, instanceKey: cranial.instanceKey,
      });
      return { processes: [root, child], aggregationRequested: true, events: [{ eventType: "ASPIRATION_RISK_TRIGGERED",
        target: event.target, details: { parentProcessId: cranial.processId }, recordPhase: "FINALIZE", sourceProcessId: child.processId }] };
    }
    if (event.eventType === "SNAPSHOT") return unchanged(root);
    if (event.eventType === "ACTION" && event.actionId === "ORAL_FLUID_GIVEN") return {
      processes: [root], aggregationRequested: false, events: [{ eventType: "ACTION_APPLIED", target: event.target,
        details: { actionId: event.actionId, parentProcessId: root.processId }, recordPhase: "FINALIZE" }],
    };
    return undefined;
  },
};

const hv: PatientProcessLifecycleDescriptor = {
  processType: "HYPOVENTILATION_HYPERCAPNIA", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "ADVANCE", "TICK", "FINALIZE"],
  order: { bootstrapOrder: 200, advanceOrder: 200, tickOrder: 100, postAggregateOrder: 200, finalizeOrder: 100,
    aggregationSlot: 100, serializationSlot: 100, siblingOrder: "SINGLETON" },
  bootstrap({ fixture, existingProcesses }) {
    const source = initial(fixture); const root = existingProcesses.find(item => item.processType === "BOTULISM_ROOT") as BotulismRootPatientProcessRuntime | undefined;
    const respiratory = root?.children.find(child => child.processType === "BOT_RESPIRATORY_MUSCLE_FAILURE");
    const explicit = source.hv && typeof source.hv === "object" ? source.hv as Record<string, unknown> : undefined;
    const rootInitial = root ? { processType: "HYPOVENTILATION_HYPERCAPNIA", processId: `${respiratory?.processId ?? root.processId}:HV_NM_SEV`,
      instanceKey: `${respiratory?.instanceKey ?? "root"}:hv`, templateId: "HV_NM_SEV",
      ventilationReserve: Number(explicit?.ventilationReserve ?? respiratory?.initialReserve ?? 50), reserveLossPerMin: 0,
      co2Burden: Number(explicit?.co2Burden ?? 42), co2GainPerMin: 0 } : undefined;
    const hvInitial = rootInitial ?? (explicit ? { processType: "HYPOVENTILATION_HYPERCAPNIA", reserveLossPerMin: 3.8, co2GainPerMin: 4, ...explicit } : fixture.initialState);
    const process = bootstrapHvPatientProcess({ ...fixture, initialState: hvInitial });
    if (respiratory) { process.parentProcessId = respiratory.processId; process.parentProcessType = respiratory.processType; }
    return { processes: [process], events: [], aggregationRequested: false };
  },
  advance(process, context) {
    return context.transition
      ? { processes: [applyHvTimedTransition(process as PatientProcessRuntime, context.transition as HvTimedTransition)], events: [], aggregationRequested: true }
      : unchanged(process);
  },
  tick(process, context) { return { processes: [tickHvPatientProcess(process as PatientProcessRuntime, context.tickSeconds)], events: [], aggregationRequested: true }; },
  postAggregate(process, context) { return context.inputEvent ? [{ eventType: "ENGINE_TICK_APPLIED", details: {
    sourceProcessId: process.processId, inputEventId: context.inputEvent.eventId, tickSeconds: context.tickSeconds,
  }, recordPhase: "AFTER_AGGREGATION", sourceProcessId: process.processId }] : []; },
  finalize(process, context) {
    const hvProcess = process as PatientProcessRuntime;
    const oxygenImproving = context.existingProcesses.some(item => item.processType === "HYPOXIA" &&
      (item as HypoxiaPatientProcessRuntime).clinicalState.spo2Trend === "IMPROVING");
    if (!hvProcess.clinicalState.oxygenTherapyActive || hvProcess.clinicalState.co2Trend !== "WORSENING" ||
      hvProcess.clinicalState.oxygenMaskingWarningEmitted || !oxygenImproving) return unchanged(process);
    return { processes: [markOxygenMaskingWarning(hvProcess)], aggregationRequested: true, events: [{
      eventType: "OXYGEN_MASKING_WARNING", target: context.inputEvent?.target, details: {},
      recordPhase: "FINALIZE", sourceProcessId: hvProcess.processId,
    }] };
  },
};

const hemorrhage: PatientProcessLifecycleDescriptor = {
  processType: "HEMORRHAGE", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "PREPARE", "TICK"],
  order: { bootstrapOrder: 300, prepareOrder: 100, tickOrder: 300, aggregationSlot: 300, serializationSlot: 300, siblingOrder: "PROCESS_ID" },
  bootstrap({ fixture, existingProcesses }) {
    const source = initial(fixture); const config = source.hemorrhage;
    const configuredSources = Array.isArray(source.hemorrhageSources)
      ? source.hemorrhageSources.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[]
      : [];
    if ((!config || typeof config !== "object") && configuredSources.length === 0) return { processes: [], events: [], aggregationRequested: false };
    const primary = existingProcesses.find(item => item.processType === "HYPOVENTILATION_HYPERCAPNIA");
    if (configuredSources.length > 0) {
      const encounterId = fixture.patientId ?? primary?.encounterId ?? `GOLDEN-${fixture.fixtureId}`;
      const processes = configuredSources.map(item => bootstrapHemorrhagePatientProcess(encounterId, item))
        .sort((left, right) => left.processId.localeCompare(right.processId));
      return { processes, events: [], aggregationRequested: false };
    }
    if (!primary) throw new Error("Hemorrhage bootstrap requires the existing primary process.");
    return { processes: [bootstrapHemorrhagePatientProcess(primary.encounterId, config as Record<string, unknown>)], events: [], aggregationRequested: false };
  },
  prepare(process, context) { return { processes: [setHemorrhageEffects(process as HemorrhagePatientProcessRuntime, [...context.activeEffects])], events: [], aggregationRequested: false }; },
  tick(process, context) {
    const result = tickHemorrhagePatientProcess(process as HemorrhagePatientProcessRuntime, context.tickSeconds);
    return { processes: [result.process], aggregationRequested: true, events: result.events.map(event => ({
      eventType: event.eventType, details: event.details, target: context.inputEvent?.target,
      recordPhase: "BEFORE_AGGREGATION" as const,
      ...((process as HemorrhagePatientProcessRuntime).sourceId ? { sourceProcessId: process.processId } : {}),
    })) };
  },
};

const pleuralInjury: PatientProcessLifecycleDescriptor = {
  processType: "PLEURAL_INJURY", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "TICK"],
  order: { bootstrapOrder: 250, tickOrder: 150, aggregationSlot: 150, serializationSlot: 150, siblingOrder: "PROCESS_ID" },
  bootstrap({ fixture }) {
    const source = initial(fixture); const configured = source.pleuralInjury;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) return { processes: [], events: [], aggregationRequested: false };
    return { processes: [bootstrapPleuralInjuryPatientProcess(fixture.patientId ?? `GOLDEN-${fixture.fixtureId}`, configured as Record<string, unknown>)], events: [], aggregationRequested: false };
  },
  tick(process, context) {
    const previous = process as PleuralInjuryPatientProcessRuntime;
    const next = tickPleuralInjuryPatientProcess(previous, context.tickSeconds);
    return { processes: [next], aggregationRequested: true, events: [{ eventType: "PLEURAL_STATE_UPDATED", target: next.encounterId,
      details: { airBurden: next.clinicalState.airBurden, bloodBurdenMl: next.clinicalState.bloodBurdenMl, drainageActive: next.clinicalState.drainageActive },
      recordPhase: "BEFORE_AGGREGATION", sourceProcessId: next.processId }] };
  },
};

const respiratoryFailure: PatientProcessLifecycleDescriptor = {
  processType: "RESPIRATORY_FAILURE", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "TICK"],
  order: { bootstrapOrder: 275, tickOrder: 175, aggregationSlot: 175, serializationSlot: 175, siblingOrder: "PROCESS_ID" },
  bootstrap({ fixture, existingProcesses }) {
    const source = initial(fixture); const configured = source.respiratoryFailure;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) return { processes: [], events: [], aggregationRequested: false };
    const parent = existingProcesses.find(item => item.processType === "PLEURAL_INJURY");
    const input = configured as Record<string, unknown>;
    const process = bootstrapRespiratoryFailurePatientProcess(fixture, input,
      input.configuration && typeof input.configuration === "object" ? input.configuration as Partial<import("@/models/PatientProcessRuntime").RespiratoryFailureConfiguration> : undefined);
    if (parent) { process.parentProcessId = parent.processId; process.parentProcessType = parent.processType; }
    return { processes: [process], events: [], aggregationRequested: false };
  },
  tick(process, context) { return { processes: [tickRespiratoryFailurePatientProcess(process as RespiratoryFailurePatientProcessRuntime, context.tickSeconds, respiratoryImpairment(context.existingProcesses))], events: [], aggregationRequested: true }; },
};

const hypoxia: PatientProcessLifecycleDescriptor = {
  processType: "HYPOXIA", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "TICK", "POST_AGGREGATE"],
  order: { bootstrapOrder: 400, tickOrder: 200, postAggregateOrder: 100, aggregationSlot: 200, serializationSlot: 200, siblingOrder: "PROCESS_ID" },
  bootstrap({ fixture, existingProcesses, requestedConfig, parent: requestedParent }) {
    const source = initial(fixture); const primary = existingProcesses.find(item => item.processType === "HYPOVENTILATION_HYPERCAPNIA") as PatientProcessRuntime | undefined;
    const root = existingProcesses.find(item => item.processType === "BOTULISM_ROOT") as BotulismRootPatientProcessRuntime | undefined;
    const respiratoryParent = existingProcesses.find(item => item.processType === "RESPIRATORY_FAILURE" || item.processType === "PLEURAL_INJURY");
    if (!primary && !respiratoryParent) return { processes: [], events: [], aggregationRequested: false };
    const parent = requestedParent ?? (primary
      ? { processId: primary.processId, processType: primary.processType, instanceKey: primary.instanceKey }
      : { processId: respiratoryParent!.processId, processType: respiratoryParent!.processType, instanceKey: respiratoryParent!.instanceKey });
    const processes: HypoxiaPatientProcessRuntime[] = [];
    if (requestedConfig) processes.push(bootstrapHypoxiaPatientProcess(fixture, requestedConfig, parent));
    else if (source.hypoxia && typeof source.hypoxia === "object") processes.push(bootstrapHypoxiaPatientProcess(fixture, source.hypoxia as Record<string, unknown>, parent));
    const respiratory = root?.children.find(child => child.processType === "BOT_RESPIRATORY_MUSCLE_FAILURE");
    if (root && respiratory && respiratory.initialReserve <= 20 && processes.length === 0) processes.push(bootstrapHypoxiaPatientProcess(fixture, {
      templateId: "HYP_HYPOVENT_MOD", processId: `${primary!.processId}:HYP_HYPOVENT_MOD`,
    }, parent));
    return { processes, events: [], aggregationRequested: false };
  },
  tick(process, context) { return { processes: [tickHypoxiaPatientProcess(process as HypoxiaPatientProcessRuntime, context.tickSeconds, respiratoryImpairment(context.existingProcesses))], events: [], aggregationRequested: true }; },
  postAggregate(process, context) { return context.inputEvent ? [{ eventType: "PROCESS_TICK_APPLIED", details: {
    inputEventId: context.inputEvent.eventId, tickSeconds: context.tickSeconds,
  }, target: process.processId, recordPhase: "AFTER_AGGREGATION", sourceProcessId: process.processId }] : []; },
};

const cardiacArrest: PatientProcessLifecycleDescriptor = {
  processType: "CARDIAC_ARREST", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "TICK"],
  order: { bootstrapOrder: 500, tickOrder: 400, aggregationSlot: 400, serializationSlot: 400, siblingOrder: "SINGLETON" },
  bootstrap({ fixture }) {
    const source = initial(fixture); const cardiac = source.cardiacArrest;
    if (!cardiac || typeof cardiac !== "object" || Array.isArray(cardiac)) return { processes: [], events: [], aggregationRequested: false };
    const value = cardiac as Record<string, unknown>;
    const configuration = value.configuration && typeof value.configuration === "object" && !Array.isArray(value.configuration)
      ? value.configuration as Partial<CardiacArrestConfiguration> : value as Partial<CardiacArrestConfiguration>;
    return { processes: [bootstrapCardiacArrestPatientProcess(fixture, value, configuration)], events: [], aggregationRequested: true };
  },
  tick(process, context) {
    const ticked = tickCardiacArrestPatientProcess(process as CardiacArrestPatientProcessRuntime, context.tickSeconds);
    const drained = drainCardiacEvidence(ticked);
    return { processes: [drained.process], aggregationRequested: true, events: drained.evidence.map(event => ({
      eventType: event.eventType, details: event.details, target: process.encounterId,
      recordPhase: "BEFORE_AGGREGATION" as const, sourceProcessId: process.processId,
    })) };
  },
};

const massiveTransfusion: PatientProcessLifecycleDescriptor = {
  processType: "MASSIVE_TRANSFUSION", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "HANDLE_INPUT", "TICK"],
  order: { bootstrapOrder: 450, inputOrder: 350, tickOrder: 350, aggregationSlot: 350, serializationSlot: 350, siblingOrder: "SINGLETON" },
  bootstrap({ fixture }) {
    const source = initial(fixture); const configured = source.massiveTransfusion;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) return { processes: [], events: [], aggregationRequested: false };
    return { processes: [bootstrapMassiveTransfusionPatientProcess(fixture.patientId ?? `GOLDEN-${fixture.fixtureId}`, configured as Record<string, unknown>)], events: [], aggregationRequested: false };
  },
  tick(process, context) {
    const ticked = tickMassiveTransfusionPatientProcess(process as MassiveTransfusionPatientProcessRuntime, context.tickSeconds);
    const drained = drainMassiveTransfusionEvidence(ticked);
    return { processes: [drained.process], aggregationRequested: true, events: drained.evidence.map(event => ({ eventType: event.eventType,
      details: event.details, target: process.encounterId, recordPhase: "BEFORE_AGGREGATION" as const, sourceProcessId: process.processId })) };
  },
  handleInput(process, context) {
    const event = context.event; if (event.eventType !== "ACTION" || !event.actionId) return undefined;
    const current = process as MassiveTransfusionPatientProcessRuntime;
    let next: MassiveTransfusionPatientProcessRuntime;
    if (event.actionId === "MTP_ACTIVATION") next = activateMassiveTransfusion(current, event.eventId);
    else {
      const product = ({ RBC_ADMINISTRATION: "RBC", PLASMA_ADMINISTRATION: "PLASMA", PLATELET_ADMINISTRATION: "PLATELETS" } as const)[event.actionId as "RBC_ADMINISTRATION" | "PLASMA_ADMINISTRATION" | "PLATELET_ADMINISTRATION"];
      if (!product) return undefined;
      const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
      next = startBloodProductAdministration(current, event.eventId, product, Number(payload.units ?? 1));
    }
    const drained = drainMassiveTransfusionEvidence(next);
    return { processes: [drained.process], aggregationRequested: true, events: drained.evidence.map(item => ({ eventType: item.eventType,
      details: item.details, target: event.target, recordPhase: "FINALIZE" as const, sourceProcessId: process.processId })) };
  },
};

export const productionPatientProcessDescriptors = Object.freeze([botulism, hv, pleuralInjury, respiratoryFailure, hemorrhage, hypoxia, massiveTransfusion, cardiacArrest]);

export function createProductionPatientProcessLifecyclePlan() {
  const registry = new PatientProcessLifecycleRegistry(); productionPatientProcessDescriptors.forEach(descriptor => registry.register(descriptor));
  return registry.resolve();
}

export function isClinicalProcess(process: CanonicalLifecycleProcess): process is ClinicalProcessRuntime {
  return process.processType === "HYPOVENTILATION_HYPERCAPNIA" || process.processType === "HYPOXIA" || process.processType === "RESPIRATORY_FAILURE" || process.processType === "CARDIAC_ARREST" || process.processType === "PLEURAL_INJURY";
}

export function unchangedLifecycleResult(process: CanonicalLifecycleProcess) { return unchanged(process); }
