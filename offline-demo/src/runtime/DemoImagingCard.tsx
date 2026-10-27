import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ImagingAssetReference } from '../../../src/models/ImagingAsset';
import type { DemoSession } from './DemoSession';
import { demoImagingDefinition, validateDemoImagingAsset } from './DemoImaging';
import { formatDemoDuration } from './DemoTime';

// Literal bundled sources only. No URL, caller-supplied path, canonical registry or network fallback.
const sources: Readonly<Record<string, number>> = Object.freeze({
  'offline-demo.pelvis.generated.v1': require('../../assets/imaging/pelvis-generated.jpg'),
  'offline-demo.chest.heilman.v1': require('../../assets/imaging/chest-pneumothorax.png'),
});
export function resolveDemoImage(asset: ImagingAssetReference): number | undefined {
  try { validateDemoImagingAsset(asset); return sources[asset.assetId]; } catch { return undefined; }
}
const statusLabels={ORDERED:'Tellitud',PROCESSING:'Töötlemisel',RESULTED:'Tulemus olemas'};
function LocalImage({asset}:{asset:ImagingAssetReference}) {
  const source=resolveDemoImage(asset),[failed,setFailed]=useState(false),[open,setOpen]=useState(false);
  if(source===undefined||failed)return <Text accessibilityRole="alert">DEMO pilti ei saanud kuvada. Uuringu tulemust ei muudeta; võrgu kaudu pilti ei otsita.</Text>;
  return <>
    <Image testID="demo-imaging-preview" accessibilityLabel="DEMO uuringu kohalik pilt" source={source}
      resizeMode="contain" style={styles.image} onError={()=>{setFailed(true);setOpen(false);}} />
    <Pressable accessibilityRole="button" accessibilityLabel="Ava DEMO pilt" style={styles.button} onPress={()=>setOpen(true)}><Text style={styles.buttonText}>Ava pilt</Text></Pressable>
    <Modal visible={open} onRequestClose={()=>setOpen(false)} animationType="none">
      <View style={styles.viewer}><Text style={styles.heading}>DEMO · sünteetilise õppuse pildimaterjal</Text>
        <Image testID="demo-imaging-viewer" source={source} resizeMode="contain" style={styles.largeImage} onError={()=>{setFailed(true);setOpen(false);}} />
        <Pressable accessibilityRole="button" accessibilityLabel="Sulge DEMO pilt" style={styles.button} onPress={()=>setOpen(false)}><Text style={styles.buttonText}>Sulge pilt</Text></Pressable>
      </View>
    </Modal>
  </>;
}
export default function DemoImagingCard({session,patientId,onOrder,disabled}:Readonly<{
  session:DemoSession;patientId:string;onOrder:()=>void;disabled:boolean;
}>) {
  const d=demoImagingDefinition(patientId),instance=session.imaging.instances.find(i=>i.patientId===patientId&&i.definitionId===d.examinationId);
  const title=patientId==='DEMO-PT-A'?'Vaagna röntgen':'Rindkere röntgen';
  return <View style={styles.card} testID={`demo-imaging-${patientId}`}>
    <Text style={styles.heading}>Pildiuuring · {title} · DEMO</Text>
    <Text>{patientId=== 'DEMO-PT-A'?'Sünteetiline patsient A':'Sünteetiline patsient B'}</Text>
    <Text accessibilityLabel="DEMO pildiuuringu olek">{instance?statusLabels[instance.status]:'Tellimata'}</Text>
    <Text>Viivitus 30 simulatsioonisekundit; ei ole kliiniline uuringuaeg.</Text>
    {session.mode==='CM'&&<Pressable accessibilityRole="button" accessibilityLabel={`Telli DEMO ${title}`}
      testID={`demo-imaging-order-${patientId}`} disabled={disabled||!!instance} onPress={onOrder}
      style={[styles.button,(disabled||!!instance)&&styles.disabled]}><Text style={styles.buttonText}>Telli {title}</Text></Pressable>}
    {!instance&&disabled&&session.mode==='CM'&&<Text>Tellimiseks käivita simulatsioon ja vali patsient. Uuringu jaoks peab jääma vähemalt 30 simulatsioonisekundit.</Text>}
    {instance&&<>
      <Text>Tellimus {instance.orderCommandId} · T+{formatDemoDuration(instance.orderedAtSimulationTimeSec)}</Text>
      <Text>Valmimise tähtaeg T+{formatDemoDuration(instance.availableAtSimulationTimeSec)}</Text>
      <Text>Kordustellimine pole selles demoetapis saadaval.</Text>
      {instance.result&&<>
        <Text>Tulemus {instance.result.resultId} · T+{formatDemoDuration(instance.result.releasedAtSimulationTimeSec)}</Text>
        <Text>{instance.result.reportText}</Text><Text>{d.clinicalBoundary}</Text>
        {instance.result.asset?<LocalImage key={`${session.sessionId}:${session.generation}:${instance.result.resultId}`} asset={instance.result.asset}/>
          :<Text accessibilityRole="alert">DEMO tulemuse pilt puudub. Võrgu kaudu pilti ei otsita.</Text>}
      </>}
    </>}
    <Text>{d.attribution}</Text><Text>Allikas: {d.source}</Text><Text>Litsents / staatus: {d.license}{d.licenseUrl?` · ${d.licenseUrl}`:''}</Text>
    <Text>{d.modification}</Text>
  </View>;
}
const styles=StyleSheet.create({card:{padding:12,gap:10,backgroundColor:'#f1f5f9',borderRadius:12},heading:{fontSize:18,fontWeight:'700'},
  button:{padding:14,minHeight:48,backgroundColor:'#573800',borderRadius:8},buttonText:{color:'#fff',fontWeight:'700'},disabled:{opacity:0.4},
  image:{width:'100%',height:300,backgroundColor:'#000'},viewer:{flex:1,padding:24,paddingTop:48,gap:16,backgroundColor:'#ffd166'},largeImage:{flex:1,width:'100%',backgroundColor:'#000'}});
