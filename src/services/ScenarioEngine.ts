import {
  getAllPendingScenarioEvents,

  markScenarioEventExecuted,
} from "@/repositories/ScenarioRepository";

import { notifySync } from "@/services/SyncService";

import { executeScenarioEvent } from "@/services/WorkflowExecutor";

import type { GoldenActualEvent, GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { OwnershipRule } from "@/models/ModuleImport";
import type { BotulismRootPatientProcessRuntime, HypoxiaPatientProcessRuntime, PatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import type { ResourceRuntimeEvent, RuntimeIntervention, RuntimeResource, ResourceType } from "@/models/ResourceRuntime";
import {
  applyHvAction,
  applyHvTimedTransition,
  bootstrapHvPatientProcess,
  tickHvPatientProcess,
  type HvAction,
  type HvTimedTransition,
} from "@/services/runtime/HvPatientProcess";
import { markOxygenMaskingWarning } from "@/services/runtime/HvPatientProcess";
import {
  applyHypoxiaOxygen,
  bootstrapHypoxiaPatientProcess,
  tickHypoxiaPatientProcess,
} from "@/services/runtime/HypoxiaPatientProcess";
import { bootstrapBotulismRoot, tickBotulismRoot } from "@/services/runtime/BotulismRootPatientProcess";
import { InterventionEngine } from "@/services/runtime/InterventionEngine";
import { ResourcePool } from "@/services/runtime/ResourcePool";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import { aggregateRuntimeState } from "@/services/runtime/RuntimeAggregationPipeline";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

export function runScenarioEvents(

  currentMinute: number

): void {

  const events = getAllPendingScenarioEvents();

  events.forEach((event) => {

    if (event.triggerMinute <= currentMinute) {

      const wasExecuted = executeScenarioEvent(event);

      if (wasExecuted) {
        markScenarioEventExecuted(event.id, currentMinute);
      }

    }

  });

  notifySync();

}

const firstClinicalOwnershipRules: OwnershipRule[] = [{
  objectType: "RuntimeField",
  objectOrField: "ventilationReserve / co2Burden",
  canonicalOwner: "HYPOVENTILATION_HYPERCAPNIA_V1",
  contributionAllowedFrom: "BOTULISM_V1 through HV child activation",
  aggregationOrWriteRule: "LATEST attributable owner value",
  conflictAction: "REJECT_CONFLICTING_OWNER",
}, {
  objectType: "RuntimeField",
  objectOrField: "airwayProtected / effectiveVentilationActive / directOxygenEffectOnCO2 / ventilationEffectCount / definitiveControl / causeControlled / respiratoryArrest / mentalStatusSourceModule / mentalStatusSourceProcessType / CO2Trend",
  canonicalOwner: "HYPOVENTILATION_HYPERCAPNIA_V1",
  contributionAllowedFrom: "CORE_ENGINE",
  aggregationOrWriteRule: "LATEST attributable owner value",
  conflictAction: "REJECT_CONFLICTING_OWNER",
}, {
  objectType: "RuntimeField",
  objectOrField: "oxygenationReserve / SpO2Trend / SpO2Owner",
  canonicalOwner: "HYPOXIA_V1",
  contributionAllowedFrom: "HYPOVENTILATION_HYPERCAPNIA_V1 through Hypoxia child activation",
  aggregationOrWriteRule: "LATEST attributable owner value",
  conflictAction: "REJECT_CONFLICTING_OWNER",
}, {
  objectType: "RuntimeField",
  objectOrField: "mentalStatusCode",
  canonicalOwner: "CORE_ENGINE",
  contributionAllowedFrom: "HYPOVENTILATION_HYPERCAPNIA_V1",
  aggregationOrWriteRule: "MOST_SEVERE attributable limitation",
  conflictAction: "REJECT_UNATTRIBUTED_CHANGE",
}, {
  objectType: "RuntimeField",
  objectOrField: "globalStatus",
  canonicalOwner: "CORE_ENGINE",
  contributionAllowedFrom: "All active processes",
  aggregationOrWriteRule: "MOST_SEVERE valid status proposal",
  conflictAction: "REJECT_DIRECT_OVERRIDE",
}];

function initialRuntimeState(fixture: GoldenFixture, process: PatientProcessRuntime): RuntimeState {
  return {
    encounterId: process.encounterId,
    stateVersion: 0,
    exerciseTimeSec: 0,
    globalStatus: "Stable",
    targetVitals: {},
    displayedVitals: {},
    mentalStatusCode: "Alert",
    symptomTags: [],
    visibleFindings: [],
    activeAlerts: [],
    runtimeFields: structuredClone(process.outputs.runtimeContributions ?? {}),
    vitalAttribution: {},
    statusAttribution: { supportingProcessIds: [] },
    manualOverrideActive: false,
    overrideMap: {},
    aggregationConfigVersion: "WP-5/HV-001",
    randomSeed: fixture.seed,
  };
}

function eventPayload(event: GoldenInputEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

const resourceTypes = new Set<ResourceType>([
  "oxygen", "oxygenMask", "BVM", "ventilator", "endotrachealTube", "monitor",
]);

function fixtureResources(value: unknown): RuntimeResource[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).resources)
      ? (value as Record<string, unknown>).resources as unknown[]
      : [];
  return source.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const type = String(row.type) as ResourceType;
    if (!resourceTypes.has(type) || !row.resourceId) return [];
    return [{
      resourceId: String(row.resourceId), type,
      status: row.status === "RESERVED" ? "RESERVED" as const : "AVAILABLE" as const,
      assignedPatientId: row.assignedPatientId ? String(row.assignedPatientId) : undefined,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? structuredClone(row.metadata as Record<string, unknown>) : {},
    }];
  });
}

