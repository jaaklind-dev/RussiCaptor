import { useEffect, useState, useSyncExternalStore } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DemoStore, SYNTHETIC_PATIENT } from './DemoStore';
export default function DemoApplication({ store, onExit }: Readonly<{ store: DemoStore; onExit: () => void }>) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [failed, setFailed] = useState(false);
  const perform = (operation: () => unknown) => { try { operation(); } catch { setFailed(true); } };
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (failed) { onExit(); return true; }
      if (state.screen === 'patient') { perform(() => store.home(state.generation)); return true; }
      onExit(); return true;
    });
    return () => listener.remove();
  }, [state, store, failed, onExit]);
  return <View style={styles.root}>
    <View accessibilityRole="header" style={styles.banner}><Text style={styles.bannerText}>DEMO · AINULT SÜNTEETILISED ANDMED</Text>
      <Text>Tootmisega ühendust ei ole. Sisselogimist ei kasutata.</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>{state.screen === 'home' ? 'RussiCaptor DEMO' : 'Patsiendi tutvustus'}</Text>
      {failed ? <Text accessibilityRole="alert">Demo kohalik salvestus pole saadaval. Toiminguid ei jätkata.</Text> : <>
        <Text>Offline-demo esimene etapp. Simulatsioon, uuringud ja ravitoimingud pole veel rakendatud.</Text>
        {state.screen === 'home' ? <Pressable accessibilityRole="button" accessibilityLabel="Ava näidispatsient" style={styles.button}
          onPress={() => perform(() => store.openPatient(state.generation))}><Text style={styles.buttonText}>Ava näidispatsient</Text></Pressable> :
          <View style={styles.card}>
            <Text style={styles.title}>{SYNTHETIC_PATIENT.name}</Text><Text>DEMO ID: {SYNTHETIC_PATIENT.id}</Text>
            <Text>Triaaž: {SYNTHETIC_PATIENT.triage} · {SYNTHETIC_PATIENT.location}</Text>
            <Text>{SYNTHETIC_PATIENT.presentation}</Text><Text>Staatilised demonstratsiooninäitajad, mitte patsiendi mõõtmised</Text>
            <Text>Pulss {SYNTHETIC_PATIENT.vitals.heartRate}/min · Vererõhk {SYNTHETIC_PATIENT.vitals.systolic}/{SYNTHETIC_PATIENT.vitals.diastolic} mmHg</Text>
            <Text>Hingamissagedus {SYNTHETIC_PATIENT.vitals.respiratoryRate}/min · SpO₂ {SYNTHETIC_PATIENT.vitals.oxygenSaturation}%</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tagasi demo avalehele" style={styles.button}
              onPress={() => perform(() => store.home(state.generation))}><Text style={styles.buttonText}>Tagasi avalehele</Text></Pressable>
          </View>}
        <Text>Patsiendivaate avamisi selles demosessioonis: {state.visits}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Taasta demo algseis" style={styles.button}
          onPress={() => perform(() => store.reset(state.generation))}><Text style={styles.buttonText}>Taasta demo algseis</Text></Pressable>
      </>}
      <Pressable accessibilityRole="button" accessibilityLabel="Välju demost" style={styles.button} onPress={onExit}><Text style={styles.buttonText}>Välju demost</Text></Pressable>
      <Text>Väljumine sulgeb demo. Tavarakendus ja selle andmed jäävad puutumata.</Text>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' }, banner: { padding: 20, paddingTop: 48, backgroundColor: '#ffd166' },
  bannerText: { fontWeight: '800', fontSize: 16 }, content: { padding: 22, gap: 18, paddingBottom: 48 }, title: { fontSize: 25, fontWeight: '700' },
  card: { padding: 18, borderWidth: 2, borderColor: '#9a6700', borderRadius: 12, gap: 12 }, button: { minHeight: 48, padding: 14, borderRadius: 8, backgroundColor: '#573800' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 } });
