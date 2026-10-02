import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { AcceptedRuntimePatientCommand } from "@/models/RuntimePatientCommand";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

export function canonicalEttSourceInterventionId(commandId: string): string {
  return `CLINICAL:${commandId}`;
}

export function canonicalEttInstanceId(commandId: string): string {
  return `${canonicalEttSourceInterventionId(commandId)}:INSTANCE`;
}

export function canonicalEttEvidenceId(commandId: string): string {
  return `TL-ETT-${commandId}`;
}

export function checkpointHasCanonicalEttMaterialization(
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  command: AcceptedRuntimePatientCommand,
): boolean {
  if (!checkpoint || checkpoint.exerciseId !== command.exerciseId ||
      command.commandType !== "ENDOTRACHEAL_INTUBATION") return false;
  const instanceId = canonicalEttInstanceId(command.commandId);
  const sourceInterventionId = canonicalEttSourceInterventionId(command.commandId);
  const hasIntervention = (checkpoint.payload.persistedRuntimeStates ?? []).some(runtime =>
    runtime.provenance.patientId === command.patientId &&
    runtime.payload.interventionInstances.some(instance =>
      instance.instanceId === instanceId &&
      instance.sourceInterventionId === sourceInterventionId &&
      instance.definitionId === "ENDOTRACHEAL_INTUBATION" &&
      instance.patientId === command.patientId &&
      instance.status === "RUNNING"));
  const hasEvidence = checkpoint.payload.timelineEvents.some(event =>
    event.id === canonicalEttEvidenceId(command.commandId) &&
    event.patientId === command.patientId &&
    event.exerciseId === command.exerciseId);
  return hasIntervention && hasEvidence;
}
