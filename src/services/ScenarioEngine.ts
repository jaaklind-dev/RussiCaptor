import {
  getAllPendingScenarioEvents,

  markScenarioEventExecuted,
} from "@/repositories/ScenarioRepository";

import { notifySync } from "@/services/SyncService";

import { executeScenarioEvent } from "@/services/WorkflowExecutor";

import type { GoldenActualEvent, GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { OwnershipRule } from "@/models/ModuleImport";
import type { BotulismRootPatientProcessRuntime, CardiacArrestPatientProcessRuntime, HypoxiaPatientProcessRuntime, PatientProcessRuntime, RespiratoryFailurePatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import type { ClinicalEffect, ClinicalProcessRuntime } from "@/models/ClinicalIntegration";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { AirwayState } from "@/models/AirwayState";
import type { AssessmentRule, AssessmentSnapshot } from "@/models/ClinicalAssessment";
import type { CirculationState } from "@/models/CirculationState";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import type { MedicationAdministration, MedicationDefinition, MedicationInstance } from "@/models/MedicationRuntime";
import type { ResourceRuntimeEvent, RuntimeResource, ResourceType, SchedulableIntervention } from "@/models/ResourceRuntime";
import {
  type HvAction,
  type HvTimedTransition,
} from "@/services/runtime/HvPatientProcess";
import { InterventionEngine } from "@/services/runtime/InterventionEngine";
import { ResourcePool } from "@/services/runtime/ResourcePool";
import { publishResourceRuntimeDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { publishRuntimeSnapshot } from "@/services/RuntimeSnapshotService";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import { aggregateRuntimeState } from "@/services/runtime/AlignedRuntimePipeline";
import { ClinicalIntegrationFramework } from "@/services/runtime/clinical/ClinicalIntegrationFramework";
import { ClinicalProcessRegistry } from "@/services/runtime/clinical/ClinicalProcessRegistry";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";
import { InterventionRuntime } from "@/services/runtime/clinical/InterventionRuntime";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { AirwayManagementFramework } from "@/services/runtime/clinical/AirwayManagementFramework";
import { ClinicalAssessmentEngine } from "@/services/runtime/assessment/ClinicalAssessmentEngine";
import { circulationInterventionDefinitions } from "@/services/runtime/clinical/CirculationInterventionDefinitions";
import { CirculationManagementFramework } from "@/services/runtime/clinical/CirculationManagementFramework";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { publishAssessmentDebugSnapshot } from "@/services/AssessmentRuntimeDebugService";
import { hvClinicalProcessHandler } from "@/services/runtime/clinical/handlers/HvClinicalProcessHandler";
import { hypoxiaClinicalProcessHandler } from "@/services/runtime/clinical/handlers/HypoxiaClinicalProcessHandler";
import { cardiacArrestClinicalProcessHandler } from "@/services/runtime/clinical/handlers/CardiacArrestClinicalProcessHandler";
import { cardiacArrestInterventionDefinitions } from "@/services/runtime/clinical/CardiacArrestInterventionDefinitions";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { projectVitalSignState } from "@/services/runtime/vitals/VitalSignProjection";
import type { VitalSignConfiguration, VitalSignEvent, VitalSignKey } from "@/models/VitalSign";
import type { CanonicalLifecycleProcess, PatientProcessEvidence, PatientProcessPhaseContext } from "@/models/PatientProcessLifecycle";
import { createProductionPatientProcessLifecyclePlan, isClinicalProcess } from "@/services/runtime/lifecycle/ProductionPatientProcessLifecycle";

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
  objectOrField: "estimatedBloodLossMl / cumulativeBloodLossMl / bleedingRateMlMin / hemorrhageSeverity / perfusionState / compensationState / HRTrend / BPTrend / PerfusionTrend",
  canonicalOwner: "HEMORRHAGE_V1", contributionAllowedFrom: "CORE_ENGINE",
  aggregationOrWriteRule: "LATEST attributable owner value", conflictAction: "REJECT_CONFLICTING_OWNER",
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
  const initial = eventPayload({ payload: fixture.initialState } as GoldenInputEvent);
  const baselineSource = initial.baselineVitals && typeof initial.baselineVitals === "object"
    ? initial.baselineVitals as Record<string, unknown> : {};
  const aliases: Record<VitalSignKey, string[]> = {
    heartRate: ["heartRate", "hr"], systolicBp: ["systolicBp", "sbp"], diastolicBp: ["diastolicBp", "dbp"],
    respiratoryRate: ["respiratoryRate", "rr"], spo2: ["spo2"], etco2: ["etco2"],
    temperature: ["temperature"], gcs: ["gcs"], crt: ["crt"],
  };
  const vitalSignConfiguration: VitalSignConfiguration = structuredClone(defaultVitalSignConfiguration);
  for (const [key, names] of Object.entries(aliases) as [VitalSignKey, string[]][]) {
    const value = names.map(name => baselineSource[name]).find(item => typeof item === "number" && Number.isFinite(item));
    if (typeof value === "number") vitalSignConfiguration.signs[key].baseline = value;
  }
  const vitalSignState = new VitalSignEngine().resolve({ timestamp: 0, configuration: vitalSignConfiguration, contributors: [] }).state;
  const vitalProjection = projectVitalSignState(vitalSignState);
  return {
    encounterId: process.encounterId,
    stateVersion: 0,
    exerciseTimeSec: 0,
    globalStatus: "Stable",
    targetVitals: vitalProjection.targetVitals,
    displayedVitals: vitalProjection.displayedVitals,
    vitalSignState,
    mapCalculated: vitalProjection.mapCalculated,
    gcsTarget: vitalProjection.gcsTarget,
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
    vitalSignConfiguration,
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
  "nasalCannula", "simpleMask", "nonRebreatherMask", "bagValveMask",
  "oropharyngealAirway", "nasopharyngealAirway", "iGel", "laryngealMask",
  "videoLaryngoscope", "directLaryngoscope", "suction", "capnography",
  "peripheralIV", "centralVenousCatheter", "intraosseousAccess", "pressureBag",
  "fluidWarmer", "infusionPump", "bloodAdministrationSet", "rapidInfuser",
  "tourniquet", "pelvicBinder",
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
      exclusiveGroup: row.exclusiveGroup ? String(row.exclusiveGroup) : undefined,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? structuredClone(row.metadata as Record<string, unknown>) : {},
    }];
  });
}

