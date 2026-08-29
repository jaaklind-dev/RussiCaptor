import { dataProvider, clinicalDataProvider } from "@/providers/ProviderFactory";
import { getAssignmentState, restoreAssignmentState } from "@/services/AssignmentRepository";

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
