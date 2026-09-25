import { getInstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";

export function handleImagingOrder(input: Readonly<{ commandId: string; exerciseId: string; patientId: string;
  actorUserId: string; simulationTimeSec: number; definitionId: string }>) {
  const owner = getInstructorRuntimeOwner(input.exerciseId, input.patientId);
  if (!owner?.executeImagingOrder) return { ok: false as const, reason: "Patient runtime is not available" };
  return owner.executeImagingOrder(input);
}