export class ClinicalScenarioEngine {
  private readonly lifecyclePlan = createProductionPatientProcessLifecyclePlan();
  private readonly lifecycleProcessStore = new Map<string, CanonicalLifecycleProcess>();
  private runtimeState?: RuntimeState;
  private simulationTimeSec = 0;
  private sequence = 0;
  private eventLog: GoldenActualEvent[] = [];
  private resourceEventLog: ResourceRuntimeEvent[] = [];
  private pendingTransitions: { dueSec: number; transition: HvTimedTransition }[] = [];
  private processControlledEventPending = false;
  private readonly appliedEventIds = new Set<string>();
  private readonly resolver = new RuntimeOwnershipResolver(firstClinicalOwnershipRules);
  private resourcePool = new ResourcePool();
  private interventionEngine = new InterventionEngine();
  private readonly clinicalIntegration = new ClinicalIntegrationFramework(
    new ClinicalProcessRegistry([hvClinicalProcessHandler, hypoxiaClinicalProcessHandler, cardiacArrestClinicalProcessHandler])
  );
  private readonly interventionRuntime = new InterventionRuntime(
    new InterventionDefinitionRegistry([...airwayInterventionDefinitions, ...circulationInterventionDefinitions, ...cardiacArrestInterventionDefinitions])
  );
  private readonly airwayManagement = new AirwayManagementFramework();
  private readonly assessmentEngine = new ClinicalAssessmentEngine();
  private readonly circulationManagement = new CirculationManagementFramework();
  private assessmentRules: AssessmentRule[] = [];
  private readonly medicationEngine = new MedicationEngine();
  private vitalSignEvents: VitalSignEvent[] = [];

  reset(fixture: GoldenFixture): void {
    this.lifecycleProcessStore.clear();
    const bootstrapped: CanonicalLifecycleProcess[] = [];
    for (const descriptor of this.lifecyclePlan.forPhase("BOOTSTRAP")) {
      const result = descriptor.bootstrap!({ fixture, existingProcesses: structuredClone(bootstrapped) });
      for (const created of result.processes) {
        bootstrapped.push(created);
        this.replaceLifecycleProcess(created);
      }
    }
    this.runtimeState = initialRuntimeState(fixture, this.requireProcess());
    this.simulationTimeSec = 0;
    this.sequence = 0;
    this.eventLog = [];
    this.resourceEventLog = [];
    this.pendingTransitions = [];
    this.processControlledEventPending = false;
    this.appliedEventIds.clear();
    this.resourcePool = new ResourcePool(fixtureResources(fixture.activeResources));
    this.interventionEngine = new InterventionEngine();
    this.clinicalIntegration.reset();
    this.interventionRuntime.reset();
    this.airwayManagement.reset();
    this.circulationManagement.reset();
    this.medicationEngine.reset();
    this.vitalSignEvents = [];
    publishRuntimeSnapshot(this.runtimeState, this.orderedLifecycleLeaves("SERIALIZATION").map(process => ({
      processId: process.outputs.processId, moduleId: process.outputs.moduleId, status: process.outputs.status,
      ...(process.processType === "CARDIAC_ARREST" ? { clinicalState: structuredClone(process.clinicalState) } : {}),
    })));
    this.publishResourceDebugSnapshot();
    this.publishAssessmentSnapshot(true);
    if (this.rootProcess()) this.aggregateProcesses(this.runtimeState);
  }

