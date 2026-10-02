import { dataProvider, clinicalDataProvider } from "@/providers/ProviderFactory";
import { getAssignmentState, restoreAssignmentState, restoreAuthoritativePatientOwnershipProjection } from "@/services/AssignmentRepository";

export type PatientSharedWorkflowState = Readonly<Record<string, unknown>> & Readonly<{
  patient?: Readonly<Record<string,unknown>>;
  assignments: readonly Readonly<Record<string,unknown>>[];
  transfers: readonly Readonly<Record<string,unknown>>[];
  questions: readonly Readonly<Record<string,unknown>>[];
  labs: readonly Readonly<Record<string,unknown>>[];
  imagingStudies: readonly Readonly<Record<string,unknown>>[];
  orders: readonly Readonly<Record<string,unknown>>[];
  notes: readonly Readonly<Record<string,unknown>>[];
  timelineEvents: readonly Readonly<Record<string,unknown>>[];
  interventions: readonly Readonly<Record<string,unknown>>[];
  medicationAdministrations: readonly Readonly<Record<string,unknown>>[];
  vitalSigns: readonly Readonly<Record<string,unknown>>[];
}>;

export type PatientSharedWorkflowCanonicalReconciliation = Readonly<{
  accepted: boolean;
  mode: "FULL_SHARED_WORKFLOW" | "OWNERSHIP_ONLY" | "REJECTED";
  conflicts: readonly string[];
}>;

const copy = <T extends object>(value:T):T => ({...value});
const patientItems = <T extends {patientId:string}>(items:readonly T[],patientId:string):T[] => items.filter(item=>item.patientId===patientId).map(copy);

export function capturePatientSharedWorkflowState(patientId:string):PatientSharedWorkflowState {
  const assignment=getAssignmentState(); const patient=dataProvider.getPatients().find(item=>item.id===patientId);
  return Object.freeze({
    patient:patient?Object.freeze({...patient,mist:{...patient.mist}}):undefined,
    assignments:patientItems(assignment.assignments,patientId),transfers:patientItems(assignment.transfers,patientId),
    questions:patientItems(clinicalDataProvider.getQuestions(),patientId),labs:patientItems(clinicalDataProvider.getLabs(),patientId),
    imagingStudies:patientItems(clinicalDataProvider.getImagingStudies(),patientId),orders:patientItems(clinicalDataProvider.getOrders(),patientId).map(item=>({...item,workflow:{...item.workflow}})),
    notes:patientItems(clinicalDataProvider.getNotes(),patientId),timelineEvents:patientItems(clinicalDataProvider.getTimelineEvents(),patientId),
    interventions:patientItems(clinicalDataProvider.getInterventions(),patientId),medicationAdministrations:patientItems(clinicalDataProvider.getMedicationAdministrations(),patientId),
    vitalSigns:patientItems(clinicalDataProvider.getVitalSigns(),patientId),
  });
}

function replacePatientItems<T extends {patientId:string}>(target:T[],patientId:string,replacement:readonly Readonly<Record<string,unknown>>[]):void {
  target.splice(0,target.length,...target.filter(item=>item.patientId!==patientId),...replacement.map(item=>({...item} as T)));
}

export function restorePatientSharedWorkflowState(patientId:string,state:PatientSharedWorkflowState):void {
  if(state.patient){const patients=dataProvider.getPatients();const index=patients.findIndex(item=>item.id===patientId);
    const restored={...state.patient,mist:{...(state.patient.mist as object)}} as unknown as (typeof patients)[number];
    if(index>=0)patients[index]=restored;else patients.push(restored);}
  const current=getAssignmentState();restoreAssignmentState({
    assignments:[...current.assignments.filter(item=>item.patientId!==patientId),...(state.assignments as unknown as typeof current.assignments)],
    transfers:[...current.transfers.filter(item=>item.patientId!==patientId),...(state.transfers as unknown as typeof current.transfers)],
  });
  replacePatientItems(clinicalDataProvider.getQuestions(),patientId,state.questions);
  replacePatientItems(clinicalDataProvider.getLabs(),patientId,state.labs);
  replacePatientItems(clinicalDataProvider.getImagingStudies(),patientId,state.imagingStudies);
  replacePatientItems(clinicalDataProvider.getOrders(),patientId,state.orders);
  replacePatientItems(clinicalDataProvider.getNotes(),patientId,state.notes);
  replacePatientItems(clinicalDataProvider.getTimelineEvents(),patientId,state.timelineEvents);
  replacePatientItems(clinicalDataProvider.getInterventions(),patientId,state.interventions);
  replacePatientItems(clinicalDataProvider.getMedicationAdministrations(),patientId,state.medicationAdministrations);
  replacePatientItems(clinicalDataProvider.getVitalSigns(),patientId,state.vitalSigns);
}

