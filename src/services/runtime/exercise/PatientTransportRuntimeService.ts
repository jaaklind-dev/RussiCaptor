import type { PatientTransportRuntimeState, TransportCommandResult } from "@/models/PatientTransport";
import { dataProvider } from "@/providers/ProviderFactory";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";
import { notifySync } from "@/services/SyncService";
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
export function startPatientTransport(commandId:string,patientId:string,resourceId:string,destinationId:string):TransportCommandResult { if(!active)return{status:"REJECTED",reason:"INVALID_CONFIGURATION"}; const result=active.engine.start(commandId,patientId,resourceId,destinationId,getCanonicalExerciseSnapshot().simulationTimeSec); project(); if(result.status==="STARTED")notifySync("local"); return result; }
export function capturePatientTransportRuntime():PatientTransportRuntimeState|undefined{return active?.engine.snapshot();}
export function createPatientTransportCommandId(patientId:string){return `TRANSPORT:${getCanonicalExerciseSnapshot().exerciseId}:${patientId}:${++commandSequence}`;}
export function subscribeToPatientTransport(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function getPatientTransportVersion(){return version;}
export function getPatientTransportSnapshot(){return active?.engine.snapshot();}
export function clearPatientTransportRuntime(){active?.dispose();active=undefined;changed();}