  advanceTo(simulationTimeSec: number): void {
    if (!Number.isFinite(simulationTimeSec) || simulationTimeSec < this.simulationTimeSec) {
      throw new Error("Simulatsiooniaeg peab liikuma deterministlikult edasi.");
    }
    const targetTime = simulationTimeSec;
    for (const medicationEvent of this.medicationEngine.advanceTo(targetTime)) this.logEvent(medicationEvent.eventType, medicationEvent, medicationEvent.patientId);
    const root = this.rootProcess();
    if (root) {
      const descriptor = this.lifecyclePlan.descriptor(root.processType);
      const context = this.lifecyclePhaseContext(targetTime, 0, []);
      const result = descriptor.advance!(root, context);
      result.processes.forEach(process => this.replaceLifecycleProcess(process));
    }
    const due = this.pendingTransitions.filter((item) => item.dueSec <= simulationTimeSec)
      .sort((left, right) => left.dueSec - right.dueSec || left.transition.localeCompare(right.transition));
    this.pendingTransitions = this.pendingTransitions.filter((item) => item.dueSec > simulationTimeSec);
    for (const item of due) {
      this.simulationTimeSec = item.dueSec;
      if (item.transition === "HYPOVENTILATION_HYPOXIA_TRIGGERED") this.activateHypoxiaChild();
      else {
        const descriptor = this.lifecyclePlan.forPhase("ADVANCE").find(item => item.order.advanceOrder === 200);
        if (!descriptor) throw new Error("HV lifecycle advance handler puudub.");
        const result = descriptor.advance!(this.requireProcess(), this.lifecyclePhaseContext(
          this.simulationTimeSec, 0, [], undefined, item.transition
        ));
        result.processes.forEach(process => this.replaceLifecycleProcess(process));
        if (result.aggregationRequested) this.aggregateProcesses();
        this.logEvent(item.transition);
      }
    }
    this.simulationTimeSec = targetTime;
  }

