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
import { DEFAULT_PHYSIOLOGIC_DECOMPENSATION_CONFIG } from "@/services/runtime/PhysiologicDecompensationEngine";
import type { ClinicalEffect, ClinicalProcessRuntime } from "@/models/ClinicalIntegration";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { AirwayState } from "@/models/AirwayState";
import type { AssessmentRule, AssessmentSnapshot } from "@/models/ClinicalAssessment";
import type { CirculationState } from "@/models/CirculationState";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import { terminateHemorrhageAtDeath } from "@/services/runtime/HemorrhagePatientProcess";
import { applyExplicitCardiacRhythmTransition, bootstrapCardiacArrestPatientProcess,
  defaultCardiacArrestConfiguration } from "@/services/runtime/CardiacArrestPatientProcess";
import type { MedicationAdministration, MedicationCommandResult, MedicationDefinition, MedicationInstance } from "@/models/MedicationRuntime";
import type { NorepinephrineCommand, NorepinephrineCommandResult, NorepinephrineFeatureProjection } from "@/models/NorepinephrineInfusion";
import type { TranexamicAcidCommand, TranexamicAcidCommandResult, TranexamicAcidFeatureProjection } from "@/models/TranexamicAcid";
import type { AnalgesicCommand, AnalgesicCommandResult, AnalgesicFeatureProjection } from "@/models/AnalgesiaMedication";
import type {
  MechanicalVentilationCommand,
  MechanicalVentilationCommandResult,
  MechanicalVentilationFeatureProjection,
  MechanicalVentilationState,
} from "@/models/MechanicalVentilation";
import type {
  AlsMedicationCommand, AlsMedicationCommandResult, AlsMedicationFeatureProjection, AlsRhythmContext,
} from "@/models/AlsMedication";
import type {
  SupportedFluidTherapyCommand,
  SupportedFluidTherapyCommandResult,
  SupportedFluidTherapyProjection,
} from "@/models/FluidTherapy";
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
import { validateInterventionResourceSelection } from "@/services/runtime/clinical/InterventionResourceRequirements";
import { ResourceAwareInterventionError } from "@/services/runtime/clinical/ResourceAwareInterventionError";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { AirwayManagementFramework } from "@/services/runtime/clinical/AirwayManagementFramework";
import { ClinicalAssessmentEngine } from "@/services/runtime/assessment/ClinicalAssessmentEngine";
import { circulationInterventionDefinitions } from "@/services/runtime/clinical/CirculationInterventionDefinitions";
import { pleuralInterventionDefinitions } from "@/services/runtime/clinical/PleuralInterventionDefinitions";
import { pleuralInjuryClinicalProcessHandler } from "@/services/runtime/clinical/handlers/PleuralInjuryClinicalProcessHandler";
import { respiratoryFailureClinicalProcessHandler } from "@/services/runtime/clinical/handlers/RespiratoryFailureClinicalProcessHandler";
import { CirculationManagementFramework } from "@/services/runtime/clinical/CirculationManagementFramework";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { FIBRINOGEN_CONCENTRATE_DEFINITION, FIBRINOGEN_CONCENTRATE_ID } from
  "@/services/runtime/medication/FibrinogenConcentrate";
import { ANALGESIC_PRODUCT_CONFIGURATIONS } from "@/services/runtime/medication/AnalgesicProducts";
import { DEFAULT_NOREPINEPHRINE_CONFIGURATION, norepinephrineTargetEffect } from
  "@/services/runtime/medication/NorepinephrineInfusion";
import { DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION } from
  "@/services/runtime/respiratory/MechanicalVentilationRuntime";