export class ClinicalScenarioEngine {
  private process?: PatientProcessRuntime;
  private botulismRoot?: BotulismRootPatientProcessRuntime;
  private hypoxiaProcesses = new Map<string, HypoxiaPatientProcessRuntime>();
  private runtimeState?: RuntimeState;
  private simulationTimeSec = 0;
  private sequence = 0;
  private eventLog: GoldenActualEvent[] = [];
  private pendingTransitions: { dueSec: number; transition: HvTimedTransition }[] = [];
  private processControlledEventPending = false;
  private readonly appliedEventIds = new Set<string>();
  private readonly resolver = new RuntimeOwnershipResolver(firstClinicalOwnershipRules);
  private resourcePool = new ResourcePool();
  private interventionEngine = new InterventionEngine();

  reset(fixture: GoldenFixture): void {
    const initial = eventPayload({ payload: fixture.initialState } as GoldenInputEvent);
    const isBotulism = Array.isArray(initial.processAssignments) || Array.isArray(initial.botulismProcesses);
    this.botulismRoot = isBotulism ? bootstrapBotulismRoot(fixture) : undefined;
    const respiratory = this.botulismRoot?.children.find(child => child.processType === "BOT_RESPIRATORY_MUSCLE_FAILURE");
    const explicitHv = initial.hv && typeof initial.hv === "object" ? initial.hv as Record<string, unknown> : undefined;
    const botulismHv = isBotulism ? {
      processType: "HYPOVENTILATION_HYPERCAPNIA",
      processId: `${respiratory?.processId ?? this.botulismRoot!.processId}:HV_NM_SEV`,
      instanceKey: `${respiratory?.instanceKey ?? "root"}:hv`, templateId: "HV_NM_SEV",
      ventilationReserve: Number(explicitHv?.ventilationReserve ?? respiratory?.initialReserve ?? 50),
      reserveLossPerMin: 0, co2Burden: Number(explicitHv?.co2Burden ?? 42), co2GainPerMin: 0,
    } : undefined;
    const hvInitial = botulismHv ?? (initial.hv && typeof initial.hv === "object"
      ? { processType: "HYPOVENTILATION_HYPERCAPNIA", reserveLossPerMin: 3.8, co2GainPerMin: 4, ...(initial.hv as object) }
      : fixture.initialState);
    this.process = bootstrapHvPatientProcess({ ...fixture, initialState: hvInitial });
    if (respiratory) {
      this.process.parentProcessId = respiratory.processId;
      this.process.parentProcessType = respiratory.processType;
    }
    this.hypoxiaProcesses.clear();
    if (initial.hypoxia && typeof initial.hypoxia === "object") {
      const child = bootstrapHypoxiaPatientProcess(fixture, initial.hypoxia as Record<string, unknown>, this.parentRef());
      this.hypoxiaProcesses.set(child.processId, child);
    }
    if (isBotulism && respiratory && respiratory.initialReserve <= 20) {
      const child = bootstrapHypoxiaPatientProcess(fixture, {
        templateId: "HYP_HYPOVENT_MOD", processId: `${this.process.processId}:HYP_HYPOVENT_MOD`,
      }, this.parentRef());
      this.hypoxiaProcesses.set(child.processId, child);
    }
    this.runtimeState = initialRuntimeState(fixture, this.process);
    this.simulationTimeSec = 0;
    this.sequence = 0;
    this.eventLog = [];
    this.pendingTransitions = [];
    this.processControlledEventPending = false;
    this.appliedEventIds.clear();
    this.resourcePool = new ResourcePool(fixtureResources(fixture.activeResources));
    this.interventionEngine = new InterventionEngine();
    if (this.botulismRoot) this.aggregateProcesses(this.runtimeState);
  }