  dispatch(event: GoldenInputEvent): void {
    const process = this.requireProcess();
    const runtimeState = this.requireRuntimeState();
    if (this.appliedEventIds.has(event.eventId)) return;
    const inputContext = { event: structuredClone(event), simulationTimeSec: this.simulationTimeSec,
      runtimeState: structuredClone(runtimeState), existingProcesses: structuredClone([...this.lifecycleProcessStore.values()]) };
    for (const descriptor of this.lifecyclePlan.forPhase("HANDLE_INPUT")) {
      for (const current of this.lifecycleProcesses(descriptor.processType)) {
        const result = descriptor.handleInput!(current, inputContext);
        if (!result) continue;
        result.processes.forEach(item => this.replaceLifecycleProcess(item));
        if (result.aggregationRequested) this.aggregateProcesses();
        this.appliedEventIds.add(event.eventId);
        result.events.forEach(item => this.recordLifecycleEvidence(item));
        return;
      }
    }
    if (event.eventType === "ACTION") {
      const allowed = new Set<HvAction>([
        "OXYGEN_HIGH_FLOW", "INTUBATION", "BVM_VENTILATION", "MECHANICAL_VENTILATION",
      ]);
      if (!event.actionId || !allowed.has(event.actionId as HvAction)) {
        throw new Error(`NOT_IMPLEMENTED: HV action ${event.actionId ?? "puudub"}.`);
      }
      this.applyClinicalEffect(this.effectForAction(event.eventId, event.actionId as HvAction), false);
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
        (!this.sortedHypoxia().length && !this.pendingTransitions.some(item => item.transition === transition))) {
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
      const changedInstance = this.interventionRuntime.consumeResourceEvent(
        resourceEvent, this.requireProcess().encounterId, this.resourcePool.snapshot(), this.airwayClinicalContext()
      );
      if (changedInstance) {
        for (const airwayEvent of this.airwayManagement.apply(changedInstance)) {
          this.logEvent(airwayEvent.eventType, {
            interventionInstanceId: airwayEvent.interventionInstanceId,
            definitionId: airwayEvent.definitionId,
            airwayState: airwayEvent.airwayState,
            ventilationState: airwayEvent.ventilationState,
          }, airwayEvent.patientId);
        }
        for (const circulationEvent of this.circulationManagement.apply(changedInstance)) {
          this.logEvent(circulationEvent.eventType, {
            interventionInstanceId: circulationEvent.interventionInstanceId,
            definitionId: circulationEvent.definitionId,
          }, circulationEvent.patientId);
        }
      }
      if (changedInstance?.definitionId === "OXYGEN_THERAPY" && changedInstance.status === "CANCELLED" &&
        !this.interventionRuntime.active(changedInstance.patientId).some(item => item.definitionId === "OXYGEN_THERAPY")) {
        this.applyClinicalEffect({
          effectId: `${changedInstance.instanceId}:STOP:${resourceEvent.timestamp}`,
          effectType: "INSPIRED_OXYGEN_REMOVED",
          encounterId: changedInstance.encounterId,
          patientId: changedInstance.patientId,
          timestamp: resourceEvent.timestamp,
          sourceInterventionInstanceId: changedInstance.instanceId,
          parameters: {},
        }, true);
      }
    }
    const activeEffects = [...this.interventionRuntime.effectsAt(this.simulationTimeSec), ...this.medicationEngine.activeEffects()]
      .sort((a,b) => a.effectType.localeCompare(b.effectType) || a.effectId.localeCompare(b.effectId));
    for (const descriptor of this.lifecyclePlan.forPhase("PREPARE")) {
      for (const current of this.lifecycleProcesses(descriptor.processType)) {
        const result = descriptor.prepare!(current, this.lifecyclePhaseContext(this.simulationTimeSec, 0, activeEffects, event));
        result.processes.forEach(process => this.replaceLifecycleProcess(process));
      }
    }
    for (const effect of activeEffects) {
      if (["REDUCE_EXTERNAL_BLEEDING", "STOP_EXTERNAL_BLEEDING", "PELVIC_STABILIZATION", "INFUSION_RUNNING", "BLOOD_PRODUCT_STARTED"].includes(effect.effectType)) continue;
      this.applyClinicalEffect(effect, true);
    }
    const payload = eventPayload(event);
    const tickMinutes = Number(payload.tickMin ?? payload.elapsedMin);
    if (!Number.isFinite(tickMinutes) || tickMinutes <= 0) {
      throw new Error("ENGINE_TICK payload.tickMin peab olema positiivne arv.");
    }
    const tickContext = this.lifecyclePhaseContext(this.simulationTimeSec, tickMinutes * 60, activeEffects, event);
    for (const descriptor of this.lifecyclePlan.forPhase("TICK")) {
      const phaseProcesses = descriptor.order.tickOrder === 100 ? [process] : this.lifecycleProcesses(descriptor.processType);
      for (const current of phaseProcesses) {
        const result = descriptor.tick!(current, tickContext);
        result.processes.forEach(process => this.replaceLifecycleProcess(process));
        result.events.filter(item => item.recordPhase === "BEFORE_AGGREGATION").forEach(item => this.recordLifecycleEvidence(item));
      }
    }
    this.aggregateProcesses(runtimeState);
    this.appliedEventIds.add(event.eventId);
    for (const descriptor of this.lifecyclePlan.forPhase("POST_AGGREGATE")) {
      for (const current of this.lifecycleProcesses(descriptor.processType)) {
        descriptor.postAggregate!(current, tickContext).forEach(item => this.recordLifecycleEvidence(item));
      }
    }
    if (this.processControlledEventPending) {
      this.logEvent("PROCESS_CONTROLLED", {}, event.target);
      this.processControlledEventPending = false;
    }
    for (const descriptor of this.lifecyclePlan.forPhase("FINALIZE")) {
      for (const current of this.lifecycleProcesses(descriptor.processType)) {
        const result = descriptor.finalize!(current, this.lifecyclePhaseContext(
          this.simulationTimeSec, tickMinutes * 60, activeEffects, event
        ));
        result.processes.forEach(process => this.replaceLifecycleProcess(process));
        if (result.aggregationRequested) this.aggregateProcesses();
        result.events.forEach(item => this.recordLifecycleEvidence(item));
      }
    }
    this.publishResourceDebugSnapshot();
  }

  getPatientProcess(): PatientProcessRuntime {
    return structuredClone(this.requireProcess());
  }

