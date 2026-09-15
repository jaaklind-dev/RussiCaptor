import type { LabPatientBloodIdentity, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
import { getInstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";

export function handleLaboratoryCommand(input: Readonly<{ commandId: string; exerciseId: string;
  patientId: string; commandType: "LAB_ORDER" | "LAB_COLLECT"; actorUserId: string;
  simulationTimeSec: number; patientRevision: number; labPackageId?: NarvaLabPackageId;
  orderId?: string; patientBloodIdentity?: LabPatientBloodIdentity }>) {
  const owner = getInstructorRuntimeOwner(input.exerciseId, input.patientId);
  if (!owner?.executeLaboratoryCommand) return { ok: false as const, reason: "Patient runtime is not available" };
  return owner.executeLaboratoryCommand(input);
}