export function restoreAuthoritativePatientSharedWorkflowState(input: Readonly<{
  exerciseId: string;
  patientId: string;
  revision: number;
  ownerUserId?: string;
  state: PatientSharedWorkflowState;
  /** Only the client whose mutation was accepted may advance Runtime-owned
   * fields directly. Remote/head hydration must reconcile against the
   * checkpoint-restored canonical collections instead. */
  allowRuntimeAdvance?: boolean;
  preserveCanonicalRuntime?: boolean;
}>): boolean {
  return reconcileAuthoritativePatientSharedWorkflowState(input).accepted;
}

const protectedCollectionKeys = ["questions", "labs", "imagingStudies", "orders", "notes", "timelineEvents",
  "interventions", "medicationAdministrations", "vitalSigns"] as const;

function stableItemIds(items: unknown): Set<string> {
  if (!Array.isArray(items)) return new Set();
  return new Set(items.flatMap(item => item && typeof item === "object" &&
    typeof (item as Readonly<Record<string, unknown>>).id === "string"
    ? [String((item as Readonly<Record<string, unknown>>).id)] : []));
}

/**
 * Runtime checkpoint collections are canonical. A shared-workflow row may
 * contribute ownership, and a newer non-conflicting row may add workflow
 * content, but it may never remove checkpoint-restored identities or regress
 * patient location/status. This is deliberately field-scoped rather than a
 * broad object replacement selected by revision equality.
 */
export function reconcileAuthoritativePatientSharedWorkflowState(input: Readonly<{
  exerciseId: string;
  patientId: string;
  revision: number;
  ownerUserId?: string;
  state: PatientSharedWorkflowState;
  allowRuntimeAdvance?: boolean;
  preserveCanonicalRuntime?: boolean;
}>): PatientSharedWorkflowCanonicalReconciliation {
  const ownershipAccepted = restoreAuthoritativePatientOwnershipProjection({
    exerciseId: input.exerciseId,
    patientId: input.patientId,
    revision: input.revision,
    ownerUserId: input.ownerUserId,
    assignments: input.state.assignments,
    transfers: input.state.transfers,
  });
  if (!ownershipAccepted) return Object.freeze({ accepted: false, mode: "REJECTED", conflicts: Object.freeze([]) });
  if (input.allowRuntimeAdvance || !input.preserveCanonicalRuntime) {
    restorePatientSharedWorkflowState(input.patientId, input.state);
    return Object.freeze({ accepted: true, mode: "FULL_SHARED_WORKFLOW", conflicts: Object.freeze([]) });
  }
  const canonical = capturePatientSharedWorkflowState(input.patientId);
  const conflicts: string[] = [];
  if (canonical.patient && input.state.patient) {
    for (const field of ["location", "status"] as const) {
      if (canonical.patient[field] !== input.state.patient[field]) conflicts.push(`patient.${field}`);
    }
  }
  for (const key of protectedCollectionKeys) {
    const candidateIds = stableItemIds(input.state[key]);
    if ([...stableItemIds(canonical[key])].some(id => !candidateIds.has(id))) conflicts.push(key);
  }
  // Once a canonical checkpoint has been restored, a remote workflow head is
  // never a Runtime-content authority. Equal IDs do not prove equal item
  // payloads, so even an apparently non-conflicting head contributes only its
  // ownership/assignment projection. Runtime advancement is reserved for the
  // accepted local mutation path above.
  return Object.freeze({ accepted: true, mode: "OWNERSHIP_ONLY", conflicts: Object.freeze([...conflicts]) });
}