  getPatientProcesses(): (PatientProcessRuntime | HypoxiaPatientProcessRuntime | RespiratoryFailurePatientProcessRuntime | CardiacArrestPatientProcessRuntime | HemorrhagePatientProcessRuntime)[] {
    return this.orderedLifecycleLeaves("SERIALIZATION").map(item => structuredClone(item)) as
      (PatientProcessRuntime | HypoxiaPatientProcessRuntime | RespiratoryFailurePatientProcessRuntime | CardiacArrestPatientProcessRuntime | HemorrhagePatientProcessRuntime)[];
  }

  /** Generic canonical intervention entry point for resource-free clinical actions. */
  startClinicalIntervention(input: {
    sourceInterventionId: string; definitionId: string; patientId: string;
    parameters?: Record<string, import("@/models/ClinicalIntegration").ClinicalParameterValue>;
  }): InterventionInstance {
    return this.interventionRuntime.startAllocated({ ...input, encounterId: this.requireProcess().encounterId,
      startedAt: this.simulationTimeSec, resourceIds: [], clinicalContext: this.airwayClinicalContext() });
  }

  stopClinicalIntervention(sourceInterventionId: string): InterventionInstance | undefined {
    return this.interventionRuntime.finishBySource(sourceInterventionId, "CANCELLED", this.simulationTimeSec);
  }

  getBotulismRoot(): BotulismRootPatientProcessRuntime | undefined {
    const root = this.rootProcess();
    return root ? structuredClone(root) : undefined;
  }

  getRuntimeState(): RuntimeState {
    const state = structuredClone(this.requireRuntimeState());
    if (!state.vitalSignState) return state;
    return { ...state, ...projectVitalSignState(state.vitalSignState) };
  }

  getVitalSignEvents(): VitalSignEvent[] { return structuredClone(this.vitalSignEvents); }

  getEventLog(): GoldenActualEvent[] {
    return structuredClone(this.eventLog);
  }

  /** Instructor command boundary: process transition first, canonical aggregation second. */
  injectRespiratoryDeterioration(commandId: string, patientId: string, simulationTimeSec: number): { ok: true; runtimeEventId: string } | { ok: false; reason: string } {
    const process = this.requireProcess();
    if (patientId !== process.encounterId) return { ok: false, reason: "Patient runtime is not available" };
    if (simulationTimeSec !== this.simulationTimeSec) return { ok: false, reason: "Command simulation time does not match the runtime" };
    const runtimeEventId = `INSTRUCTOR:${commandId}:RESPIRATORY_DETERIORATION`;
    if (this.appliedEventIds.has(runtimeEventId)) return { ok: true, runtimeEventId };
    const descriptor = this.lifecyclePlan.forPhase("ADVANCE").find(item => item.order.advanceOrder === 200);
    if (!descriptor) return { ok: false, reason: "HV lifecycle advance handler is not available" };
    const result = descriptor.advance!(process, this.lifecyclePhaseContext(
      simulationTimeSec, 0, [], undefined, "CO2_NARCOSIS_TRIGGERED"
    ));
    result.processes.forEach(item => this.replaceLifecycleProcess(item));
    this.aggregateProcesses();
    this.appliedEventIds.add(runtimeEventId);
    this.logEvent("INSTRUCTOR_EVENT_APPLIED", { commandId, eventType: "RESPIRATORY_DETERIORATION", sourceProcessId: process.processId }, patientId);
    return { ok: true, runtimeEventId };
  }

