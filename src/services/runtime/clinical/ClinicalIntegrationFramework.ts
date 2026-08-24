import type {
  ClinicalIntegrationEvent,
  ClinicalIntegrationInput,
  ClinicalIntegrationRejectionCode,
  ClinicalIntegrationResult,
  ClinicalProcessRuntime,
} from "@/models/ClinicalIntegration";
import { ClinicalProcessRegistry } from "@/services/runtime/clinical/ClinicalProcessRegistry";

function sorted(processes: ClinicalProcessRuntime[]): ClinicalProcessRuntime[] {
  return [...processes].sort((a, b) =>
    a.processType.localeCompare(b.processType) || a.processId.localeCompare(b.processId) ||
    a.instanceKey.localeCompare(b.instanceKey)
  );
}

export class ClinicalIntegrationFramework {
  private readonly completedInputIds = new Set<string>();
  private readonly eventLog: ClinicalIntegrationEvent[] = [];

  constructor(private readonly registry: ClinicalProcessRegistry) {}

  reset(): void {
    this.completedInputIds.clear();
    this.eventLog.length = 0;
  }

  apply(input: ClinicalIntegrationInput, current: ClinicalProcessRuntime[]): ClinicalIntegrationResult {
    if (this.completedInputIds.has(input.inputId)) {
      return { status: "NO_OP", processes: structuredClone(sorted(current)), outputs: current.map(p => structuredClone(p.outputs)), events: [] };
    }
    const invalid = this.validate(input, current);
    if (invalid) return this.reject(input, current, invalid.code, invalid.detail);
    const targets = this.registry.resolve(input, current);
    if (!targets.length) return this.reject(input, current, "UNSUPPORTED_INPUT", `Effect ${input.payload.effectType} pole aktiivsete protsesside poolt toetatud.`);

    const replacements = new Map<string, ClinicalProcessRuntime>();
    const events: ClinicalIntegrationEvent[] = [];
    try {
      for (const target of targets) {
        const result = target.handler.apply(input, structuredClone(target.process));
        if (result.changed === false) continue;
        replacements.set(result.process.processId, result.process);
        events.push(result.event);
      }
    } catch (error) {
      return this.reject(input, current, "PROCESS_REJECTED", error instanceof Error ? error.message : String(error));
    }
    this.completedInputIds.add(input.inputId);
    if (replacements.size === 0) return { status: "NO_OP", processes: structuredClone(sorted(current)), outputs: current.map(p => structuredClone(p.outputs)), events: [] };
    const processes = sorted(current.map(process => replacements.get(process.processId) ?? structuredClone(process)));
    this.eventLog.push(...structuredClone(events));
    return { status: "APPLIED", processes, outputs: processes.map(p => structuredClone(p.outputs)), events };
  }

  snapshot(): { completedInputIds: string[]; events: ClinicalIntegrationEvent[] } {
    return { completedInputIds: [...this.completedInputIds].sort(), events: structuredClone(this.eventLog) };
  }

  restore(snapshot: Readonly<{ completedInputIds: readonly string[]; events: readonly ClinicalIntegrationEvent[] }>): void {
    this.completedInputIds.clear(); snapshot.completedInputIds.forEach(id => this.completedInputIds.add(id));
    this.eventLog.splice(0, this.eventLog.length, ...structuredClone(snapshot.events));
  }

  private validate(input: ClinicalIntegrationInput, current: ClinicalProcessRuntime[]): { code: ClinicalIntegrationRejectionCode; detail: string } | undefined {
    if (!input.inputId || !input.encounterId || !input.patientId || !Number.isFinite(input.timestamp) || input.timestamp < 0 || !input.payload?.effectId) {
      return { code: "INVALID_INPUT", detail: "Clinical input identity, timestamp või effect on vigane." };
    }
    if (current.some(process => process.encounterId !== input.encounterId)) {
      return { code: "ENCOUNTER_MISMATCH", detail: "Clinical input ei kuulu protsesside encounter'isse." };
    }
    if (!current.some(process => process.state !== "Resolved")) {
      return { code: "NO_ACTIVE_PROCESS", detail: "Aktiivne PatientProcess puudub." };
    }
    return undefined;
  }

  private reject(
    input: ClinicalIntegrationInput,
    current: ClinicalProcessRuntime[],
    reasonCode: ClinicalIntegrationRejectionCode,
    detail: string
  ): ClinicalIntegrationResult {
    const event: ClinicalIntegrationEvent = {
      eventType: "ClinicalEffectRejected", timestamp: input.timestamp, inputId: input.inputId,
      encounterId: input.encounterId, sourceId: input.source.sourceId,
      effectType: input.payload.effectType, reasonCode,
    };
    this.completedInputIds.add(input.inputId);
    this.eventLog.push(event);
    const processes = structuredClone(sorted(current));
    return { status: "REJECTED", processes, outputs: processes.map(p => p.outputs), events: [event], rejection: { reasonCode, detail } };
  }
}
