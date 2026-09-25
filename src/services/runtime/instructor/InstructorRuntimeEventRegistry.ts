import type { InstructorEventType, InstructorPatientCommand } from "@/models/InstructorCommand";
import type { CardiacInterventionAction } from "@/models/CardiacInterventionCommand";
import type { ClinicalTreatmentCommand, ClinicalTreatmentRuntimeResult } from "@/models/ClinicalTreatment";
import type { ClinicalParameterValue } from "@/models/ClinicalIntegration";
import type { NarvaIroControlMaterializationAudit, NarvaIroScenarioControlCommandType,
  NarvaIroVentilationFault } from "@/models/NarvaIroScenario";
import type { LabPatientBloodIdentity, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
export type InstructorRuntimeEventResult = {
  readonly ok: true;
  readonly runtimeEventId: string;
  readonly changed?: boolean;
  readonly controlAudit?: NarvaIroControlMaterializationAudit;
} | {
  readonly ok: false;
  readonly reason: string;
  readonly code?: string;
  readonly controlAudit?: NarvaIroControlMaterializationAudit;
};
export type InstructorRuntimeOwner = { readonly exerciseId: string; readonly patientId: string; readonly supportedEvents: readonly InstructorEventType[]; execute(command: InstructorPatientCommand): InstructorRuntimeEventResult; executeClinicalIntervention?(commandId: string, action: CardiacInterventionAction): InstructorRuntimeEventResult; executeResourceIntervention?(commandId: string, resourceId: string, canonicalSimulationTimeSec?: number): InstructorRuntimeEventResult; executeResourceAwareIntervention?(commandId: string, definitionId: string, resourceIds: string[], parameters: Record<string, ClinicalParameterValue>): InstructorRuntimeEventResult; stopResourceIntervention?(commandId: string, sourceInterventionId: string): InstructorRuntimeEventResult; executeMtpAction?(commandId: string, action: "MTP_ACTIVATION" | "RBC_ADMINISTRATION" | "PLASMA_ADMINISTRATION" | "PLATELET_ADMINISTRATION" | "CALCIUM_ADMINISTRATION" | "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE", units: number, options?: Readonly<Record<string, unknown>>): InstructorRuntimeEventResult; executeClinicalTreatment?(command: ClinicalTreatmentCommand, acceptedDurableSimulationTimeSec?: number): ClinicalTreatmentRuntimeResult; executeNarvaIroScenarioControl?(commandId: string, commandType: NarvaIroScenarioControlCommandType, faultType?: NarvaIroVentilationFault, acceptedDurableSimulationTimeSec?: number): InstructorRuntimeEventResult; executeLaboratoryCommand?(input: Readonly<{ commandId: string; commandType: "LAB_ORDER" | "LAB_COLLECT"; actorUserId: string; simulationTimeSec: number; patientRevision: number; labPackageId?: NarvaLabPackageId; orderId?: string; patientBloodIdentity?: LabPatientBloodIdentity }>): InstructorRuntimeEventResult; advanceRuntime?(commandId: string, durationSec: number, canonicalSimulationTimeSec?: number): InstructorRuntimeEventResult };
export type ImagingRuntimeOwner = InstructorRuntimeOwner & Readonly<{ executeImagingOrder?(input: Readonly<{
  commandId: string; actorUserId: string; simulationTimeSec: number; definitionId: string;
}>): InstructorRuntimeEventResult }>;
const owners = new Map<string, InstructorRuntimeOwner>();
const key = (exerciseId: string, patientId: string) => `${exerciseId}\u0000${patientId}`;
export function registerInstructorRuntimeOwner(owner: InstructorRuntimeOwner): () => void { const ownerKey = key(owner.exerciseId, owner.patientId); owners.set(ownerKey, owner); return () => { if (owners.get(ownerKey) === owner) owners.delete(ownerKey); }; }
export function getInstructorRuntimeOwner(exerciseId: string, patientId: string): ImagingRuntimeOwner | undefined { return owners.get(key(exerciseId, patientId)); }
export function getInstructorEventAvailability(exerciseId: string, patientId: string, eventType: InstructorEventType): { available: boolean; reason?: string } { const owner = getInstructorRuntimeOwner(exerciseId, patientId); if (!owner) return { available: false, reason: "Patient runtime is not available" }; if (!owner.supportedEvents.includes(eventType)) return { available: false, reason: "No registered runtime handler" }; return { available: true }; }
export function clearInstructorRuntimeOwners(): void { owners.clear(); }