  scheduleIntervention(intervention: SchedulableIntervention): void {
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

  getInterventionInstances(patientId?: string): InterventionInstance[] {
    return patientId ? this.interventionRuntime.forPatient(patientId) : this.interventionRuntime.snapshot();
  }

  getAirwayState(patientId = this.requireProcess().encounterId): AirwayState {
    return this.airwayManagement.getState(patientId);
  }

  getCirculationState(patientId = this.requireProcess().encounterId): CirculationState {
    return this.circulationManagement.getState(patientId);
  }

  installMedicationDefinitions(definitions: MedicationDefinition[]): void { this.medicationEngine.installDefinitions(definitions); }
  administerMedication(administration: MedicationAdministration): void {
    const result = this.medicationEngine.administer(administration, this.getCirculationState(administration.patientId));
    for (const event of result.events) this.logEvent(event.eventType, event, event.patientId);
    this.publishResourceDebugSnapshot();
  }
  cancelMedication(administrationId: string, timestamp: number): void {
    const event = this.medicationEngine.cancel(administrationId, timestamp); this.logEvent(event.eventType, event, event.patientId); this.publishResourceDebugSnapshot();
  }
  getMedicationState(patientId?: string): MedicationInstance[] {
    return this.medicationEngine.snapshot().instances.filter(x => !patientId || x.patientId === patientId);
  }

  setAssessmentRules(rules: AssessmentRule[]): void {
    this.assessmentRules = structuredClone(rules);
    this.publishAssessmentSnapshot(true);
  }

  getAssessmentSnapshot(): AssessmentSnapshot {
    return this.assessmentEngine.evaluate(this.assessmentRules, {
      timestamp: this.simulationTimeSec,
      runtimeState: this.requireRuntimeState(),
      eventLog: this.getEventLog(),
      interventionLog: structuredClone(this.resourceEventLog),
      interventionInstances: this.interventionRuntime.snapshot(),
      resourcePool: this.resourcePool.snapshot(),
      airwayState: this.getAirwayState(),
      clinicalEffects: this.clinicalIntegration.snapshot().events,
      timeline: this.getEventLog(),
    });
  }

  getHashes(): { stateHash: string; eventLogHash: string; processTreeHash: string; resourcePoolHash: string; replayHash: string } {
    const stateHash = sha256Text(stableJson(this.requireRuntimeState()));
    const eventLogHash = sha256Text(stableJson(this.eventLog));
    const processTreeHash = sha256Text(stableJson({ root: this.rootProcess(), processes: this.getPatientProcesses() }));
    const resourcePoolHash = this.resourcePool.hash();
    const interventionHash = sha256Text(stableJson(this.interventionEngine.snapshot()));
    const clinicalIntegrationHash = sha256Text(stableJson({
      framework: this.clinicalIntegration.snapshot(), instances: this.interventionRuntime.snapshot(),
      airway: this.airwayManagement.snapshot(),
      circulation: this.circulationManagement.snapshot(),
      assessment: this.getAssessmentSnapshot(),
      medication: this.medicationEngine.snapshot(),
      vitalSigns: { state: this.runtimeState?.vitalSignState, events: this.vitalSignEvents },
    }));
    return {
      stateHash,
      eventLogHash,
      processTreeHash,
      resourcePoolHash,
      replayHash: sha256Text(stableJson({
        stateHash, eventLogHash, processTreeHash, resourcePoolHash, interventionHash, clinicalIntegrationHash,
      })),
    };
  }

  private requireProcess(): PatientProcessRuntime {
    const process = this.orderedLifecycleLeaves("SERIALIZATION").find(item =>
      this.lifecyclePlan.descriptor(item.processType).order.serializationSlot === 100
    );
    if (!process) throw new Error("ClinicalScenarioEngine fixture pole laaditud.");
    return process as PatientProcessRuntime;
  }

  private requireRuntimeState(): RuntimeState {
    if (!this.runtimeState) throw new Error("ClinicalScenarioEngine fixture pole laaditud.");
    return this.runtimeState;
  }

  private aggregateProcesses(previous = this.requireRuntimeState()): void {
    const processes = this.orderedLifecycleLeaves("AGGREGATION");
    const aggregated = aggregateRuntimeState({
      previous,
      expectedStateVersion: previous.stateVersion,
      exerciseTimeSec: this.simulationTimeSec,
      processOutputs: processes.map(process => process.outputs),
      aggregationConfigVersion: this.sortedHypoxia().length ? "WP-7/HV-HYPOXIA" : "WP-6/HV-P0",
    }, this.resolver);
    if (aggregated.rejectedProcessIds.length > 0 ||
      aggregated.events.some((event) => event.eventType === "PROCESS_OUTPUT_REJECTED")) {
      throw new Error(`PatientProcess output lükati ownership'i või agregatsiooni poolt tagasi.`);
    }
    this.runtimeState = aggregated.state;
    publishRuntimeSnapshot(this.runtimeState, processes.map(process => ({
      processId: process.outputs.processId, moduleId: process.outputs.moduleId, status: process.outputs.status,
      ...(process.processType === "CARDIAC_ARREST" ? {
        clinicalState: structuredClone(process.clinicalState),
        lastEvent: this.eventLog.filter(event => event.target === process.processId).at(-1)
          ? { type: this.eventLog.filter(event => event.target === process.processId).at(-1)!.eventType,
            simulationTimeSec: this.eventLog.filter(event => event.target === process.processId).at(-1)!.simulationTime ?? this.simulationTimeSec }
          : undefined,
      } : {}),
    })));
    for (const event of aggregated.events.filter(item => ["VitalSignChanged", "TrendChanged", "MonitorStateChanged"].includes(item.eventType))) {
      this.vitalSignEvents.push({
        eventType: event.eventType as VitalSignEvent["eventType"], timestamp: this.simulationTimeSec,
        vital: event.field as VitalSignKey | undefined, from: event.details?.from as number | string | undefined,
        to: event.details?.to as number | string | undefined, sourceProcessId: "VITAL_SIGN_ENGINE",
      });
    }
  }

  private logEvent(
    eventType: string,
    details: Record<string, unknown> = {},
    target?: string,
    source: ClinicalProcessRuntime = this.requireProcess()
  ): void {
    this.sequence += 1;
    this.eventLog.push({
      eventType,
      sourceModule: source.outputs.moduleId,
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
    this.resourceEventLog.push(structuredClone(event));
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
        sourceProcessId: event.sourceProcessId ?? "INTERVENTION_ENGINE",
        ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
        ...(event.conflictingInterventionId ? { conflictingInterventionId: event.conflictingInterventionId } : {}),
        ...(event.exclusiveGroup ? { exclusiveGroup: event.exclusiveGroup } : {}),
        ...(event.definitionId ? { definitionId: event.definitionId } : {}),
        ...(event.parameters ? { parameters: structuredClone(event.parameters) } : {}),
      },
    });
  }

