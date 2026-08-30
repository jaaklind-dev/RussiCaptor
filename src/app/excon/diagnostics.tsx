import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { refreshRemoteCurrentExercise, subscribeToCloudSyncStatus } from "@/services/CloudSyncService";
import { reacquireRuntimeFromRemoteCheckpoint, subscribeToRuntimeCheckpointSync, takeOverRuntimeWriter } from "@/services/RuntimeCheckpointSyncService";
import { subscribeOperatorSession } from "@/services/authorization/OperatorSessionService";
import { captureOperationalDiagnosticSnapshot, exportOperationalDiagnostics, type OperationalSeverity } from "@/services/operations/LiveOperationsDiagnostics";
import { subscribeToSharedWorkflowConflicts } from "@/services/sharedWorkflow/SharedWorkflowMutationService";

const severityLabel: Readonly<Record<OperationalSeverity,string>> = {INFO:"INFO",DEGRADED:"HÄIRITUD",ACTION_REQUIRED:"VAJAB TEGEVUST",EXERCISE_BLOCKING:"ÕPPUST BLOKEERIV"};

export default function LiveOperationsDiagnosticsScreen() {
  const [snapshot,setSnapshot]=useState(captureOperationalDiagnosticSnapshot);
  const [pending,setPending]=useState<string>();
  const refresh=()=>setSnapshot(captureOperationalDiagnosticSnapshot());
  useEffect(()=>{
    const stops=[subscribeToCloudSyncStatus(refresh),subscribeToRuntimeCheckpointSync(refresh),subscribeOperatorSession(refresh),subscribeToSharedWorkflowConflicts(refresh)];
    return()=>stops.forEach(stop=>stop());
  },[]);
  const run=async(label:string,operation:()=>Promise<unknown>)=>{if(pending)return;setPending(label);try{await operation();refresh();}catch{Alert.alert("Toiming ebaõnnestus","Autoriteetset seisu ei muudetud. Kontrolli ühendust ja õigusi.");}finally{setPending(undefined);}};
  const canRecover=snapshot.session.recoveryPermission==="ALLOWED";
  return <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.title}>Live-operatsioonide diagnostika</Text>
    <Text style={styles.subtitle}>Patsiendiandmeteta operatsiooniseis ja toetatud recovery-toimingud</Text>
    {snapshot.issues.map(item=><View key={item.code} style={[styles.issue,item.severity==="EXERCISE_BLOCKING"&&styles.blocking]}>
      <Text style={styles.severity}>{severityLabel[item.severity]} · {item.title}</Text><Text style={styles.text}>{item.explanation}</Text><Text style={styles.action}>Järgmine samm: {item.nextAction}</Text>
    </View>)}
    <Section title="Identiteet ja backend" rows={[["Sessioon",snapshot.session.state],["EXCON scope",snapshot.session.exconScope],["Recovery õigus",snapshot.session.recoveryPermission],["Supabase",snapshot.app.supabaseProjectRef??"puudub"],["Realtime",snapshot.sync.realtimeConnected?"ÜHENDATUD":snapshot.sync.state.toUpperCase()]]}/>
    <Section title="Õppus ja Runtime" rows={[["Õppus",snapshot.exercise.exerciseId],["Lifecycle",snapshot.exercise.lifecycle],["Runtime",snapshot.runtime.state],["Kontrollpunkt",`${snapshot.runtime.localCheckpointRevision??"puudub"}`],["Lease / writer",snapshot.runtime.writerInstanceId?`aktiivne · ${snapshot.runtime.writerInstanceId}`:"aktiivne lease puudub"],["Lease aegub",snapshot.runtime.leaseExpiresAt??"–"],["Viimane publication",snapshot.runtime.lastCheckpointPublicationAt??"–"]]}/>
    <Section title="Sünkroniseerimine" rows={[["Projection revision",`${snapshot.sync.authoritativeProjectionRevision??"–"}`],["Workflow revision",`${snapshot.exercise.authoritativeWorkflowRevision}`],["Lokaalne durable cache",snapshot.runtime.durableCache],["Viimane sync",snapshot.sync.syncedAt??"–"],["Ootel mutatsioonid",`${snapshot.sync.pendingMutationCount}`],["Lahendamata konfliktid",`${snapshot.sync.unresolvedConflictCount}`]]}/>
    <Text style={styles.sectionTitle}>Toetatud toimingud</Text>
    <Action label={pending==="refresh"?"Värskendan…":"Värskenda autoriteetne seis"} disabled={Boolean(pending)} onPress={()=>void run("refresh",()=>refreshRemoteCurrentExercise("manual"))}/>
    {snapshot.runtime.state==="READER"&&<Action label={pending==="takeover"?"Võtan üle…":"Võta Runtime üle"} disabled={Boolean(pending)||!canRecover} onPress={()=>void run("takeover",takeOverRuntimeWriter)}/>}
    {snapshot.runtime.state==="CONFLICT"&&<Action label={pending==="recover"?"Taastan…":"Taasta pilve kontrollpunktist"} disabled={Boolean(pending)||!canRecover} onPress={()=>void run("recover",reacquireRuntimeFromRemoteCheckpoint)}/>}
    {snapshot.runtime.durableCache==="MISSING_OR_DIFFERENT_EXERCISE"&&<Text style={styles.warning}>Puuduva kontrollpunktiga RUNNING õppust ei taastata lokaalselt. Kasuta töölaua auditeeritud lõpetamist, kui recovery õigus on olemas.</Text>}
    <Action label="Jaga ohutu diagnostikasnapshot" disabled={Boolean(pending)} onPress={()=>void Share.share({title:"RussiCaptor operatsioonidiagnostika",message:exportOperationalDiagnostics(captureOperationalDiagnosticSnapshot())})}/>
    <Pressable style={styles.back} onPress={()=>router.back()}><Text style={styles.backText}>Tagasi</Text></Pressable>
  </ScrollView>;
}

