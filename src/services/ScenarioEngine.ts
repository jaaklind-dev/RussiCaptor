import {
  getAllPendingScenarioEvents,

  markScenarioEventExecuted,
} from "@/repositories/ScenarioRepository";

import { notifySync } from "@/services/SyncService";

import { executeScenarioEvent } from "@/services/WorkflowExecutor";

import type { GoldenActualEvent, GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { OwnershipRule } from "@/models/ModuleImport";
import type { PatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import { bootstrapHvPatientProcess, tickHvPatientProcess } from "@/services/runtime/HvPatientProcess";
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
    runtimeFields: {
      ventilationReserve: process.clinicalState.ventilationReserve,
      co2Burden: process.clinicalState.co2Burden,
    },
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

export class ClinicalScenarioEngine {
  private process?: PatientProcessRuntime;
  private runtimeState?: RuntimeState;
  private simulationTimeSec = 0;
  private sequence = 0;
  private eventLog: GoldenActualEvent[] = [];
  private readonly appliedEventIds = new Set<string>();
  private readonly resolver = new RuntimeOwnershipResolver(firstClinicalOwnershipRules);

  reset(fixture: GoldenFixture): void {
    this.process = bootstrapHvPatientProcess(fixture);
    this.runtimeState = initialRuntimeState(fixture, this.process);
    this.simulationTimeSec = 0;
    this.sequence = 0;
    this.eventLog = [];
    this.appliedEventIds.clear();
  }

  advanceTo(simulationTimeSec: number): void {
    if (!Number.isFinite(simulationTimeSec) || simulationTimeSec < this.simulationTimeSec) {
      throw new Error("Simulatsiooniaeg peab liikuma deterministlikult edasi.");
    }
    this.simulationTimeSec = simulationTimeSec;
  }

  dispatch(event: GoldenInputEvent): void {
    const process = this.requireProcess();
    const runtimeState = this.requireRuntimeState();
    if (this.appliedEventIds.has(event.eventId)) return;
    if (event.eventType !== "ENGINE_TICK") {
      throw new Error(`NOT_IMPLEMENTED: ClinicalScenarioEngine sündmus ${event.eventType}.`);
    }
    const tickMinutes = Number(eventPayload(event).tickMin);
    if (!Number.isFinite(tickMinutes) || tickMinutes <= 0) {
      throw new Error("ENGINE_TICK payload.tickMin peab olema positiivne arv.");
    }
    this.process = tickHvPatientProcess(process, tickMinutes * 60);
    const aggregated = aggregateRuntimeState({
      previous: runtimeState,
      expectedStateVersion: runtimeState.stateVersion,
      exerciseTimeSec: this.simulationTimeSec,
      processOutputs: [this.process.outputs],
      aggregationConfigVersion: "WP-5/HV-001",
    }, this.resolver);
    if (aggregated.rejectedProcessIds.length > 0) {
      throw new Error(`HV ProcessOutput lükati tagasi: ${aggregated.rejectedProcessIds.join(", ")}`);
    }
    this.runtimeState = aggregated.state;
    this.appliedEventIds.add(event.eventId);
    this.sequence += 1;
    this.eventLog.push({
      eventType: "ENGINE_TICK_APPLIED",
      sourceModule: "HYPOVENTILATION_HYPERCAPNIA_V1",
      target: this.process.processId,
      simulationTime: this.simulationTimeSec,
      enginePhase: 2,
      sequence: this.sequence,
      payload: {
        sourceProcessId: this.process.processId,
        inputEventId: event.eventId,
        tickSeconds: tickMinutes * 60,
      },
    });
  }

  getPatientProcess(): PatientProcessRuntime {
    return structuredClone(this.requireProcess());
  }

  getRuntimeState(): RuntimeState {
    return structuredClone(this.requireRuntimeState());
  }

  getEventLog(): GoldenActualEvent[] {
    return structuredClone(this.eventLog);
  }

  getHashes(): { stateHash: string; eventLogHash: string; processTreeHash: string; replayHash: string } {
    const stateHash = sha256Text(stableJson(this.requireRuntimeState()));
    const eventLogHash = sha256Text(stableJson(this.eventLog));
    const processTreeHash = sha256Text(stableJson(this.requireProcess()));
    return {
      stateHash,
      eventLogHash,
      processTreeHash,
      replayHash: sha256Text(stableJson({ stateHash, eventLogHash, processTreeHash })),
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
}
