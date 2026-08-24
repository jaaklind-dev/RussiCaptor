import type { PatientTransport, PatientTransportRuntimeState, TransportCommandResult, TransportConfiguration, TransportDestinationDefinition, TransportEvidence, TransportEvidenceType, TransportResourceRuntime } from "@/models/PatientTransport";
import { stableJson } from "@/utils/stableJson";

const copy = <T>(value: T): T => structuredClone(value);
const byId = <T extends { resourceId?: string; destinationId?: string; transportId?: string }>(a: T, b: T) => (a.resourceId ?? a.destinationId ?? a.transportId ?? "").localeCompare(b.resourceId ?? b.destinationId ?? b.transportId ?? "");

export class PatientTransportEngine {
  private time = 0; private sequence = 0;
  private readonly resources = new Map<string, TransportResourceRuntime>();
  private readonly destinations = new Map<string, TransportDestinationDefinition>();
  private readonly transports = new Map<string, PatientTransport>();
  private readonly commandResults = new Map<string, TransportCommandResult>();
  private readonly locations = new Map<string, string>();
  private readonly evidence: TransportEvidence[] = [];

  constructor(readonly configuration: TransportConfiguration, initialPatientLocations: Readonly<Record<string, string>> = {}, restored?: PatientTransportRuntimeState) {
    this.validate(configuration);
    configuration.destinations.forEach(item => this.destinations.set(item.destinationId, copy(item)));
    configuration.resources.forEach(item => this.resources.set(item.resourceId, { resourceId: item.resourceId, state: "AVAILABLE", availableAtSimulationTime: 0 }));
    Object.entries(initialPatientLocations).forEach(([id, location]) => this.locations.set(id, location));
    if (restored) this.restore(restored);
  }

  start(commandId: string, patientId: string, resourceId: string, destinationId: string, atSec: number): TransportCommandResult {
    const prior = this.commandResults.get(commandId); if (prior) return copy(prior);
    this.advanceTo(atSec);
    const resource = this.resources.get(resourceId); const destination = this.destinations.get(destinationId);
    if (!resource) return this.remember(commandId, { status: "REJECTED", reason: "UNKNOWN_RESOURCE" });
    if (!destination) return this.remember(commandId, { status: "REJECTED", reason: "UNKNOWN_DESTINATION" });
    if (!this.locations.get(patientId)) return this.remember(commandId, { status: "REJECTED", reason: "INVALID_PATIENT_LOCATION" });
    if (resource.state !== "AVAILABLE") return this.remember(commandId, { status: "REJECTED", reason: "TRANSPORT_RESOURCE_BUSY" });
    const transportId = `TRANSPORT-${commandId}`;
    const transport: PatientTransport = { transportId, commandId, patientId, resourceId, destinationId, state: "IN_TRANSIT", requestedAtSec: atSec, onboardAtSec: atSec, departedAtSec: atSec };
    this.transports.set(transportId, transport);
    this.locations.set(patientId, this.configuration.vehicleLocationId);
    this.resources.set(resourceId, { resourceId, state: "OUTBOUND", currentPatientId: patientId, currentTransportId: transportId, phaseEndsAtSec: atSec + destination.travelDurationSec, availableAtSimulationTime: atSec + destination.travelDurationSec + destination.handoverDurationSec + destination.returnDurationSec + destination.turnaroundDurationSec });
    this.emit("TRANSPORT_REQUESTED", atSec, transport); this.emit("PATIENT_ONBOARD", atSec, transport); this.emit("TRANSPORT_DEPARTED", atSec, transport);
    return this.remember(commandId, { status: "STARTED", transport: copy(transport) });
  }

  cancel(commandId: string, transportId: string, atSec: number): TransportCommandResult {
    const prior = this.commandResults.get(commandId); if (prior) return copy(prior);
    this.advanceTo(atSec); const transport = this.transports.get(transportId);
    if (!transport || transport.state !== "ONBOARD") return this.remember(commandId, { status: "REJECTED", reason: "TRANSPORT_NOT_CANCELLABLE" });
    const cancelled = { ...transport, state: "CANCELLED" as const, completedAtSec: atSec }; this.transports.set(transportId, cancelled);
    this.releaseResource(cancelled.resourceId, atSec); this.emit("TRANSPORT_CANCELLED", atSec, cancelled);
    return this.remember(commandId, { status: "CANCELLED", transport: copy(cancelled) });
  }

  advanceTo(targetSec: number): void {
    if (!Number.isInteger(targetSec) || targetSec < this.time) throw new Error("TRANSPORT_CLOCK_INVALID");
    while (true) {
      const next = [...this.resources.values()].filter(item => item.phaseEndsAtSec !== undefined && item.phaseEndsAtSec <= targetSec).sort((a, b) => a.phaseEndsAtSec! - b.phaseEndsAtSec! || a.resourceId.localeCompare(b.resourceId))[0];
      if (!next) break; this.time = next.phaseEndsAtSec!; this.completePhase(next);
    }
    this.time = targetSec;
  }

