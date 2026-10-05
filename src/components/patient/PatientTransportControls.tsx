import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { createPatientTransportCommandId, getPatientTransportSnapshot, getPatientTransportVersion, submitPatientTransport, subscribeToPatientTransport } from "@/services/runtime/exercise/PatientTransportRuntimeService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { useRuntimePatientCommandSubmissionReadiness } from "@/services/runtime/commands/useRuntimePatientCommandSubmissionReadiness";
import { locationLabel, transportStateLabel } from "@/localization/et";

export function PatientTransportControls({patientId,readOnly=false}:{patientId:string;readOnly?:boolean}) {
  useSyncExternalStore(subscribeToPatientTransport,getPatientTransportVersion,getPatientTransportVersion); const snapshot=getPatientTransportSnapshot(); const [feedback,setFeedback]=useState(""); const [pendingCommandId,setPendingCommandId]=useState<string>();
  const exerciseId=getCanonicalExerciseSnapshot().exerciseId; const commandReadiness=useRuntimePatientCommandSubmissionReadiness(exerciseId);
  const inFlight=useRef(false);
  const current=snapshot?.transports.find(item=>item.patientId===patientId && !["COMPLETED","CANCELLED","FAILED"].includes(item.state));
  if(!snapshot)return null; const resource=snapshot.resources[0];
  const acknowledged=Boolean(pendingCommandId&&snapshot.transports.some(item=>item.commandId===pendingCommandId));
  const pending=Boolean(pendingCommandId&&!acknowledged);
  const request=async(destinationId:string)=>{if(inFlight.current||!commandReadiness.ready)return;inFlight.current=true;const commandId=createPatientTransportCommandId(patientId);setPendingCommandId(commandId);setFeedback("Transport algatamisel…");try{const result=await submitPatientTransport(commandId,patientId,resource.resourceId,destinationId);if(result.status==="REJECTED"){setPendingCommandId(undefined);setFeedback(result.reason==="TRANSPORT_RESOURCE_BUSY"?"Reanimobiil on hõivatud":result.reason==="COMPLETION_FENCED"||result.reason==="EXERCISE_NOT_ACTIVE"?"Õppust lõpetatakse või see on lõppenud.":"Transporti ei saanud alustada");}else if(result.status==="STARTED"||result.status==="IDEMPOTENT"){setPendingCommandId(undefined);setFeedback("Transport algas");}}finally{inFlight.current=false;}};
  const disabled=pending||!commandReadiness.ready;
  const destinationName=current?snapshot.configuration.destinations.find(item=>item.destinationId===current.destinationId)?.displayName:undefined;
  return <View style={styles.card}><Text style={styles.title}>Transport</Text><Text style={styles.text}>Asukoht: {snapshot.patientLocations[patientId] ? locationLabel(snapshot.patientLocations[patientId]) : "–"}</Text><Text style={styles.text}>Reanimobiil: {transportStateLabel(resource.state)}</Text>{current&&<Text style={styles.active}>{destinationName ?? "Sihtkoht"} · {transportStateLabel(current.state)}</Text>}{!readOnly&&!current&&snapshot.configuration.destinations.map(destination=><Pressable key={destination.destinationId} disabled={disabled} style={[styles.button,disabled&&styles.disabled]} onPress={()=>void request(destination.destinationId)}><Text style={styles.buttonText}>{commandReadiness.ready?`Alusta transporti: ${destination.displayName}`:"Patsiendi andmeid sünkroniseeritakse…"}</Text></Pressable>)}{!!feedback&&<Text style={styles.feedback}>{acknowledged?"Transport algas":feedback}</Text>}</View>;
}
const styles=StyleSheet.create({card:{backgroundColor:"#eef4ff",borderColor:"#84adff",borderWidth:1,borderRadius:12,padding:14,marginBottom:14,gap:7},title:{fontSize:18,fontWeight:"700"},text:{color:"#344054"},active:{color:"#175cd3",fontWeight:"700"},button:{backgroundColor:"#175cd3",padding:12,borderRadius:9},disabled:{opacity:0.45},buttonText:{color:"white",fontWeight:"700",textAlign:"center"},feedback:{fontWeight:"600",color:"#344054"}});
