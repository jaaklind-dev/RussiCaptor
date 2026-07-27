import type { GoldenFixture } from "@/models/GoldenTest";
import type {
  BotulismChildProcessRuntime,
  BotulismRootPatientProcessRuntime,
} from "@/models/PatientProcessRuntime";

type Assignment = Record<string, unknown>;

function assignments(initial: Record<string, unknown>): Assignment[] {
  const value = initial.processAssignments ?? initial.botulismProcesses;
  if (!Array.isArray(value)) throw new Error("Botulism fixture protsesside loend puudub.");
  return value.filter(item => item && typeof item === "object") as Assignment[];
}

export function bootstrapBotulismRoot(fixture: GoldenFixture): BotulismRootPatientProcessRuntime {
  const initial = fixture.initialState as Record<string, unknown>;
  const rows = assignments(initial);
  const typeById = new Map(rows.map(row => [String(row.PatientProcessID), String(row.ProcessType)]));
  const children: BotulismChildProcessRuntime[] = rows.map(row => ({
    processId: String(row.PatientProcessID),
    encounterId: fixture.patientId ?? String(initial.PatientID ?? initial.patientId),
    instanceKey: String(row.InstanceKey),
    processType: String(row.ProcessType),
    templateId: String(row.TemplateID),
    state: String(row.Status) === "Resolved" ? "Resolved" : "Active",
    elapsedTime: 0,
    initialReserve: Number(row.InitialReserve),
    progressionRate: Number(row.ProgressionRate),
    outputs: {
      processId: String(row.PatientProcessID),
      encounterId: fixture.patientId ?? String(initial.PatientID ?? initial.patientId),
      moduleId: "BOTULISM_V1",
      status: String(row.Status) === "Resolved" ? "Resolved" : "Active",
      globalSeverityScore: 0,
      runtimeContributions: {},
      observedAtSec: 0,
    },
    nextTick: 60,
    parentProcessId: row.ParentProcessID ? String(row.ParentProcessID) : undefined,
    parentProcessType: row.ParentProcessID ? typeById.get(String(row.ParentProcessID)) : undefined,
  }));
  const encounterId = fixture.patientId ?? String(initial.PatientID ?? initial.patientId);
  return {
    processId: `${encounterId}:BOTULISM_ROOT`, encounterId, instanceKey: `${encounterId}:botulism`,
    processType: "BOTULISM_ROOT", templateId: "BOTULISM_ROOT", state: "Active",
    elapsedTime: 0, outputs: {
      processId: `${encounterId}:BOTULISM_ROOT`, encounterId, moduleId: "BOTULISM_V1",
      status: "Active", globalSeverityScore: 0, runtimeContributions: {}, observedAtSec: 0,
    }, nextTick: 60, children: children.sort((a, b) => a.processId.localeCompare(b.processId)),
  };
}

export function tickBotulismRoot(
  previous: BotulismRootPatientProcessRuntime,
  elapsedTime: number
): BotulismRootPatientProcessRuntime {
  const children = previous.children.map(child => ({
    ...child, elapsedTime, nextTick: elapsedTime + 60,
    outputs: { ...child.outputs, observedAtSec: elapsedTime },
  }));
  return { ...previous, elapsedTime, nextTick: elapsedTime + 60, children };
}