  private publishResourceDebugSnapshot(): void {
    publishResourceRuntimeDebugSnapshot({
      resources: this.resourcePool.snapshot(),
      activeInterventions: this.interventionEngine.snapshot().active,
      clinicalInterventions: this.interventionRuntime.snapshot(),
      airwayStates: this.airwayManagement.snapshot().states,
      circulationStates: this.circulationManagement.snapshot().states,
      hemorrhageProcesses: this.hemorrhageProcesses(),
      medicationState: this.medicationEngine.snapshot(),
      vitalSignStates: this.runtimeState?.vitalSignState ? [{ patientId: this.requireProcess().encounterId, state: this.runtimeState.vitalSignState }] : [],
      recentEvents: this.resourceEventLog,
      updatedAt: this.simulationTimeSec,
    });
    this.publishAssessmentSnapshot();
  }

  private sortedHypoxia(): HypoxiaPatientProcessRuntime[] {
    const descriptor = this.lifecyclePlan.descriptor("HYPOXIA");
    return this.lifecyclePlan.processesForDescriptor(descriptor, [...this.lifecycleProcessStore.values()]) as HypoxiaPatientProcessRuntime[];
  }

  private orderedLifecycleLeaves(domain: "AGGREGATION" | "SERIALIZATION"): CanonicalLifecycleProcess[] {
    return this.lifecyclePlan.orderProcesses([...this.lifecycleProcessStore.values()], domain);
  }

  private lifecycleProcesses(processType: string): CanonicalLifecycleProcess[] {
    const descriptor = this.lifecyclePlan.descriptor(processType);
    return this.lifecyclePlan.processesForDescriptor(descriptor, [...this.lifecycleProcessStore.values()]);
  }

  private replaceLifecycleProcess(process: CanonicalLifecycleProcess): void {
    this.lifecyclePlan.descriptor(process.processType);
    const existing = this.lifecycleProcessStore.get(process.processId);
    if (existing && (existing.processType !== process.processType || existing.instanceKey !== process.instanceKey ||
      existing.encounterId !== process.encounterId)) {
      throw new Error(`Lifecycle process identity conflict: ${process.processId}.`);
    }
    this.lifecycleProcessStore.set(process.processId, process);
  }

  private rootProcess(): BotulismRootPatientProcessRuntime | undefined {
    return [...this.lifecycleProcessStore.values()].find(process =>
      this.lifecyclePlan.descriptor(process.processType).kind === "ROOT"
    ) as BotulismRootPatientProcessRuntime | undefined;
  }

  private hemorrhageProcesses(): HemorrhagePatientProcessRuntime[] {
    return this.orderedLifecycleLeaves("SERIALIZATION").filter(process =>
      this.lifecyclePlan.descriptor(process.processType).order.serializationSlot === 300
    ) as HemorrhagePatientProcessRuntime[];
  }

  private lifecyclePhaseContext(
    simulationTimeSec: number,
    tickSeconds: number,
    activeEffects: readonly ClinicalEffect[],
    inputEvent?: GoldenInputEvent,
    transition?: string
  ): PatientProcessPhaseContext {
    return { simulationTimeSec, tickSeconds, activeEffects: structuredClone(activeEffects),
      runtimeState: structuredClone(this.requireRuntimeState()), inputEvent: inputEvent ? structuredClone(inputEvent) : undefined,
      existingProcesses: structuredClone([...this.lifecycleProcessStore.values()]), transition };
  }

