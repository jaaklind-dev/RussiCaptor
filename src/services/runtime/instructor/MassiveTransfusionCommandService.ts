import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";
import { getInstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";

export type MtpAction = "MTP_ACTIVATION" | "RBC_ADMINISTRATION" | "PLASMA_ADMINISTRATION" | "PLATELET_ADMINISTRATION" | "CALCIUM_ADMINISTRATION";
export type MtpCommandResult = Readonly<{ ok: true; commandId: string; runtimeEventId: string }> | Readonly<{ ok: false; commandId: string; errorCode: "UNAVAILABLE" | "RUNTIME_FAILURE"; message: string }>;
const results = new Map<string, MtpCommandResult>();
let commandSequence = 0;
const labels: Record<MtpAction, readonly [string, string]> = {
  MTP_ACTIVATION: ["MTP aktiveeritud", "Massiivse transfusiooni protokoll aktiveeriti"],
  RBC_ADMINISTRATION: ["Erütrotsüütide manustamine alustatud", "Erütrotsüütide suspensiooni manustamine alustati"],
  PLASMA_ADMINISTRATION: ["Plasma manustamine alustatud", "Plasma manustamine alustati"],
  PLATELET_ADMINISTRATION: ["Trombotsüütide manustamine alustatud", "Trombotsüütide kontsentraadi manustamine alustati"],
  CALCIUM_ADMINISTRATION: ["Kaltsium manustatud", "Kaltsiumiannus manustati"],
};
export function createMtpCommandId(exerciseId: string, patientId: string, action: MtpAction): string {
  commandSequence += 1;
  const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(patientId)?.state.exerciseTimeSec ?? 0;
  return `MTP-${exerciseId}-${patientId}-${action}-${simulationTimeSec}-${commandSequence}`;
}
export function handleMtpCommand(command: Readonly<{ commandId: string; exerciseId: string; patientId: string; action: MtpAction; units?: number; issuedBy: string }>): MtpCommandResult {
  const previous = results.get(command.commandId); if (previous) return structuredClone(previous);
  const applied = getInstructorRuntimeOwner(command.exerciseId, command.patientId)?.executeMtpAction?.(command.commandId, command.action, command.units ?? 1);
  const result: MtpCommandResult = !applied ? { ok: false, commandId: command.commandId, errorCode: "UNAVAILABLE", message: "MTP Runtime ei ole saadaval" }
    : applied.ok ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: applied.reason };
  if (result.ok) { const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(command.patientId)?.state.exerciseTimeSec ?? 0; const [title, description] = labels[command.action];
    addTimelineEvent({ id: `TL-MTP-${command.commandId}`, exerciseId: command.exerciseId, patientId: command.patientId, timestamp: `T+${simulationTimeSec}s`, simulationTimeSec,
      type: "intervention", title, description: `${description}${command.action === "MTP_ACTIVATION" || command.action === "CALCIUM_ADMINISTRATION" ? "" : ` (${command.units ?? 1})`}`, author: command.issuedBy, visibility: "revealed" }); }
  results.set(command.commandId, structuredClone(result)); return structuredClone(result);
}
export function resetMtpCommands(): void { results.clear(); commandSequence = 0; }