import { publishAssessmentDebugSnapshot } from "@/services/AssessmentRuntimeDebugService";
import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
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
import type { PersistedRuntimePayload } from "@/models/PersistedRuntimeState";
import { RuntimePersistenceError } from "@/models/PersistedRuntimeState";
import type { MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { reconcileMtpVascularAccess } from "@/services/runtime/MassiveTransfusionPatientProcess";
import { ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT, boundedVitalSignEvents } from "@/services/runtime/persistence/VitalHistoryCompaction";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";
import { yieldToEventLoop } from "@/services/runtime/persistence/LatestGenerationPipeline";
import { cooperativeDetachedCopy } from "@/services/runtime/assessment/CooperativeAssessmentSnapshot";
import { runRuntimeDerivedSnapshotTransaction } from "@/services/runtime/RuntimeDerivedSnapshotTransaction";
import {
  MechanicalVentilationRuntime,
  type MechanicalVentilationProjectionContext,
  type SecuredAirwayReference,
} from "@/services/runtime/respiratory/MechanicalVentilationRuntime";
import type { NarvaIroScenarioProjection, NarvaIroVentilationFault } from "@/models/NarvaIroScenario";
import { NarvaIroScenarioRuntime } from "@/services/runtime/NarvaIroScenarioRuntime";

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
  objectOrField: "pleuralAirBurden / pleuralBloodBurdenMl / pleuralDrainageActive / respiratoryImpairmentMultiplier / pleuralInitialDrainageCompleted / pleuralInitialDrainageVolumeMl / pleuralOngoingDrainOutputMl / pleuralOngoingDrainRateMlMin / pleuralTotalDrainOutputMl / pleuralDrainageCompletedAtSec",
  canonicalOwner: "PLEURAL_INJURY_V1", contributionAllowedFrom: "CORE_ENGINE",
  aggregationOrWriteRule: "LATEST attributable owner value", conflictAction: "REJECT_CONFLICTING_OWNER",
}, {
  objectType: "RuntimeField",
  objectOrField: "respiratoryFailurePhenotype / workOfBreathing / respiratoryFatigue / oxygenSupport / respiratoryAirwayPatent / respiratoryAirwayProtected / ventilationMode / respiratoryFailureTrend",
  canonicalOwner: "RESPIRATORY_FAILURE_V1", contributionAllowedFrom: "CORE_ENGINE",
  aggregationOrWriteRule: "LATEST attributable owner value", conflictAction: "REJECT_CONFLICTING_OWNER",
}, {
  objectType: "RuntimeField",
  objectOrField: "estimatedBloodLossMl / cumulativeBloodLossMl / bleedingRateMlMin / hemorrhageSeverity / perfusionState / compensationState / HRTrend / BPTrend / PerfusionTrend",
  canonicalOwner: "HEMORRHAGE_V1", contributionAllowedFrom: "CORE_ENGINE",
  aggregationOrWriteRule: "LATEST attributable owner value", conflictAction: "REJECT_CONFLICTING_OWNER",
}, {
  objectType: "RuntimeField",
  objectOrField: "mtpActivated / transfusedVolumeMl / oxygenCarryingCapacity / coagulationSupport / bloodProductInventory / bloodProductsAdministered",
  canonicalOwner: "MASSIVE_TRANSFUSION_V1", contributionAllowedFrom: "CORE_ENGINE",
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

function exposesSnapshotClinicalState(process: CanonicalLifecycleProcess): process is CanonicalLifecycleProcess & { clinicalState: Record<string, unknown> } {
  return "clinicalState" in process && ["CARDIAC_ARREST", "MASSIVE_TRANSFUSION", "PLEURAL_INJURY", "HEMORRHAGE"].includes(process.processType);
}

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
    ...(initial.physiologicDecompensationEnabled === true ? { physiologicDecompensationConfig: DEFAULT_PHYSIOLOGIC_DECOMPENSATION_CONFIG,
      physiologicDecompensation: { clinicalState: "ALIVE" as const, gcsCause: "NONE" as const } } : {}),
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
  "tourniquet", "pelvicBinder", "chestDrain",
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
  private injuryOnsetSimulationTimeSec?: number;
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
    new ClinicalProcessRegistry([hvClinicalProcessHandler, hypoxiaClinicalProcessHandler, respiratoryFailureClinicalProcessHandler, pleuralInjuryClinicalProcessHandler, cardiacArrestClinicalProcessHandler])
  );
  private readonly interventionRuntime = new InterventionRuntime(
    new InterventionDefinitionRegistry([...airwayInterventionDefinitions, ...circulationInterventionDefinitions, ...pleuralInterventionDefinitions, ...cardiacArrestInterventionDefinitions])
  );
  private readonly airwayManagement = new AirwayManagementFramework();
  private readonly assessmentEngine = new ClinicalAssessmentEngine();
  private readonly circulationManagement = new CirculationManagementFramework();
  private assessmentRules: AssessmentRule[] = [];
  private readonly medicationEngine = new MedicationEngine();
  private readonly mechanicalVentilation = new MechanicalVentilationRuntime();
  private readonly narvaIroScenario = new NarvaIroScenarioRuntime();
  private vitalSignEvents: VitalSignEvent[] = [];
  private assessmentPublicationGeneration = 0;
  private assessmentPendingGeneration = 0;
  private assessmentPublishedGeneration = 0;
  private assessmentPublicationActive?: Promise<void>;
  private assessmentBuildCount = 0;
  private assessmentStaleDiscardCount = 0;
  private assessmentPublicationCount = 0;

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
    const fixtureState = fixture.initialState && typeof fixture.initialState === "object"
      ? fixture.initialState as Record<string, unknown> : {};
    this.injuryOnsetSimulationTimeSec = typeof fixtureState.injuryTimeSec === "number" &&
      Number.isFinite(fixtureState.injuryTimeSec) ? fixtureState.injuryTimeSec : undefined;
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
    this.mechanicalVentilation.reset();
    const fixturePatientId = this.requireProcess().encounterId;
    this.narvaIroScenario.reset(fixtureState.narvaIroScenario === true ? fixturePatientId : undefined);
    if (fixtureState.narvaIroInitialTreatments === true) this.bootstrapNarvaIroInitialTreatments(fixturePatientId);
    this.vitalSignEvents = [];
    publishRuntimeSnapshot(this.runtimeState, this.orderedLifecycleLeaves("SERIALIZATION").map(process => ({
      processId: process.outputs.processId, moduleId: process.outputs.moduleId, status: process.outputs.status,
      ...(exposesSnapshotClinicalState(process)
        ? { clinicalState: structuredClone(process.clinicalState) } : {}),
    })));
    this.publishResourceDebugSnapshot(false);
    this.publishAssessmentSnapshot(true);
    if (this.rootProcess()) this.aggregateProcesses(this.runtimeState);
  }

  advanceTo(simulationTimeSec: number): void {
    if (!Number.isFinite(simulationTimeSec) || simulationTimeSec < this.simulationTimeSec) {
      throw new Error("Simulatsiooniaeg peab liikuma deterministlikult edasi.");
    }
    const targetTime = simulationTimeSec;
    if (this.narvaIroScenario.snapshot()) this.narvaIroScenario.advanceTo(targetTime);
    for (const medicationEvent of this.medicationEngine.advanceTo(targetTime)) this.logEvent(medicationEvent.eventType, { ...medicationEvent }, medicationEvent.patientId);
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
    this.reconcileNarvaIroCardiacArrest();
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
    // DEAD is an absorbing physiologic state. The exercise clock may continue,
    // but no patient process may accrue loss, treatment delivery or recovery.
    if (runtimeState.globalStatus === "Dead") {
      this.hemorrhageProcesses().forEach(current => this.replaceLifecycleProcess(terminateHemorrhageAtDeath(current)));
      this.aggregateProcesses(runtimeState);
      this.appliedEventIds.add(event.eventId);
      this.publishResourceDebugSnapshot();
      return;
    }
    this.applyDueResourceInterventions();
    for (const completed of this.interventionRuntime.completeDue(this.simulationTimeSec)) this.projectInterventionState(completed);
    this.reconcileMtpAccessFromCanonicalCirculation();
    const activeEffects = [...this.interventionRuntime.effectsAt(this.simulationTimeSec),
      ...this.medicationEngine.activeEffects(this.simulationTimeSec),
      ...this.mechanicalVentilation.activeEffects(state => this.mechanicalAirwayValid(state))]
      .sort((a,b) => a.effectType.localeCompare(b.effectType) || a.effectId.localeCompare(b.effectId));
    for (const descriptor of this.lifecyclePlan.forPhase("PREPARE")) {
      for (const current of this.lifecycleProcesses(descriptor.processType)) {
        const result = descriptor.prepare!(current, this.lifecyclePhaseContext(this.simulationTimeSec, 0, activeEffects, event));
        result.processes.forEach(process => this.replaceLifecycleProcess(process));
      }
    }
    for (const effect of activeEffects) {
      if (["REDUCE_EXTERNAL_BLEEDING", "STOP_EXTERNAL_BLEEDING", "PELVIC_STABILIZATION", "INFUSION_RUNNING",
        "BLOOD_PRODUCT_STARTED", "VASOPRESSOR_SUPPORT", "ANTIFIBRINOLYTIC_SUPPORT", "COAGULATION_SUBSTRATE_SUPPORT",
        "EXTERNAL_MECHANICAL_VENTILATION"].includes(effect.effectType)) continue;
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
    if (this.runtimeState?.globalStatus === "Dead") {
      this.hemorrhageProcesses().forEach(current => this.replaceLifecycleProcess(terminateHemorrhageAtDeath(current)));
      this.aggregateProcesses(this.runtimeState);
    }
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

  /** Atomically reserves a complete equipment set and starts its canonical intervention. */
  startResourceAwareClinicalIntervention(input: {
    sourceInterventionId: string; definitionId: string; patientId: string; resourceIds: string[];
    parameters: Record<string, import("@/models/ClinicalIntegration").ClinicalParameterValue>;
  }): InterventionInstance {
    const existing = this.interventionRuntime.forPatient(input.patientId)
      .find(item => item.sourceInterventionId === input.sourceInterventionId);
    if (existing) return existing;
    const encounterId = this.requireProcess().encounterId;
    if (input.patientId !== encounterId) throw new ResourceAwareInterventionError(
      "INTERVENTION_REJECTED", "Valitud ressursside patsiendikontekst ei vasta Runtime'ile.");
    let validated: ReturnType<InterventionRuntime["validateAllocatedStart"]>;
    try {
      validated = this.interventionRuntime.validateAllocatedStart({ definitionId: input.definitionId,
        encounterId, parameters: input.parameters, clinicalContext: this.airwayClinicalContext() });
    } catch {
      throw new ResourceAwareInterventionError("INVALID_PARAMETER", "Intubatsiooni parameetrid ei ole kehtivad.");
    }
    const ids = [...new Set(input.resourceIds)];
    if (ids.length !== input.resourceIds.length) throw new ResourceAwareInterventionError(
      "RESOURCE_UNAVAILABLE", "Sama ressurssi ei saa valida mitu korda.");
    const selected = ids.map(resourceId => this.resourcePool.getResource(resourceId));
    if (selected.some(resource => !resource)) throw new ResourceAwareInterventionError(
      "RESOURCE_UNAVAILABLE", "Valitud ressurss ei ole enam saadaval.");
    const resources = selected as RuntimeResource[];
    const tube = resources.find(resource => resource.type === "endotrachealTube");
    const scope = resources.find(resource => resource.type === "directLaryngoscope" || resource.type === "videoLaryngoscope");
    if (!tube) throw new ResourceAwareInterventionError("TUBE_UNAVAILABLE", "Sobiv endotrahheaaltoru puudub.");
    if (!scope) throw new ResourceAwareInterventionError("LARYNGOSCOPE_UNAVAILABLE", "Sobiv larüngoskoop puudub.");
    if (resources.some(resource => !this.resourcePool.isAvailable(resource.resourceId))) throw new ResourceAwareInterventionError(
      "RESOURCE_UNAVAILABLE", "Valitud ressurss ei ole enam saadaval.");
    try { validateInterventionResourceSelection(validated.definition, resources); } catch {
      throw new ResourceAwareInterventionError("RESOURCE_UNAVAILABLE", "Valitud ressursikomplekt ei vasta sekkumisele.");
    }
    const expectedDevice = scope.type === "videoLaryngoscope" ? "VIDEO" : "DIRECT";
    if (validated.parameters.device !== expectedDevice || validated.parameters.confirmation !== true) {
      throw new ResourceAwareInterventionError("INVALID_PARAMETER", "Seadme valik või toru asendi kinnitus ei ole kehtiv.");
    }
    const metadataSize = tube.metadata.tubeSize;
    if (typeof metadataSize === "number" && validated.parameters.tubeSize !== metadataSize) {
      throw new ResourceAwareInterventionError("INVALID_PARAMETER", "Toru suurus ei vasta valitud ressursile.");
    }
    const metadataCuff = tube.metadata.cuffed;
    if (typeof metadataCuff === "boolean" && validated.parameters.cuff !== metadataCuff) {
      throw new ResourceAwareInterventionError("INVALID_PARAMETER", "Manseti valik ei vasta valitud torule.");
    }
    const reserved: string[] = [];
    try {
      for (const resourceId of ids) { this.resourcePool.reserve(resourceId, input.patientId); reserved.push(resourceId); }
      const instance = this.interventionRuntime.startAllocated({ ...input, encounterId, startedAt: this.simulationTimeSec,
        parameters: validated.parameters, resourceIds: ids, clinicalContext: this.airwayClinicalContext() });
      if (instance.status !== "RUNNING") throw new Error("Canonical intervention rejected");
      this.projectInterventionState(instance);
      this.logEvent("EndotrachealIntubationStarted", { interventionInstanceId: instance.instanceId,
        definitionId: instance.definitionId, resourceIds: instance.resourceIds, parameters: instance.parameters }, input.patientId);
      this.publishResourceDebugSnapshot();
      return instance;
    } catch (error) {
      for (const resourceId of reserved.reverse()) {
        const resource = this.resourcePool.getResource(resourceId);
        if (resource?.assignedPatientId === input.patientId) this.resourcePool.release(resourceId);
      }
      if (error instanceof ResourceAwareInterventionError) throw error;
      throw new ResourceAwareInterventionError("INTERVENTION_REJECTED", "Kanooniline intubatsioon lükati tagasi.");
    }
  }

  /** Applies commands scheduled for the current canonical instant without advancing clinical time. */
  applyScheduledResourceInterventionsAtCurrentTime(): void {
    this.applyDueResourceInterventions();
    this.reconcileMtpAccessFromCanonicalCirculation();
    this.publishResourceDebugSnapshot();
  }

  stopClinicalIntervention(sourceInterventionId: string): InterventionInstance | undefined {
    const cancelled = this.interventionRuntime.finishBySource(sourceInterventionId, "CANCELLED", this.simulationTimeSec);
    if (cancelled) {
      for (const resourceId of cancelled.resourceIds) {
        const resource = this.resourcePool.getResource(resourceId);
        if (resource?.status === "RESERVED" && resource.assignedPatientId === cancelled.patientId) {
          this.resourcePool.release(resourceId);
        }
      }
      this.projectInterventionState(cancelled); this.reconcileMtpAccessFromCanonicalCirculation(); this.publishResourceDebugSnapshot();
    }
    return cancelled;
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

  /** Canonical serialization boundary. The result contains data only and no live runtime references. */
  captureRuntimePayload(): PersistedRuntimePayload {
    return structuredClone({
      simulationTimeSec: this.simulationTimeSec,
      ...(this.injuryOnsetSimulationTimeSec === undefined ? {} : {
        injuryOnsetSimulationTimeSec: this.injuryOnsetSimulationTimeSec,
      }),
      sequence: this.sequence,
      processes: this.lifecyclePlan.orderProcesses([...this.lifecycleProcessStore.values()], "SERIALIZATION")
        .concat(this.rootProcess() ? [this.rootProcess()!] : []),
      runtimeState: this.requireRuntimeState(),
      eventLog: this.eventLog,
      resourceEventLog: this.resourceEventLog,
      pendingTransitions: this.pendingTransitions,
      processControlledEventPending: this.processControlledEventPending,
      appliedEventIds: [...this.appliedEventIds].sort(),
      resources: this.resourcePool.snapshot(),
      interventionEngine: this.interventionEngine.snapshot(),
      clinicalIntegration: this.clinicalIntegration.snapshot(),
      interventionInstances: this.interventionRuntime.snapshot(),
      airway: this.airwayManagement.snapshot(),
      circulation: this.circulationManagement.snapshot(),
      medication: this.medicationEngine.snapshot(),
      ...(this.mechanicalVentilation.snapshot() ? { mechanicalVentilation: this.mechanicalVentilation.snapshot() } : {}),
      ...(this.narvaIroScenario.snapshot() ? { narvaIroScenario: this.narvaIroScenario.snapshot() } : {}),
      assessmentRules: this.assessmentRules,
      vitalSignEvents: boundedVitalSignEvents(this.vitalSignEvents),
    }) as PersistedRuntimePayload;
  }

  /** Atomic fail-closed rehydration boundary. Validation completes before any live state is published. */
  rehydrateRuntimePayload(payload: PersistedRuntimePayload): void {
    this.restoreRuntimePayloadState(payload);
    this.publishCanonicalState();
  }

  /** Production startup path: state remains private until cooperative derived publication is complete. */
  async rehydrateRuntimePayloadAsync(payload: PersistedRuntimePayload, yieldControl: PipelineYield = yieldToEventLoop): Promise<void> {
    const generation = ++this.assessmentPublicationGeneration;
    this.restoreRuntimePayloadState(payload);
    this.assessmentPendingGeneration = Math.max(this.assessmentPendingGeneration, generation);
    await this.publishCanonicalStateCooperatively(generation, yieldControl);
    if (this.assessmentPublishedGeneration !== generation) throw new RuntimePersistenceError(
      "RUNTIME_INVARIANT_VIOLATION", "Runtime assessment publication was superseded during rehydrate."
    );
  }

  private restoreRuntimePayloadState(payload: PersistedRuntimePayload): void {
    const endClone = startRuntimeWorkTrace("STARTUP_RUNTIME_PAYLOAD_CLONE");
    const candidate = structuredClone(payload);
    endClone();
    const endInvariantValidation = startRuntimeWorkTrace("STARTUP_RUNTIME_PAYLOAD_INVARIANTS", {
      processCount: candidate.processes.length,
      eventCount: candidate.eventLog.length,
    });
    if (!Number.isFinite(candidate.simulationTimeSec) || candidate.simulationTimeSec < 0 ||
      !Number.isInteger(candidate.sequence) || candidate.sequence < 0 || !candidate.processes.length) {
      throw new RuntimePersistenceError("RUNTIME_INVARIANT_VIOLATION", "Persisted runtime clock, sequence or process set is invalid.");
    }
    const identities = new Set<string>();
    for (const process of candidate.processes) {
      try { this.lifecyclePlan.descriptor(process.processType); } catch {
        throw new RuntimePersistenceError("UNKNOWN_PROCESS_TYPE", `Persisted process type ${process.processType} is not registered.`);
      }
      if (identities.has(process.processId)) throw new RuntimePersistenceError("RUNTIME_INVARIANT_VIOLATION", `Duplicate process ${process.processId}.`);
      identities.add(process.processId);
    }
    const encounterIds = new Set(candidate.processes.map(process => process.encounterId));
    if (encounterIds.size !== 1 || !encounterIds.has(candidate.runtimeState.encounterId) ||
      candidate.sequence < candidate.eventLog.reduce((max, event) => Math.max(max, event.sequence ?? 0), 0)) {
      throw new RuntimePersistenceError("RUNTIME_INVARIANT_VIOLATION", "Persisted process, RuntimeState or event sequence identity is inconsistent.");
    }
    endInvariantValidation();

    const endProcessState = startRuntimeWorkTrace("STARTUP_RUNTIME_PROCESS_STATE");
    const endProcessRestore = startRuntimeWorkTrace("ENGINE_PROCESS_RESTORE", { processCount: candidate.processes.length });
    this.lifecycleProcessStore.clear(); candidate.processes.forEach(process => this.replaceLifecycleProcess(process));
    endProcessRestore();
    const endStateAssign = startRuntimeWorkTrace("ENGINE_STATE_ASSIGN", { eventCount: candidate.eventLog.length });
    this.runtimeState = candidate.runtimeState;
    this.simulationTimeSec = candidate.simulationTimeSec; this.sequence = candidate.sequence;
    this.injuryOnsetSimulationTimeSec = candidate.injuryOnsetSimulationTimeSec;
    this.eventLog = [...candidate.eventLog]; this.resourceEventLog = [...candidate.resourceEventLog];
    this.pendingTransitions = candidate.pendingTransitions.map(item => ({ dueSec: item.dueSec, transition: item.transition as HvTimedTransition }));
    this.processControlledEventPending = candidate.processControlledEventPending;
    this.appliedEventIds.clear(); candidate.appliedEventIds.forEach(id => this.appliedEventIds.add(id));
    endStateAssign({ appliedEventCount: candidate.appliedEventIds.length });
    endProcessState({ processCount: candidate.processes.length, appliedEventCount: candidate.appliedEventIds.length });
    const endSubsystems = startRuntimeWorkTrace("STARTUP_RUNTIME_SUBSYSTEMS");
    const endResourceRestore = startRuntimeWorkTrace("ENGINE_RESOURCE_RESTORE", { resourceCount: candidate.resources.length });
    this.resourcePool = new ResourcePool([...candidate.resources]);
    this.interventionEngine = new InterventionEngine(); this.interventionEngine.restore(candidate.interventionEngine);
    endResourceRestore();
    const endClinicalRestore = startRuntimeWorkTrace("ENGINE_CLINICAL_REFERENCE_RESTORE");
    this.clinicalIntegration.restore(candidate.clinicalIntegration);
    this.interventionRuntime.restore(candidate.interventionInstances);
    this.airwayManagement.restore(candidate.airway); this.circulationManagement.restore(candidate.circulation);
    this.medicationEngine.restore(candidate.medication);
    this.mechanicalVentilation.restore(candidate.mechanicalVentilation);
    this.narvaIroScenario.restore(candidate.narvaIroScenario);
    endClinicalRestore();
    this.assessmentRules = structuredClone(candidate.assessmentRules) as AssessmentRule[];
    this.vitalSignEvents = boundedVitalSignEvents(candidate.vitalSignEvents);
    endSubsystems({ resourceCount: candidate.resources.length, eventCount: candidate.eventLog.length });
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
  executeMedicationCommand(command: MedicationAdministration & Readonly<{ commandId: string }>): MedicationCommandResult {
    const idempotencyKey = `MEDICATION_COMMAND:${command.commandId}`;
    if (this.appliedEventIds.has(idempotencyKey)) {
      const state = this.medicationEngine.snapshot().instances.find(item => item.administrationId === command.administrationId);
      return Object.freeze({ status: "IDEMPOTENT", commandId: command.commandId, ...(state ? { state } : {}) });
    }
    if (command.timestamp !== this.simulationTimeSec || command.patientId !== this.requireProcess().encounterId) {
      return Object.freeze({ status: "REJECTED", commandId: command.commandId,
        rejectionReason: "INVALID_ADMINISTRATION" });
    }
    if (command.medicationId === FIBRINOGEN_CONCENTRATE_ID) {
      if (command.unit !== "G" || command.dose > 20) return Object.freeze({ status: "REJECTED",
        commandId: command.commandId, rejectionReason: "INVALID_ADMINISTRATION" });
      this.medicationEngine.ensureDefinition(FIBRINOGEN_CONCENTRATE_DEFINITION);
    }
    const before = this.medicationEngine.snapshot().instances.find(item => item.administrationId === command.administrationId);
    if (before) return Object.freeze({ status: "IDEMPOTENT", commandId: command.commandId, state: before });
    const result = this.medicationEngine.administer(command, this.getCirculationState(command.patientId));
    for (const event of result.events) this.logEvent(event.eventType, event, event.patientId);
    if (!result.instance) return Object.freeze({ status: "REJECTED", commandId: command.commandId,
      rejectionReason: result.events.at(-1)?.reasonCode ?? "INVALID_ADMINISTRATION" });
    this.appliedEventIds.add(idempotencyKey);
    this.aggregateProcesses(); this.publishResourceDebugSnapshot();
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: result.instance });
  }
  cancelMedication(administrationId: string, timestamp: number): void {
    const event = this.medicationEngine.cancel(administrationId, timestamp); this.logEvent(event.eventType, event, event.patientId); this.publishResourceDebugSnapshot();
  }
  getMedicationState(patientId?: string): MedicationInstance[] {
    return this.medicationEngine.snapshot().instances.filter(x => !patientId || x.patientId === patientId);
  }
  executeNorepinephrineCommand(command: NorepinephrineCommand): NorepinephrineCommandResult {
    if (command.simulationTimeSec !== this.simulationTimeSec) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "STALE_SIMULATION_TIME",
    });
    const result = this.medicationEngine.executeNorepinephrine(command, this.getCirculationState(command.patientId));
    const event = this.medicationEngine.snapshot().norepinephrine?.events.at(-1);
    if (result.status !== "IDEMPOTENT" && event?.commandId === command.commandId) {
      this.logEvent(event.eventType, { ...event }, event.patientId);
    }
    if (result.status === "APPLIED") this.aggregateProcesses();
    this.publishResourceDebugSnapshot();
    return structuredClone(result);
  }
  getNorepinephrineState(patientId?: string): readonly NorepinephrineFeatureProjection[] {
    return this.medicationEngine.norepinephrineProjectionsAt(this.simulationTimeSec)
      .filter(item => !patientId || item.patientId === patientId).map(item => structuredClone(item));
  }
  executeFluidTherapyCommand(command: SupportedFluidTherapyCommand): SupportedFluidTherapyCommandResult {
    if (command.simulationTimeSec !== this.simulationTimeSec) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "STALE_SIMULATION_TIME",
    });
    if (command.patientId !== this.requireProcess().encounterId) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "INVALID_PATIENT",
    });
    const result = this.medicationEngine.executeFluidTherapy(command, this.getCirculationState(command.patientId));
    const event = this.medicationEngine.fluidTherapyEventForCommand(command.commandId);
    if (result.status !== "IDEMPOTENT" && event?.commandId === command.commandId) {
      this.logEvent(event.eventType, { ...event }, event.patientId);
    }
    if (result.status === "APPLIED") this.aggregateProcesses();
    this.publishResourceDebugSnapshot();
    return structuredClone(result);
  }
  getFluidTherapyState(patientId?: string): readonly SupportedFluidTherapyProjection[] {
    return this.medicationEngine.fluidTherapyProjectionsAt(this.simulationTimeSec)
      .filter(item => !patientId || item.patientId === patientId).map(item => structuredClone(item));
  }
  executeTranexamicAcidCommand(command: TranexamicAcidCommand): TranexamicAcidCommandResult {
    if (command.simulationTimeSec !== this.simulationTimeSec) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "STALE_SIMULATION_TIME",
    });
    if (command.patientId !== this.requireProcess().encounterId) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "INVALID_PATIENT",
    });
    const result = this.medicationEngine.executeTranexamicAcid(command, this.getCirculationState(command.patientId),
      this.injuryOnsetSimulationTimeSec);
    const event = this.medicationEngine.tranexamicAcidEventForCommand(command.commandId);
    if (result.status !== "IDEMPOTENT" && event?.commandId === command.commandId) {
      this.logEvent(event.eventType, { ...event }, event.patientId);
    }
    if (result.status === "APPLIED") this.aggregateProcesses();
    this.publishResourceDebugSnapshot();
    return structuredClone(result);
  }
  getTranexamicAcidState(patientId?: string): readonly TranexamicAcidFeatureProjection[] {
    return this.medicationEngine.tranexamicAcidProjectionsAt(this.simulationTimeSec)
      .filter(item => !patientId || item.patientId === patientId).map(item => structuredClone(item));
  }
  executeAnalgesicCommand(command: AnalgesicCommand): AnalgesicCommandResult {
    if (command.simulationTimeSec !== this.simulationTimeSec) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "STALE_SIMULATION_TIME",
    });
    if (command.patientId !== this.requireProcess().encounterId) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "INVALID_PATIENT",
    });
    const result = this.medicationEngine.executeAnalgesic(command, this.getCirculationState(command.patientId));
    const event = this.medicationEngine.analgesicEventForCommand(command.commandId);
    if (result.status !== "IDEMPOTENT" && event?.commandId === command.commandId) {
      this.logEvent(event.eventType, { ...event }, event.patientId);
    }
    if (result.status === "APPLIED") this.aggregateProcesses();
    this.publishResourceDebugSnapshot();
    return structuredClone(result);
  }
  getAnalgesicState(patientId?: string): readonly AnalgesicFeatureProjection[] {
    return this.medicationEngine.analgesicProjectionsAt(this.simulationTimeSec)
      .filter(item => !patientId || item.patientId === patientId).map(item => structuredClone(item));
  }
  executeMechanicalVentilationCommand(command: MechanicalVentilationCommand): MechanicalVentilationCommandResult {
    if (command.simulationTimeSec !== this.simulationTimeSec) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "STALE_SIMULATION_TIME",
    });
    if (command.patientId !== this.requireProcess().encounterId) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "INVALID_PATIENT",
    });
    const result = this.mechanicalVentilation.execute(command, this.securedAirwayReference(command));
    const event = this.mechanicalVentilation.eventForCommand(command.commandId);
    if (result.status !== "IDEMPOTENT" && event?.commandId === command.commandId) {
      this.logEvent(event.eventType, { ...event }, event.patientId);
    }
    if (result.status === "APPLIED" && result.state) {
      const airwayEvent = this.airwayManagement.setMechanicalVentilation(command.patientId,
        result.state.lifecycle === "RUNNING", command.simulationTimeSec, result.state.supportId);
      if (airwayEvent) this.logEvent(airwayEvent.eventType, { interventionInstanceId: airwayEvent.interventionInstanceId,
        definitionId: airwayEvent.definitionId, airwayState: airwayEvent.airwayState,
        ventilationState: airwayEvent.ventilationState }, airwayEvent.patientId);
      this.aggregateProcesses();
    }
    this.publishResourceDebugSnapshot();
    return structuredClone(result);
  }
  getMechanicalVentilationState(patientId?: string): readonly MechanicalVentilationFeatureProjection[] {
    return this.mechanicalVentilation.projectionsAt(this.simulationTimeSec,
      state => this.mechanicalVentilationProjectionContext(state))
      .filter(item => !patientId || item.patientId === patientId).map(item => structuredClone(item));
  }
  triggerNarvaIroVasopressorFault(): NarvaIroScenarioProjection {
    const result = this.narvaIroScenario.triggerVasopressorFault(this.simulationTimeSec); this.aggregateProcesses(); return result;
  }
  triggerNarvaIroVentilationFault(type: NarvaIroVentilationFault): NarvaIroScenarioProjection {
    const result = this.narvaIroScenario.triggerVentilationFault(type, this.simulationTimeSec); this.aggregateProcesses(); return result;
  }
  correctNarvaIroVasopressorFault(): NarvaIroScenarioProjection {
    const result = this.narvaIroScenario.correctVasopressor(this.simulationTimeSec); this.aggregateProcesses(); return result;
  }
  correctNarvaIroVentilationFault(): NarvaIroScenarioProjection {
    const result = this.narvaIroScenario.correctVentilation(this.simulationTimeSec); this.aggregateProcesses(); return result;
  }
  setNarvaIroHold(hold: boolean): NarvaIroScenarioProjection {
    return this.narvaIroScenario.setHold(hold, this.simulationTimeSec);
  }
  setNarvaIroCprQuality(quality: boolean): NarvaIroScenarioProjection {
    return this.narvaIroScenario.setCprQuality(quality, this.simulationTimeSec);
  }
  attemptNarvaIroRosc(): Readonly<{ status: "APPLIED" | "REJECTED"; projection: NarvaIroScenarioProjection }> {
    const result = this.narvaIroScenario.attemptRosc(this.simulationTimeSec);
    if (result.status === "APPLIED") {
      const cardiac = this.lifecycleProcesses("CARDIAC_ARREST")[0] as CardiacArrestPatientProcessRuntime | undefined;
      if (cardiac?.clinicalState.cardiacState === "ARREST") {
        this.replaceLifecycleProcess(applyExplicitCardiacRhythmTransition(cardiac, "NARVA_IRO_CAUSE_CORRECTED_ROSC"));
      }
    }
    this.aggregateProcesses(); return result;
  }
  getNarvaIroScenarioState(): NarvaIroScenarioProjection {
    return this.narvaIroScenario.projectionAt(this.simulationTimeSec);
  }

  private bootstrapNarvaIroInitialTreatments(patientId: string): void {
    const ettInstanceId = "NARVA-IRO-ETT:INSTANCE";
    this.interventionRuntime.restore([{
      instanceId: ettInstanceId, definitionId: "ENDOTRACHEAL_INTUBATION", definitionVersion: "1.0.0",
      definitionName: "Endotrahheaalne intubatsioon", encounterId: patientId, patientId, status: "RUNNING",
      startedAt: -300, parameters: { confirmation: true }, resourceIds: ["ETT-IRO-1"],
      sourceInterventionId: "NARVA-IRO-ETT",
    }]);
    this.airwayManagement.restore({ states: [{ patientId, activeAirway: "ENDOTRACHEAL",
      currentVentilation: "MECHANICAL", confirmed: true, updatedAt: 0 }], events: [] });
    this.circulationManagement.restore({ states: [{ patientId, vascularAccess: [
      { interventionInstanceId: "NARVA-IRO-PIV:INSTANCE", type: "PERIPHERAL_IV", resourceIds: ["PIV-IRO-1"], establishedAt: -300 },
      { interventionInstanceId: "NARVA-IRO-CVC:INSTANCE", type: "CENTRAL_ACCESS", resourceIds: ["CVC-IRO-1"], establishedAt: -300 },
    ], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 }], events: [] });
    const target = norepinephrineTargetEffect(0.08);
    const analgesicState = (administrationId: string, drugId: "PROPOFOL" | "REMIFENTANIL" | "ROCURONIUM",
      rate: number, rateUnit: "MG_H" | "MCG_MIN", exposureDose: number) => ({ schemaVersion: 1 as const,
      featureId: "ANALGESIA" as const, administrationId, patientId, drugId,
      productVersion: ANALGESIC_PRODUCT_CONFIGURATIONS.find(item => item.drugId === drugId)!.version,
      route: "IV" as const, vascularAccessId: "NARVA-IRO-CVC:INSTANCE", mode: "INFUSION" as const,
      lifecycle: "RUNNING" as const, rate, rateUnit, deliveredDose: exposureDose,
      deliveredDoseAtLastChange: exposureDose, startedAtSimulationTimeSec: -300,
      lastRateChangeAtSimulationTimeSec: 0 });
    this.medicationEngine.restore({ definitions: [], instances: [], events: [], effects: [],
      norepinephrine: { schemaVersion: 1, configuration: DEFAULT_NOREPINEPHRINE_CONFIGURATION,
        infusions: [{ schemaVersion: 1, featureId: "NOREPINEPHRINE", infusionId: "NARVA-IRO-NOREPINEPHRINE",
          patientId, route: "IV", vascularAccessId: "NARVA-IRO-CVC:INSTANCE", status: "RUNNING",
          doseMicrogramsPerKgMin: 0.08, unit: "MCG_KG_MIN", startedAtSimulationTimeSec: -300,
          lastDoseChangeAtSimulationTimeSec: 0, transition: { startedAtSimulationTimeSec: -300, durationSec: 0,
            fromSystolicIncreaseMmHg: target.systolicIncreaseMmHg, toSystolicIncreaseMmHg: target.systolicIncreaseMmHg,
            fromDiastolicIncreaseMmHg: target.diastolicIncreaseMmHg, toDiastolicIncreaseMmHg: target.diastolicIncreaseMmHg } }],
        commandResults: [], events: [] },
      analgesia: { schemaVersion: 1, productConfigurations: ANALGESIC_PRODUCT_CONFIGURATIONS,
        administrations: [analgesicState("NARVA-IRO-PROPOFOL", "PROPOFOL", 140, "MG_H", 140),
          analgesicState("NARVA-IRO-REMIFENTANIL", "REMIFENTANIL", 7, "MCG_MIN", 25),
          analgesicState("NARVA-IRO-ROCURONIUM", "ROCURONIUM", 21, "MG_H", 15)],
        painStates: [{ patientId, baselinePainIntensity: 0 }], commandResults: [], events: [] } });
    this.mechanicalVentilation.restore({ schemaVersion: 1, configuration: DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION,
      supports: [{ schemaVersion: 1, featureId: "MECHANICAL_VENTILATION", supportId: "NARVA-IRO-VENTILATION",
        patientId, securedAirwayId: ettInstanceId, lifecycle: "RUNNING", mode: "VOLUME_CONTROL",
        respiratoryRate: 14, respiratoryRateUnit: "BREATHS_MIN", tidalVolumeMl: 420, tidalVolumeUnit: "ML",
        fio2: 0.4, peepCmH2O: 8, peepUnit: "CM_H2O", startedAtSimulationTimeSec: -300,
        lastSettingsChangeAtSimulationTimeSec: 0 }], commandResults: [], events: [] });
  }

  private reconcileNarvaIroCardiacArrest(): void {
    if (!this.narvaIroScenario.snapshot() || !this.narvaIroScenario.projectionAt(this.simulationTimeSec).arrest ||
      this.lifecycleProcesses("CARDIAC_ARREST").length) return;
    const patientId = this.requireProcess().encounterId;
    const configuration = { ...structuredClone(defaultCardiacArrestConfiguration),
      initialRhythm: "PEA" as const, transitions: [{ transitionId: "NARVA_IRO_CAUSE_CORRECTED_ROSC",
        trigger: "EXPLICIT" as const, fromRhythm: "PEA" as const, toRhythm: "PERFUSING" as const, priority: 100 }],
      vitalTargets: { ...structuredClone(defaultCardiacArrestConfiguration.vitalTargets),
        rosc: { heartRate: 105, systolicBp: 85, diastolicBp: 50, respiratoryRate: 14, gcs: 3 } } };
    this.replaceLifecycleProcess(bootstrapCardiacArrestPatientProcess({ fixtureId: "NARVA-IRO-ARREST", patientId },
      { processId: `${patientId}:CARDIAC_ARREST:IRO`, instanceKey: `${patientId}:cardiac-arrest:iro` }, configuration));
  }
  executeAlsMedicationCommand(command: AlsMedicationCommand): AlsMedicationCommandResult {
    if (command.simulationTimeSec !== this.simulationTimeSec) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "STALE_SIMULATION_TIME",
    });
    if (command.patientId !== this.requireProcess().encounterId) return Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: "INVALID_PATIENT",
    });
    const result = this.medicationEngine.executeAlsMedication(command,
      this.getCirculationState(command.patientId), this.alsRhythmContext(command.patientId));
    const event = this.medicationEngine.alsMedicationEventForCommand(command.commandId);
    if (result.status !== "IDEMPOTENT" && event?.commandId === command.commandId) {
      this.logEvent(event.eventType, { ...event }, event.patientId);
    }
    if (result.status === "APPLIED") this.aggregateProcesses();
    this.publishResourceDebugSnapshot();
    return structuredClone(result);
  }
  getAlsMedicationState(patientId?: string): readonly AlsMedicationFeatureProjection[] {
    return this.medicationEngine.alsMedicationProjectionsAt(this.simulationTimeSec, patientId)
      .map(item => structuredClone(item));
  }

  setAssessmentRules(rules: AssessmentRule[]): void {
    this.assessmentRules = structuredClone(rules);
    this.publishAssessmentSnapshot(true);
  }

  getAssessmentSnapshot(): AssessmentSnapshot {
    const endEventLog = startRuntimeWorkTrace("ENGINE_ASSESSMENT_EVENT_LOG_CLONE", { eventCount: this.eventLog.length });
    const endEventLogClone = startRuntimeWorkTrace("ENGINE_ASSESSMENT_EVENT_LOG_CLONE_SOURCE", { eventCount: this.eventLog.length });
    const eventLog = this.getEventLog();
    endEventLogClone();
    const endTimelineClone = startRuntimeWorkTrace("ENGINE_ASSESSMENT_TIMELINE_CLONE_SOURCE", { eventCount: this.eventLog.length });
    const timeline = this.getEventLog();
    endTimelineClone();
    endEventLog();
    const endInputs = startRuntimeWorkTrace("ENGINE_ASSESSMENT_OTHER_INPUTS");
    const interventionLog = structuredClone(this.resourceEventLog);
    const interventionInstances = this.interventionRuntime.snapshot();
    const resourcePool = this.resourcePool.snapshot();
    const airwayState = this.getAirwayState();
    const clinicalEffects = this.clinicalIntegration.snapshot().events;
    const clinicalFeatures = [...this.getNorepinephrineState(), ...this.getFluidTherapyState(),
      ...this.getTranexamicAcidState(), ...this.getAnalgesicState(), ...this.getMechanicalVentilationState(),
      ...this.getAlsMedicationState()];
    endInputs();
    const endEvaluate = startRuntimeWorkTrace("ENGINE_ASSESSMENT_RULE_EVALUATE", { ruleCount: this.assessmentRules.length });
    const snapshot = this.assessmentEngine.evaluate(this.assessmentRules, {
      timestamp: this.simulationTimeSec,
      runtimeState: this.requireRuntimeState(),
      eventLog, interventionLog, interventionInstances, resourcePool, airwayState, clinicalEffects, timeline,
      ...(clinicalFeatures.length ? { clinicalFeatures: [...clinicalFeatures] } : {}),
    });
    endEvaluate();
    return snapshot;
  }

  async getAssessmentSnapshotCooperatively(yieldControl: PipelineYield): Promise<AssessmentSnapshot> {
    const endSnapshot = startRuntimeWorkTrace("ENGINE_ASSESSMENT_SNAPSHOT", { mode: "COOPERATIVE" });
    const endEventLog = startRuntimeWorkTrace("ENGINE_ASSESSMENT_EVENT_LOG_COPY", { eventCount: this.eventLog.length });
    const eventLog = await cooperativeDetachedCopy(this.eventLog, yieldControl);
    endEventLog({ yieldCount: eventLog.metrics.yieldCount, maxBatchDurationMs: eventLog.metrics.maxBatchDurationMs });
    const endTimeline = startRuntimeWorkTrace("ENGINE_ASSESSMENT_TIMELINE_COPY", { eventCount: this.eventLog.length });
    const timeline = await cooperativeDetachedCopy(this.eventLog, yieldControl);
    endTimeline({ yieldCount: timeline.metrics.yieldCount, maxBatchDurationMs: timeline.metrics.maxBatchDurationMs });
    const clinicalFeatures = [...this.getNorepinephrineState(), ...this.getFluidTherapyState(),
      ...this.getTranexamicAcidState(), ...this.getAnalgesicState(), ...this.getMechanicalVentilationState(),
      ...this.getAlsMedicationState()];
    const result = await this.assessmentEngine.evaluateCooperatively(this.assessmentRules, {
      timestamp: this.simulationTimeSec,
      runtimeState: this.requireRuntimeState(),
      eventLog: eventLog.value,
      interventionLog: structuredClone(this.resourceEventLog),
      interventionInstances: this.interventionRuntime.snapshot(),
      resourcePool: this.resourcePool.snapshot(),
      airwayState: this.getAirwayState(),
      clinicalEffects: this.clinicalIntegration.snapshot().events,
      timeline: timeline.value,
      ...(clinicalFeatures.length ? { clinicalFeatures: [...clinicalFeatures] } : {}),
    }, yieldControl);
    endSnapshot({ eventLogYields: eventLog.metrics.yieldCount, timelineYields: timeline.metrics.yieldCount,
      debriefYields: result.metrics.debrief.yieldCount,
      maxBatchDurationMs: Math.max(eventLog.metrics.maxBatchDurationMs, timeline.metrics.maxBatchDurationMs,
        result.metrics.debrief.maxBatchDurationMs) });
    return result.snapshot;
  }

  getAssessmentPublicationDiagnostics(): Readonly<{
    generation: number; publishedGeneration: number; buildCount: number; staleDiscardCount: number; publicationCount: number;
  }> {
    return Object.freeze({ generation: this.assessmentPublicationGeneration,
      publishedGeneration: this.assessmentPublishedGeneration, buildCount: this.assessmentBuildCount,
      staleDiscardCount: this.assessmentStaleDiscardCount, publicationCount: this.assessmentPublicationCount });
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
    }, this.resolver, [...this.medicationEngine.vitalContributorsAt(this.simulationTimeSec),
      ...this.narvaIroScenario.vitalContributorsAt(this.simulationTimeSec),
      ...this.mechanicalVentilation.vitalContributorsAt(this.simulationTimeSec,
        state => this.mechanicalVentilationProjectionContext(state))]);
    if (aggregated.rejectedProcessIds.length > 0 ||
      aggregated.events.some((event) => event.eventType === "PROCESS_OUTPUT_REJECTED")) {
      throw new Error(`PatientProcess output lükati ownership'i või agregatsiooni poolt tagasi.`);
    }
    this.runtimeState = aggregated.state;
    publishRuntimeSnapshot(this.runtimeState, processes.map(process => ({
      processId: process.outputs.processId, moduleId: process.outputs.moduleId, status: process.outputs.status,
      ...(exposesSnapshotClinicalState(process) ? {
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
    if (this.vitalSignEvents.length > ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT) {
      this.vitalSignEvents.splice(0, this.vitalSignEvents.length - ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT);
    }
    for (const event of aggregated.events.filter(item => ["PULSE_OX_SIGNAL_LOST", "PULSE_OX_SIGNAL_CHANGED", "PHYSIOLOGIC_STATE_CHANGED", "PATIENT_DIED"].includes(item.eventType))) {
      this.logEvent(event.eventType, event.details ?? {}, this.requireProcess().encounterId);
    }
  }

  private publishCanonicalState(): void {
    const endRuntimeProjection = startRuntimeWorkTrace("ENGINE_RUNTIME_SNAPSHOT_PROJECTION");
    const processes = this.orderedLifecycleLeaves("SERIALIZATION");
    publishRuntimeSnapshot(this.requireRuntimeState(), processes.map(process => ({
      processId: process.outputs.processId,
      moduleId: process.outputs.moduleId,
      status: process.outputs.status,
      ...(exposesSnapshotClinicalState(process) ? {
        clinicalState: structuredClone(process.clinicalState),
        lastEvent: this.eventLog.filter(event => event.target === process.processId).at(-1)
          ? { type: this.eventLog.filter(event => event.target === process.processId).at(-1)!.eventType,
            simulationTimeSec: this.eventLog.filter(event => event.target === process.processId).at(-1)!.simulationTime ?? this.simulationTimeSec }
          : undefined,
      } : {}),
    })));
    endRuntimeProjection({ processCount: processes.length });
    const endResourceProjection = startRuntimeWorkTrace("ENGINE_RESOURCE_DEBUG_SNAPSHOT");
    this.publishResourceDebugSnapshot(false);
    endResourceProjection();
    const endAssessmentProjection = startRuntimeWorkTrace("ENGINE_ASSESSMENT_SNAPSHOT");
    this.publishAssessmentSnapshot(true);
    endAssessmentProjection();
  }

  private async publishCanonicalStateCooperatively(generation: number, yieldControl: PipelineYield): Promise<void> {
    if (!this.assessmentPublicationActive) {
      this.assessmentPublicationActive = this.drainAssessmentPublication(yieldControl).finally(() => {
        this.assessmentPublicationActive = undefined;
      });
    }
    await this.assessmentPublicationActive;
    if (generation < this.assessmentPendingGeneration && !this.assessmentPublicationActive) {
      await this.publishCanonicalStateCooperatively(this.assessmentPendingGeneration, yieldControl);
    }
  }

  private async drainAssessmentPublication(yieldControl: PipelineYield): Promise<void> {
    while (this.assessmentPublishedGeneration < this.assessmentPendingGeneration) {
      const generation = this.assessmentPendingGeneration;
      this.assessmentBuildCount += 1;
      const endBuild = startRuntimeWorkTrace("ENGINE_ASSESSMENT_COOPERATIVE_BUILD", {
        generation, buildCount: this.assessmentBuildCount,
      });
      const snapshot = await this.getAssessmentSnapshotCooperatively(yieldControl);
      if (generation !== this.assessmentPublicationGeneration || generation !== this.assessmentPendingGeneration) {
        this.assessmentStaleDiscardCount += 1;
        endBuild({ outcome: "STALE_DISCARDED", staleDiscardCount: this.assessmentStaleDiscardCount });
        continue;
      }
      const endRuntimeProjection = startRuntimeWorkTrace("ENGINE_RUNTIME_SNAPSHOT_PROJECTION");
      const processes = this.orderedLifecycleLeaves("SERIALIZATION");
      runRuntimeDerivedSnapshotTransaction(() => {
        publishRuntimeSnapshot(this.requireRuntimeState(), processes.map(process => ({
        processId: process.outputs.processId, moduleId: process.outputs.moduleId, status: process.outputs.status,
        ...(exposesSnapshotClinicalState(process) ? {
          clinicalState: structuredClone(process.clinicalState),
          lastEvent: this.eventLog.filter(event => event.target === process.processId).at(-1)
            ? { type: this.eventLog.filter(event => event.target === process.processId).at(-1)!.eventType,
              simulationTimeSec: this.eventLog.filter(event => event.target === process.processId).at(-1)!.simulationTime ?? this.simulationTimeSec }
            : undefined,
        } : {}),
        })));
        this.publishResourceDebugSnapshot(false);
        publishAssessmentDebugSnapshot(snapshot);
      });
      endRuntimeProjection({ processCount: processes.length });
      this.assessmentPublishedGeneration = generation;
      this.assessmentPublicationCount += 1;
      endBuild({ outcome: "PUBLISHED", publicationCount: this.assessmentPublicationCount });
    }
  }

  private logEvent(
    eventType: string,
    details: Record<string, unknown> = {},
    target?: string,
    source: CanonicalLifecycleProcess = this.requireProcess()
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
        ...("parentProcessId" in source && source.parentProcessId ? { parentProcessId: source.parentProcessId } : {}),
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

  private publishResourceDebugSnapshot(includeAssessment = true): void {
    const medicationState = this.medicationEngine.snapshot();
    publishResourceRuntimeDebugSnapshot({
      resources: this.resourcePool.snapshot(),
      activeInterventions: this.interventionEngine.snapshot().active,
      clinicalInterventions: this.interventionRuntime.snapshot(),
      airwayStates: this.airwayManagement.snapshot().states,
      circulationStates: this.circulationManagement.snapshot().states,
      hemorrhageProcesses: this.hemorrhageProcesses(),
      medicationState: { ...medicationState,
        instances: [...medicationState.instances],
        events: [...medicationState.events],
        effects: [...medicationState.effects],
        clinicalFeatures: [
          ...this.medicationEngine.norepinephrineProjectionsAt(this.simulationTimeSec),
          ...this.medicationEngine.fluidTherapyProjectionsAt(this.simulationTimeSec),
          ...this.medicationEngine.tranexamicAcidProjectionsAt(this.simulationTimeSec),
          ...this.medicationEngine.analgesicProjectionsAt(this.simulationTimeSec),
          ...this.mechanicalVentilation.projectionsAt(this.simulationTimeSec,
            state => this.mechanicalVentilationProjectionContext(state)),
          ...this.medicationEngine.alsMedicationProjectionsAt(this.simulationTimeSec),
        ] },
      vitalSignStates: this.runtimeState?.vitalSignState ? [{ patientId: this.requireProcess().encounterId, state: this.runtimeState.vitalSignState }] : [],
      recentEvents: this.resourceEventLog,
      updatedAt: this.simulationTimeSec,
    }, this.requireProcess().encounterId);
    if (includeAssessment) this.publishAssessmentSnapshot();
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

  private reconcileMtpAccessFromCanonicalCirculation(): void {
    for (const process of this.lifecycleProcesses("MASSIVE_TRANSFUSION")) {
      const access = this.circulationManagement.getState(process.encounterId).vascularAccess;
      this.replaceLifecycleProcess(reconcileMtpVascularAccess(process as MassiveTransfusionPatientProcessRuntime, access));
    }
  }

  private applyDueResourceInterventions(): void {
    this.resourcePool.update(this.simulationTimeSec);
    for (const resourceEvent of this.interventionEngine.applyDue(this.simulationTimeSec, this.resourcePool)) {
      this.logResourceEvent(resourceEvent);
      const changedInstance = this.interventionRuntime.consumeResourceEvent(
        resourceEvent, this.requireProcess().encounterId, this.resourcePool.snapshot(), this.airwayClinicalContext()
      );
      if (changedInstance) {
        this.projectInterventionState(changedInstance);
        if (["PERIPHERAL_IV_ACCESS", "CENTRAL_VENOUS_ACCESS"].includes(changedInstance.definitionId) && changedInstance.status === "RUNNING") {
          this.logEvent("VascularAccessEstablishmentStarted", { interventionInstanceId: changedInstance.instanceId,
            definitionId: changedInstance.definitionId }, changedInstance.patientId);
        }
      }
      if (changedInstance?.definitionId === "OXYGEN_THERAPY" && changedInstance.status === "CANCELLED" &&
        !this.interventionRuntime.active(changedInstance.patientId).some(item => item.definitionId === "OXYGEN_THERAPY")) {
        this.applyClinicalEffect({ effectId: `${changedInstance.instanceId}:STOP:${resourceEvent.timestamp}`,
          effectType: "INSPIRED_OXYGEN_REMOVED", encounterId: changedInstance.encounterId,
          patientId: changedInstance.patientId, timestamp: resourceEvent.timestamp,
          sourceInterventionInstanceId: changedInstance.instanceId, parameters: {} }, true);
      }
    }
  }

  private projectInterventionState(instance: InterventionInstance): void {
    for (const airwayEvent of this.airwayManagement.apply(instance)) {
      this.logEvent(airwayEvent.eventType, { interventionInstanceId: airwayEvent.interventionInstanceId,
        definitionId: airwayEvent.definitionId, airwayState: airwayEvent.airwayState,
        ventilationState: airwayEvent.ventilationState }, airwayEvent.patientId);
    }
    for (const circulationEvent of this.circulationManagement.apply(instance)) {
      this.logEvent(circulationEvent.eventType, { interventionInstanceId: circulationEvent.interventionInstanceId,
        definitionId: circulationEvent.definitionId }, circulationEvent.patientId);
    }
    this.reconcileMechanicalVentilationAirway(instance.patientId);
  }

  private securedAirwayReference(command: MechanicalVentilationCommand): SecuredAirwayReference | undefined {
    const instance = this.interventionRuntime.active(command.patientId)
      .find(item => item.instanceId === command.securedAirwayId);
    return instance ? { instanceId: instance.instanceId, patientId: instance.patientId,
      definitionId: instance.definitionId, status: "RUNNING",
      airwayState: this.airwayManagement.getState(command.patientId) } : undefined;
  }

  private mechanicalAirwayValid(state: MechanicalVentilationState): boolean {
    const airwayState = this.airwayManagement.getState(state.patientId);
    return airwayState.activeAirway === "ENDOTRACHEAL" && airwayState.confirmed &&
      this.interventionRuntime.active(state.patientId).some(item => item.instanceId === state.securedAirwayId &&
        item.definitionId === "ENDOTRACHEAL_INTUBATION");
  }

  private mechanicalVentilationProjectionContext(state: MechanicalVentilationState):
    MechanicalVentilationProjectionContext {
    return { airwayValid: this.mechanicalAirwayValid(state),
      spontaneousRespiratoryRate: this.spontaneousRespiratoryRate(),
      medicationRespiratoryDepression: this.medicationEngine.analgesicAggregateAt(
        state.patientId, this.simulationTimeSec).respiratoryDepression };
  }

  private spontaneousRespiratoryRate(): number {
    const runtime = this.requireRuntimeState();
    const vitalState = runtime.vitalSignState;
    if (!vitalState) return runtime.targetVitals.rr ?? defaultVitalSignConfiguration.signs.respiratoryRate.baseline;
    let target = vitalState.baseline.respiratoryRate;
    for (const contributor of vitalState.activeContributors) {
      if (contributor.vital !== "respiratoryRate" || contributor.layer === "EXTERNAL_RESPIRATORY_SUPPORT") continue;
      target = contributor.operation === "DELTA" ? target + contributor.value : contributor.value;
    }
    return target;
  }

  private reconcileMechanicalVentilationAirway(patientId: string): void {
    const airwayState = this.airwayManagement.getState(patientId);
    const valid = new Set(this.interventionRuntime.active(patientId).filter(item =>
      item.definitionId === "ENDOTRACHEAL_INTUBATION" && airwayState.activeAirway === "ENDOTRACHEAL" &&
      airwayState.confirmed).map(item => item.instanceId));
    const events = this.mechanicalVentilation.reconcileAirway(patientId, valid, this.simulationTimeSec);
    for (const event of events) {
      this.logEvent(event.eventType, { ...event }, event.patientId);
      const airwayEvent = this.airwayManagement.setMechanicalVentilation(patientId, false,
        this.simulationTimeSec, event.supportId);
      if (airwayEvent) this.logEvent(airwayEvent.eventType, { interventionInstanceId: airwayEvent.interventionInstanceId,
        definitionId: airwayEvent.definitionId, airwayState: airwayEvent.airwayState,
        ventilationState: airwayEvent.ventilationState }, airwayEvent.patientId);
    }
    if (events.length) this.aggregateProcesses();
  }

  private alsRhythmContext(patientId: string): AlsRhythmContext | undefined {
    const process = this.orderedLifecycleLeaves("SERIALIZATION").find(item =>
      item.processType === "CARDIAC_ARREST" && item.encounterId === patientId) as
      CardiacArrestPatientProcessRuntime | undefined;
    if (!process) return undefined;
    return Object.freeze({ patientId, cardiacState: process.clinicalState.cardiacState,
      rhythm: process.clinicalState.rhythm, rhythmClassification: process.clinicalState.rhythmClassification,
      shockAttemptCount: process.clinicalState.shockAttemptCount, cprActive: process.clinicalState.cprActive,
      ...(process.clinicalState.adverseSigns === undefined ? {} : {
        adverseSigns: process.clinicalState.adverseSigns,
      }), hyperkalaemiaSubstrate: "UNMODELED" });
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
      ? this.orderedLifecycleLeaves("SERIALIZATION").find(item => item.processId === evidence.sourceProcessId)
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
