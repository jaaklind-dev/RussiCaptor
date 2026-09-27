import type { PatientTransportRuntimeState, TransportCommandResult } from "@/models/PatientTransport";
import { dataProvider } from "@/providers/ProviderFactory";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";
import { notifySync } from "@/services/SyncService";
import { runtimePatientCommandSubmissionReadiness, submitPatientRuntimeCommand, waitForPatientRuntimeCommandResult } from "@/services/runtime/commands/RuntimePatientCommandService";
import { registerExerciseClockTarget } from "./ExerciseClockTargetRegistry";

let active: { exerciseId: string; engine: PatientTransportEngine; dispose: () => void; emitted: number } | undefined;
let version=0; let commandSequence=0; const listeners=new Set<()=>void>();
const changed=()=>{version+=1;listeners.forEach(listener=>listener());};
function project() {
  if (!active) return; const snapshot=active.engine.snapshot();
  Object.entries(snapshot.patientLocations).forEach(([patientId, location]) => dataProvider.setPatientLocation(patientId, location));
  for (const event of snapshot.evidence.slice(active.emitted)) addTimelineEvent({ id:`TL-${event.transportId}-${event.sequence}`,exerciseId:active.exerciseId,patientId:event.patientId,timestamp:`T+${event.simulationTimeSec}s`,simulationTimeSec:event.simulationTimeSec,type:"transfer",title:event.type,description:`${event.resourceId}${event.destinationId ? ` → ${event.destinationId}` : ""}`,author:"Transport Runtime",visibility:"revealed" });
  active.emitted=snapshot.evidence.length;
  changed();
}
export function preparePatientTransportRuntime(exerciseId: string, restored?: PatientTransportRuntimeState) {
  const config=getExercisePackage(exerciseId).transportConfiguration; clearPatientTransportRuntime(); if (!config) return;
  const locations=Object.fromEntries(dataProvider.getPatients().map(patient=>[patient.id,patient.location])); const engine=new PatientTransportEngine(config,locations,restored);
  const dispose=registerExerciseClockTarget({targetId:"TRANSPORT",advance:(_from,to)=>{engine.advanceTo(to);project();}}); active={exerciseId,engine,dispose,emitted:restored?.evidence.length??0}; project();
}
/** Writer-only materialization entry point. Client controls must use submitPatientTransport. */
export function materializePatientTransport(commandId:string,patientId:string,resourceId:string,destinationId:string,
  acceptedSimulationTimeSec:number):TransportCommandResult { if(!active)return{status:"REJECTED",reason:"INVALID_CONFIGURATION"}; const result=active.engine.start(commandId,patientId,resourceId,destinationId,acceptedSimulationTimeSec); project(); if(result.status==="STARTED")notifySync("local"); return result; }
export type PatientTransportSubmissionResult = Readonly<{
  status: "PENDING" | "STARTED" | "IDEMPOTENT" | "REJECTED";
  commandId: string;
  reason?: string;
}>;
/**
 * Submits transport through the same durable patient-command authority used by
 * other non-writer CM actions. The active writer alone materializes the command
 * into the canonical transport engine and checkpoint.
 */
export async function submitPatientTransport(commandId:string,patientId:string,resourceId:string,destinationId:string):Promise<PatientTransportSubmissionResult> {
  const exercise=getCanonicalExerciseSnapshot();
  const readiness=runtimePatientCommandSubmissionReadiness(exercise.exerciseId,exercise.simulationTimeSec);
  if (!readiness.ready) return Object.freeze({ status:"REJECTED",commandId,
    reason:readiness.reason??"COMMAND_NOT_READY" });
  const result=await submitPatientRuntimeCommand({ exerciseId:exercise.exerciseId,patientId,commandId,
    commandType:"TRANSPORT_START",simulationTimeSec:exercise.simulationTimeSec,
    payload:Object.freeze({resourceId,destinationId}) });
  if (result.status === "APPLIED" || result.status === "IDEMPOTENT") {
    if (result.commandSequence !== undefined) {
      const materialized=await waitForPatientRuntimeCommandResult(exercise.exerciseId,result.commandSequence);
      if (materialized?.status === "REJECTED") {
        const reason=typeof materialized.result.reason === "string" ? materialized.result.reason : "RUNTIME_MATERIALIZATION_FAILURE";
        return Object.freeze({ status:"REJECTED",commandId,reason });
      }
    }
    return Object.freeze({ status:"PENDING",commandId });
  }
  return Object.freeze({ status:"REJECTED",commandId,reason:result.status });
}
export function capturePatientTransportRuntime():PatientTransportRuntimeState|undefined{return active?.engine.snapshot();}
export function createPatientTransportCommandId(patientId:string){return `TRANSPORT:${getCanonicalExerciseSnapshot().exerciseId}:${patientId}:${++commandSequence}`;}
export function subscribeToPatientTransport(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function getPatientTransportVersion(){return version;}
export function getPatientTransportSnapshot(){return active?.engine.snapshot();}
export function reconcilePatientTransportLocation(patientId:string,locationId:string):boolean {
  if (!active) return true;
  const reconciled=active.engine.reconcilePatientLocation(patientId,locationId);
  if (reconciled) project();
  return reconciled;
}
export function clearPatientTransportRuntime(){active?.dispose();active=undefined;changed();}