  private recordLifecycleEvidence(evidence: PatientProcessEvidence): void {
    const source = evidence.sourceProcessId
      ? this.orderedLifecycleLeaves("SERIALIZATION").filter(isClinicalProcess).find(item => item.processId === evidence.sourceProcessId)
      : undefined;
    this.logEvent(evidence.eventType, structuredClone(evidence.details), evidence.target, source ?? this.requireProcess());
  }

  private parentRef(): { processId: string; processType: string; instanceKey: string } {
    const process = this.requireProcess();
    return { processId: process.processId, processType: process.processType, instanceKey: process.instanceKey };
  }

  private activateHypoxiaChild(): void {
    if (this.sortedHypoxia().length) return;
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
    const descriptor = this.lifecyclePlan.descriptor("HYPOXIA");
    const result = descriptor.bootstrap!({ fixture, existingProcesses: [...this.lifecycleProcessStore.values()],
      requestedConfig: { templateId: "HYP_HYPOVENT_MOD", processId: `${this.requireProcess().processId}:HYP_HYPOVENT_MOD` },
      parent: this.parentRef() });
    result.processes.forEach(process => this.replaceLifecycleProcess(process));
    this.aggregateProcesses();
    this.logEvent("HYPOVENTILATION_HYPOXIA_TRIGGERED", {}, this.requireProcess().processId);
  }

  private effectForAction(eventId: string, action: HvAction): ClinicalEffect {
    const effectType = action === "OXYGEN_HIGH_FLOW" ? "INSPIRED_OXYGEN_INCREASED" as const
      : action === "INTUBATION" ? "AIRWAY_PROTECTED" as const
        : "EFFECTIVE_VENTILATION" as const;
    return {
      effectId: `ACTION:${eventId}`,
      effectType,
      encounterId: this.requireProcess().encounterId,
      patientId: this.requireProcess().encounterId,
      timestamp: this.simulationTimeSec,
      sourceInterventionInstanceId: `ACTION:${eventId}`,
      parameters: action === "OXYGEN_HIGH_FLOW"
        ? { flowRateLMin: 15, deliveryInterface: "oxygenMask" }
        : effectType === "EFFECTIVE_VENTILATION"
          ? { mode: action === "MECHANICAL_VENTILATION" ? "MECHANICAL" : "BVM" }
          : {},
    };
  }

  private applyClinicalEffect(effect: ClinicalEffect, logEvents: boolean): void {
    const inputId = `EFFECT:${effect.effectId}`;
    const result = this.clinicalIntegration.apply({
      inputId,
      encounterId: effect.encounterId,
      patientId: effect.patientId,
      timestamp: effect.timestamp,
      inputType: "CLINICAL_EFFECT",
      source: { kind: "INTERVENTION", sourceId: effect.sourceInterventionInstanceId },
      payload: effect,
    }, this.orderedLifecycleLeaves("SERIALIZATION").filter(isClinicalProcess));
    if (result.status === "REJECTED") {
      if (logEvents) {
        const event = result.events[0];
        this.logEvent("ClinicalEffectRejected", {
          inputId, effectType: effect.effectType, reasonCode: event.reasonCode,
          sourceInterventionInstanceId: effect.sourceInterventionInstanceId,
        }, effect.patientId);
      }
      return;
    }
    if (result.status === "NO_OP") return;
    this.replaceClinicalProcesses(result.processes);
    if (logEvents) {
      for (const event of result.events) {
        const source = result.processes.find(item => item.processId === event.sourceProcessId);
        this.logEvent("ClinicalEffectApplied", {
          inputId, effectType: event.effectType,
          sourceInterventionInstanceId: effect.sourceInterventionInstanceId,
        }, effect.patientId, source ?? this.requireProcess());
      }
    }
  }

  private replaceClinicalProcesses(processes: ClinicalProcessRuntime[]): void {
    processes.forEach(process => this.replaceLifecycleProcess(process));
  }

  private airwayClinicalContext(): Record<string, boolean> {
    const mentalStatus = this.requireRuntimeState().mentalStatusCode;
    return {
      unconscious: mentalStatus === "Unresponsive" || mentalStatus === "Arrest",
      gagReflexAbsent: mentalStatus === "Unresponsive" || mentalStatus === "Arrest",
      spontaneousBreathing: !this.requireProcess().clinicalState.respiratoryArrest,
    };
  }

  private publishAssessmentSnapshot(force = false): void {
    if (!this.lifecycleProcessStore.size || !this.runtimeState) return;
    // An empty rule set has no changing assessment result. Avoid cloning the
    // ever-growing timeline on every tick in long deterministic simulations.
    if (!force && this.assessmentRules.length === 0) return;
    publishAssessmentDebugSnapshot(this.getAssessmentSnapshot());
  }
}