  snapshot(): PatientTransportRuntimeState {
    return copy({ schemaVersion: 1, configuration: this.configuration, currentSimulationTimeSec: this.time, sequence: this.sequence, resources: [...this.resources.values()].sort(byId), transports: [...this.transports.values()].sort(byId), patientLocations: Object.fromEntries([...this.locations.entries()].sort(([a], [b]) => a.localeCompare(b))), evidence: [...this.evidence] });
  }

  private completePhase(resource: TransportResourceRuntime): void {
    const transport = resource.currentTransportId ? this.transports.get(resource.currentTransportId) : undefined;
    if (!transport) throw new Error("TRANSPORT_STATE_INVALID"); const destination = this.destinations.get(transport.destinationId)!; const at = resource.phaseEndsAtSec!;
    if (resource.state === "OUTBOUND") {
      const arrived = { ...transport, state: "ARRIVED" as const, arrivedAtSec: at }; this.transports.set(transport.transportId, arrived); this.locations.set(transport.patientId, destination.destinationId); this.emit("TRANSPORT_ARRIVED", at, arrived);
      this.resources.set(resource.resourceId, { ...resource, state: "HANDOVER", phaseEndsAtSec: at + destination.handoverDurationSec }); return;
    }
    if (resource.state === "HANDOVER") {
      const handed = { ...transport, state: "HANDED_OVER" as const, handedOverAtSec: at }; this.transports.set(transport.transportId, handed); this.emit("TRANSPORT_HANDOVER_COMPLETED", at, handed); this.emit("TRANSPORT_RETURNING", at, handed);
      this.resources.set(resource.resourceId, { ...resource, state: "RETURNING", currentPatientId: undefined, phaseEndsAtSec: at + destination.returnDurationSec }); return;
    }
    if (resource.state === "RETURNING") {
      if (destination.turnaroundDurationSec > 0) { this.resources.set(resource.resourceId, { ...resource, state: "TURNAROUND", phaseEndsAtSec: at + destination.turnaroundDurationSec }); return; }
      this.finish(resource, transport, at); return;
    }
    if (resource.state === "TURNAROUND") this.finish(resource, transport, at);
  }
  private finish(resource: TransportResourceRuntime, transport: PatientTransport, at: number) { const done = { ...transport, state: "COMPLETED" as const, completedAtSec: at }; this.transports.set(transport.transportId, done); this.releaseResource(resource.resourceId, at); this.emit("TRANSPORT_RESOURCE_AVAILABLE", at, done); }
  private releaseResource(resourceId: string, at: number) { this.resources.set(resourceId, { resourceId, state: "AVAILABLE", availableAtSimulationTime: at }); }
  private emit(type: TransportEvidenceType, at: number, transport: PatientTransport) { this.evidence.push({ sequence: ++this.sequence, type, simulationTimeSec: at, transportId: transport.transportId, patientId: transport.patientId, resourceId: transport.resourceId, destinationId: transport.destinationId }); }
  private remember(commandId: string, result: TransportCommandResult) { this.commandResults.set(commandId, copy(result)); return copy(result); }
  private restore(state: PatientTransportRuntimeState) { if (state.schemaVersion !== 1 || stableJson(state.configuration) !== stableJson(this.configuration)) throw new Error("TRANSPORT_CONFIGURATION_MISMATCH"); this.time = state.currentSimulationTimeSec; this.sequence = state.sequence; this.resources.clear(); state.resources.forEach(x => this.resources.set(x.resourceId, copy(x))); state.transports.forEach(x => { this.transports.set(x.transportId, copy(x)); this.commandResults.set(x.commandId, { status: "STARTED", transport: copy(x) }); }); this.locations.clear(); Object.entries(state.patientLocations).forEach(([k, v]) => this.locations.set(k, v)); this.evidence.push(...state.evidence.map(copy)); }
  private validate(config: TransportConfiguration) { const resourceIds = new Set<string>(); const destinationIds = new Set<string>(); if (!config.version || !config.vehicleLocationId || !config.resources.length) throw new Error("TRANSPORT_CONFIGURATION_INVALID"); for (const r of config.resources) { if (!r.resourceId || !r.resourceType || !r.displayName || !r.homeLocationId || r.capacity !== 1 || resourceIds.has(r.resourceId)) throw new Error("TRANSPORT_CONFIGURATION_INVALID"); resourceIds.add(r.resourceId); } for (const d of config.destinations) { if (!d.destinationId || !d.displayName || destinationIds.has(d.destinationId) || [d.travelDurationSec,d.handoverDurationSec,d.returnDurationSec,d.turnaroundDurationSec].some(v => !Number.isInteger(v) || v < 0)) throw new Error("TRANSPORT_CONFIGURATION_INVALID"); destinationIds.add(d.destinationId); } }
}
