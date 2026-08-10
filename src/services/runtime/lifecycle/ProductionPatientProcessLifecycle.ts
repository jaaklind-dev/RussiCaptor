import type { ClinicalProcessRuntime } from "@/models/ClinicalIntegration";
import type { CanonicalLifecycleProcess, PatientProcessLifecycleDescriptor, PatientProcessLifecycleResult } from "@/models/PatientProcessLifecycle";
import type { BotulismRootPatientProcessRuntime, HypoxiaPatientProcessRuntime, PatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import { bootstrapBotulismRoot, tickBotulismRoot } from "@/services/runtime/BotulismRootPatientProcess";
import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, tickHemorrhagePatientProcess } from "@/services/runtime/HemorrhagePatientProcess";
import { applyHvTimedTransition, bootstrapHvPatientProcess, markOxygenMaskingWarning, tickHvPatientProcess,
  type HvTimedTransition } from "@/services/runtime/HvPatientProcess";
import { bootstrapHypoxiaPatientProcess, tickHypoxiaPatientProcess } from "@/services/runtime/HypoxiaPatientProcess";
import { PatientProcessLifecycleRegistry } from "./PatientProcessLifecycleRegistry";

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
  order: { bootstrapOrder: 300, prepareOrder: 100, tickOrder: 300, aggregationSlot: 300, serializationSlot: 300, siblingOrder: "SINGLETON" },
  bootstrap({ fixture, existingProcesses }) {
    const source = initial(fixture); const config = source.hemorrhage;
    if (!config || typeof config !== "object") return { processes: [], events: [], aggregationRequested: false };
    const primary = existingProcesses.find(item => item.processType === "HYPOVENTILATION_HYPERCAPNIA");
    if (!primary) throw new Error("Hemorrhage bootstrap requires the existing primary process.");
    return { processes: [bootstrapHemorrhagePatientProcess(primary.encounterId, config as Record<string, unknown>)], events: [], aggregationRequested: false };
  },
  prepare(process, context) { return { processes: [setHemorrhageEffects(process as HemorrhagePatientProcessRuntime, [...context.activeEffects])], events: [], aggregationRequested: false }; },
  tick(process, context) {
    const result = tickHemorrhagePatientProcess(process as HemorrhagePatientProcessRuntime, context.tickSeconds);
    return { processes: [result.process], aggregationRequested: true, events: result.events.map(event => ({
      eventType: event.eventType, details: event.details, target: context.inputEvent?.target,
      recordPhase: "BEFORE_AGGREGATION" as const,
    })) };
  },
};

const hypoxia: PatientProcessLifecycleDescriptor = {
  processType: "HYPOXIA", kind: "LEAF", requiredPhases: ["BOOTSTRAP", "TICK", "POST_AGGREGATE"],
  order: { bootstrapOrder: 400, tickOrder: 200, postAggregateOrder: 100, aggregationSlot: 200, serializationSlot: 200, siblingOrder: "PROCESS_ID" },
  bootstrap({ fixture, existingProcesses, requestedConfig, parent: requestedParent }) {
    const source = initial(fixture); const primary = existingProcesses.find(item => item.processType === "HYPOVENTILATION_HYPERCAPNIA") as PatientProcessRuntime | undefined;
    const root = existingProcesses.find(item => item.processType === "BOTULISM_ROOT") as BotulismRootPatientProcessRuntime | undefined;
    if (!primary) return { processes: [], events: [], aggregationRequested: false };
    const parent = requestedParent ?? { processId: primary.processId, processType: primary.processType, instanceKey: primary.instanceKey };
    const processes: HypoxiaPatientProcessRuntime[] = [];
    if (requestedConfig) processes.push(bootstrapHypoxiaPatientProcess(fixture, requestedConfig, parent));
    else if (source.hypoxia && typeof source.hypoxia === "object") processes.push(bootstrapHypoxiaPatientProcess(fixture, source.hypoxia as Record<string, unknown>, parent));
    const respiratory = root?.children.find(child => child.processType === "BOT_RESPIRATORY_MUSCLE_FAILURE");
    if (root && respiratory && respiratory.initialReserve <= 20 && processes.length === 0) processes.push(bootstrapHypoxiaPatientProcess(fixture, {
      templateId: "HYP_HYPOVENT_MOD", processId: `${primary.processId}:HYP_HYPOVENT_MOD`,
    }, parent));
    return { processes, events: [], aggregationRequested: false };
  },
  tick(process, context) { return { processes: [tickHypoxiaPatientProcess(process as HypoxiaPatientProcessRuntime, context.tickSeconds)], events: [], aggregationRequested: true }; },
  postAggregate(process, context) { return context.inputEvent ? [{ eventType: "PROCESS_TICK_APPLIED", details: {
    inputEventId: context.inputEvent.eventId, tickSeconds: context.tickSeconds,
  }, target: process.processId, recordPhase: "AFTER_AGGREGATION", sourceProcessId: process.processId }] : []; },
};

export const productionPatientProcessDescriptors = Object.freeze([botulism, hv, hemorrhage, hypoxia]);

export function createProductionPatientProcessLifecyclePlan() {
  const registry = new PatientProcessLifecycleRegistry(); productionPatientProcessDescriptors.forEach(descriptor => registry.register(descriptor));
  return registry.resolve();
}

export function isClinicalProcess(process: CanonicalLifecycleProcess): process is ClinicalProcessRuntime {
  return process.processType === "HYPOVENTILATION_HYPERCAPNIA" || process.processType === "HYPOXIA";
}

export function unchangedLifecycleResult(process: CanonicalLifecycleProcess) { return unchanged(process); }