  advanceTo(simulationTimeSec: number): void {
    if (!Number.isFinite(simulationTimeSec) || simulationTimeSec < this.simulationTimeSec) {
      throw new Error("Simulatsiooniaeg peab liikuma deterministlikult edasi.");
    }
    const targetTime = simulationTimeSec;
    if (this.botulismRoot) this.botulismRoot = tickBotulismRoot(this.botulismRoot, targetTime);
    const due = this.pendingTransitions.filter((item) => item.dueSec <= simulationTimeSec)
      .sort((left, right) => left.dueSec - right.dueSec || left.transition.localeCompare(right.transition));
    this.pendingTransitions = this.pendingTransitions.filter((item) => item.dueSec > simulationTimeSec);
    for (const item of due) {
      this.simulationTimeSec = item.dueSec;
      if (item.transition === "HYPOVENTILATION_HYPOXIA_TRIGGERED") this.activateHypoxiaChild();
      else {
        this.process = applyHvTimedTransition(this.requireProcess(), item.transition);
        this.aggregateProcesses();
        this.logEvent(item.transition);
      }
    }
    this.simulationTimeSec = targetTime;
  }

  dispatch(event: GoldenInputEvent): void {
    const process = this.requireProcess();
    const runtimeState = this.requireRuntimeState();
    if (this.appliedEventIds.has(event.eventId)) return;
    if (this.botulismRoot && event.eventType === "ENCOUNTER_ACTIVATE") {
      this.appliedEventIds.add(event.eventId);
      this.logEvent("ENCOUNTER_ACTIVATED", { parentProcessId: this.botulismRoot.processId }, event.target);
      return;
    }
    if (this.botulismRoot && event.eventType === "PROGRESSION_CHECK") {
      if (process.clinicalState.co2Burden >= 76 && !process.clinicalState.mentalStatusSourceModule) {
        this.process = applyHvTimedTransition(process, "CO2_NARCOSIS_TRIGGERED");
        this.aggregateProcesses();
      }
      this.appliedEventIds.add(event.eventId);
      this.logEvent("PROGRESSION_CHECKED", { parentProcessId: this.botulismRoot.processId }, event.target);
      return;
    }
    if (this.botulismRoot && event.eventType === "ASPIRATION_EVENT") {
      const cranial = this.botulismRoot.children.find(child => child.processType === "BOT_CRANIAL_BULBAR");
      if (!cranial) throw new Error("Botulism cranial child puudub aspiratsiooni käivitamiseks.");
      const child = bootstrapHypoxiaPatientProcess({
        fixtureId: this.botulismRoot.encounterId, fixtureType: "Runtime", patientId: this.botulismRoot.encounterId,
        seed: Number(runtimeState.randomSeed), clockState: "Running", ownershipVersion: 1,
        initialState: {}, activeResources: {}, loadedModules: ["BOTULISM_V1", "HYPOXIA_V1"],
      }, { templateId: "HYP_ASP_MOD", processId: `${cranial.processId}:HYP_ASP_MOD`, instanceKey: `${this.botulismRoot.encounterId}:asp` }, {
        processId: cranial.processId, processType: cranial.processType, instanceKey: cranial.instanceKey,
      });
      this.hypoxiaProcesses.set(child.processId, child);
      this.aggregateProcesses();
      this.appliedEventIds.add(event.eventId);
      this.logEvent("ASPIRATION_RISK_TRIGGERED", { parentProcessId: cranial.processId }, event.target, child);
      return;
    }
    if (this.botulismRoot && event.eventType === "SNAPSHOT") {
      this.appliedEventIds.add(event.eventId);
      return;
    }
    if (this.botulismRoot && event.eventType === "ACTION" && event.actionId === "ORAL_FLUID_GIVEN") {
      this.appliedEventIds.add(event.eventId);
      this.logEvent("ACTION_APPLIED", { actionId: event.actionId, parentProcessId: this.botulismRoot.processId }, event.target);
      return;
    }
    if (event.eventType === "ACTION") {
      const allowed = new Set<HvAction>([
        "OXYGEN_HIGH_FLOW", "INTUBATION", "BVM_VENTILATION", "MECHANICAL_VENTILATION",
      ]);
      if (!event.actionId || !allowed.has(event.actionId as HvAction)) {
        throw new Error(`NOT_IMPLEMENTED: HV action ${event.actionId ?? "puudub"}.`);
      }
      this.process = applyHvAction(process, event.actionId as HvAction);
      if (event.actionId === "OXYGEN_HIGH_FLOW") {
        for (const [id, child] of this.hypoxiaProcesses) this.hypoxiaProcesses.set(id, applyHypoxiaOxygen(child));
      }
      this.processControlledEventPending ||= event.actionId === "MECHANICAL_VENTILATION";
      this.aggregateProcesses();
      this.appliedEventIds.add(event.eventId);
      this.logEvent("ACTION_APPLIED", { actionId: event.actionId, inputEventId: event.eventId });
      return;
    }
    if (event.eventType === "THRESHOLD_HOLD") {
      const payload = eventPayload(event);
      const field = String(payload.field);
      const durationSec = Number(payload.durationSec);
      const transition = field === "co2Burden"
        ? "CO2_NARCOSIS_TRIGGERED"
        : field === "ventilationReserve" && Number(payload.value) === 0
          ? "RESPIRATORY_ARREST"
          : field === "ventilationReserve" && Number(payload.value) <= 60
            ? "HYPOVENTILATION_HYPOXIA_TRIGGERED"
          : undefined;
      if (!transition || !Number.isFinite(durationSec) || durationSec < 0) {
        throw new Error(`NOT_IMPLEMENTED: HV threshold ${field}.`);
      }
      if (transition !== "HYPOVENTILATION_HYPOXIA_TRIGGERED" ||
        (!this.hypoxiaProcesses.size && !this.pendingTransitions.some(item => item.transition === transition))) {
        this.pendingTransitions.push({ dueSec: this.simulationTimeSec + durationSec, transition });
      }
      this.appliedEventIds.add(event.eventId);
      this.logEvent("THRESHOLD_HOLD_STARTED", {
        sourceProcessId: process.processId, field, durationSec, inputEventId: event.eventId,
      });
      return;
    }
    if (event.eventType === "TRIGGER_REEVALUATION") {
      this.appliedEventIds.add(event.eventId);
      return;
    }
    if (event.eventType !== "ENGINE_TICK") {
      throw new Error(`NOT_IMPLEMENTED: ClinicalScenarioEngine sündmus ${event.eventType}.`);
    }
    this.resourcePool.update(this.simulationTimeSec);
    for (const resourceEvent of this.interventionEngine.applyDue(this.simulationTimeSec, this.resourcePool)) {
      this.logResourceEvent(resourceEvent);
    }
    const payload = eventPayload(event);
    const tickMinutes = Number(payload.tickMin ?? payload.elapsedMin);
    if (!Number.isFinite(tickMinutes) || tickMinutes <= 0) {
      throw new Error("ENGINE_TICK payload.tickMin peab olema positiivne arv.");
    }
    this.process = tickHvPatientProcess(process, tickMinutes * 60);
    for (const [id, child] of [...this.hypoxiaProcesses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      this.hypoxiaProcesses.set(id, tickHypoxiaPatientProcess(child, tickMinutes * 60));
    }
    this.aggregateProcesses(runtimeState);
    this.appliedEventIds.add(event.eventId);
    for (const child of this.sortedHypoxia()) {
      this.logEvent("PROCESS_TICK_APPLIED", {
        inputEventId: event.eventId, tickSeconds: tickMinutes * 60,
      }, child.processId, child);
    }
    this.logEvent("ENGINE_TICK_APPLIED", {
      sourceProcessId: this.process.processId,
      inputEventId: event.eventId,
      tickSeconds: tickMinutes * 60,
    });
    if (this.processControlledEventPending) {
      this.logEvent("PROCESS_CONTROLLED", {}, event.target);
      this.processControlledEventPending = false;
    }
    this.emitOxygenMaskingWarning(event.target);
  }

  getPatientProcess(): PatientProcessRuntime {
    return structuredClone(this.requireProcess());
  }

  getPatientProcesses(): (PatientProcessRuntime | HypoxiaPatientProcessRuntime)[] {
    return [this.requireProcess(), ...this.sortedHypoxia()].map(item => structuredClone(item));
  }

  getBotulismRoot(): BotulismRootPatientProcessRuntime | undefined {
    return this.botulismRoot ? structuredClone(this.botulismRoot) : undefined;
  }

  getRuntimeState(): RuntimeState {
    return structuredClone(this.requireRuntimeState());
  }

  getEventLog(): GoldenActualEvent[] {
    return structuredClone(this.eventLog);
  }

  scheduleIntervention(intervention: RuntimeIntervention): void {
    this.interventionEngine.schedule(intervention);
  }

  getResourcePoolSnapshot(): RuntimeResource[] {
    return this.resourcePool.snapshot();
  }

  getAssignedResources(patientId: string): RuntimeResource[] {
    return this.resourcePool.getAssignedResources(patientId);
  }

  getResourcePoolHash(): string {
    return this.resourcePool.hash();
  }

  getHashes(): { stateHash: string; eventLogHash: string; processTreeHash: string; resourcePoolHash: string; replayHash: string } {
    const stateHash = sha256Text(stableJson(this.requireRuntimeState()));
    const eventLogHash = sha256Text(stableJson(this.eventLog));
    const processTreeHash = sha256Text(stableJson({ root: this.botulismRoot, processes: this.getPatientProcesses() }));
    const resourcePoolHash = this.resourcePool.hash();
    const interventionHash = sha256Text(stableJson(this.interventionEngine.snapshot()));
    return {
      stateHash,
      eventLogHash,
      processTreeHash,
      resourcePoolHash,
      replayHash: sha256Text(stableJson({ stateHash, eventLogHash, processTreeHash, resourcePoolHash, interventionHash })),
    };
  }

  private requireProcess(): PatientProcessRuntime {
    if (!this.process) throw new Error("ClinicalScenarioEngine fixture pole laaditud.");
    return this.process;
  }

  private requireRuntimeState(): RuntimeState {
    if (!this.runtimeState) throw new Error("ClinicalScenarioEngine fixture pole laaditud.");
    return this.runtimeState;
  }

  private aggregateProcesses(previous = this.requireRuntimeState()): void {
    const processes = [this.requireProcess(), ...this.sortedHypoxia()];
    const aggregated = aggregateRuntimeState({
      previous,
      expectedStateVersion: previous.stateVersion,
      exerciseTimeSec: this.simulationTimeSec,
      processOutputs: processes.map(process => process.outputs),
      aggregationConfigVersion: this.hypoxiaProcesses.size ? "WP-7/HV-HYPOXIA" : "WP-6/HV-P0",
    }, this.resolver);
    if (aggregated.rejectedProcessIds.length > 0 ||
      aggregated.events.some((event) => event.eventType === "PROCESS_OUTPUT_REJECTED")) {
      throw new Error(`PatientProcess output lükati ownership'i või agregatsiooni poolt tagasi.`);
    }
    this.runtimeState = aggregated.state;
  }

  private logEvent(
    eventType: string,
    details: Record<string, unknown> = {},
    target?: string,
    source: PatientProcessRuntime | HypoxiaPatientProcessRuntime = this.requireProcess()
  ): void {
    this.sequence += 1;
    this.eventLog.push({
      eventType,
      sourceModule: source.processType === "HYPOXIA" ? "HYPOXIA_V1" : "HYPOVENTILATION_HYPERCAPNIA_V1",
      target: target ?? source.processId,
      simulationTime: this.simulationTimeSec,
      enginePhase: 2,
      sequence: this.sequence,
      payload: {
        sourceProcessId: source.processId,
        instanceKey: source.instanceKey,
        ...(source.parentProcessId ? { parentProcessId: source.parentProcessId } : {}),
        ...details,
      },
    });
  }

  private logResourceEvent(event: ResourceRuntimeEvent): void {
    this.sequence += 1;
    this.eventLog.push({
      eventType: event.eventType,
      sourceModule: "CORE_ENGINE",
      target: event.patientId,
      simulationTime: event.timestamp,
      enginePhase: 1,
      sequence: this.sequence,
      payload: {
        timestamp: event.timestamp,
        resourceId: event.resourceId,
        patientId: event.patientId,
        interventionId: event.interventionId,
        ...(event.sourceProcessId ? { sourceProcessId: event.sourceProcessId } : {}),
      },
    });
  }

  private sortedHypoxia(): HypoxiaPatientProcessRuntime[] {
    return [...this.hypoxiaProcesses.values()].sort((a, b) => a.processId.localeCompare(b.processId));
  }

  private parentRef(): { processId: string; processType: string; instanceKey: string } {
    const process = this.requireProcess();
    return { processId: process.processId, processType: process.processType, instanceKey: process.instanceKey };
  }

  private activateHypoxiaChild(): void {
    if (this.hypoxiaProcesses.size) return;
    const fixture: GoldenFixture = {
      fixtureId: this.requireProcess().encounterId,
      fixtureType: "Runtime",
      patientId: this.requireProcess().encounterId,
      initialState: {},
      seed: Number(this.requireRuntimeState().randomSeed),
      clockState: "Running",
      ownershipVersion: 1,
      activeResources: [],
      loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
    };
    const child = bootstrapHypoxiaPatientProcess(fixture, {
      templateId: "HYP_HYPOVENT_MOD", processId: `${this.requireProcess().processId}:HYP_HYPOVENT_MOD`,
    }, this.parentRef());
    this.hypoxiaProcesses.set(child.processId, child);
    this.aggregateProcesses();
    this.logEvent("HYPOVENTILATION_HYPOXIA_TRIGGERED", {}, this.requireProcess().processId);
  }

  private emitOxygenMaskingWarning(target?: string): void {
    const hv = this.requireProcess();
    if (!hv.clinicalState.oxygenTherapyActive || hv.clinicalState.co2Trend !== "WORSENING" ||
      hv.clinicalState.oxygenMaskingWarningEmitted ||
      !this.sortedHypoxia().some(child => child.clinicalState.spo2Trend === "IMPROVING")) return;
    this.process = markOxygenMaskingWarning(hv);
    this.aggregateProcesses();
    this.logEvent("OXYGEN_MASKING_WARNING", {}, target);
  }
}