function Section({title,rows}:{title:string;rows:readonly (readonly [string,string])[]}){return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{rows.map(([label,value])=><View key={label} style={styles.row}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>)}</View>}
function Action({label,disabled,onPress}:{label:string;disabled:boolean;onPress():void}){return <Pressable accessibilityRole="button" disabled={disabled} style={[styles.button,disabled&&styles.disabled]} onPress={onPress}><Text style={styles.buttonText}>{label}</Text></Pressable>}
const styles=StyleSheet.create({container:{padding:20,paddingBottom:48,backgroundColor:"#fff",flexGrow:1},title:{fontSize:28,fontWeight:"800",color:"#172b4d"},subtitle:{color:"#475467",marginTop:4,marginBottom:14},issue:{padding:14,borderRadius:12,backgroundColor:"#fffaeb",borderWidth:1,borderColor:"#fedf89",marginBottom:10},blocking:{backgroundColor:"#fef3f2",borderColor:"#fecdca"},severity:{fontWeight:"800",color:"#7a2e0e"},text:{color:"#344054",marginTop:5},action:{fontWeight:"700",color:"#344054",marginTop:7},section:{marginTop:12,padding:14,borderRadius:12,backgroundColor:"#f2f4f7"},sectionTitle:{fontSize:18,fontWeight:"800",color:"#172b4d",marginBottom:8,marginTop:8},row:{flexDirection:"row",justifyContent:"space-between",gap:12,paddingVertical:5,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#d0d5dd"},label:{color:"#475467",flex:1},value:{color:"#101828",fontWeight:"700",flex:2,textAlign:"right"},button:{minHeight:48,justifyContent:"center",alignItems:"center",backgroundColor:"#175cd3",borderRadius:10,paddingHorizontal:14,marginTop:10},buttonText:{color:"#fff",fontWeight:"800"},disabled:{opacity:.5},warning:{color:"#912018",backgroundColor:"#fef3f2",padding:12,borderRadius:10,marginTop:10},back:{minHeight:48,justifyContent:"center",alignItems:"center",borderWidth:2,borderColor:"#175cd3",borderRadius:10,marginTop:18},backText:{color:"#175cd3",fontWeight:"800"}});
