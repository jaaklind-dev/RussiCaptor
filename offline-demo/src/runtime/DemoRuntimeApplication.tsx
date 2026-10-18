import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, AppState, BackHandler, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import DemoVitalsCard from './DemoVitalsCard';
import DemoLaboratoryCard from './DemoLaboratoryCard';
import DemoImagingCard from './DemoImagingCard';
import { DEMO_IMAGING_DELAY_SEC, demoImagingCommandId, demoImagingDefinition } from './DemoImaging';
import { DEMO_LAB_DELAY_SEC, DEMO_LAB_PANEL } from './DemoLaboratory';
import { formatDemoDuration } from './DemoTime';
import { DEMO_PATIENTS, DEMO_MAX_SECONDS } from './DemoDomain';
import { DemoController } from './DemoController';
import { DemoSessionStore, type DemoEvent, type DemoSession } from './DemoSession';
const eventLabels: Record<DemoEvent['kind'], string> = { START: 'Demoõppus käivitatud', PAUSE: 'Simulatsioon peatatud',
  RESUME: 'Simulatsioon jätkatud', BACKGROUND: 'Taustale minekul peatatud', RECOVERY: 'Sessioon taastatud peatatud olekus',
  BINDER_APPLIED: 'Vaagnalahas paigaldatud patsiendile A', LAB_ORDERED: 'DEMO laboritellimus ja proov kinnitatud',
  LAB_RESULTED: 'DEMO laboritulemus valmis', IMAGING_ORDERED: 'DEMO pildiuuring tellitud',
  IMAGING_RESULTED: 'DEMO pildiuuringu tulemus valmis', LIMIT: '15 minuti demopiir saavutatud; taasta algseis' };
const lifecycleLabels = { READY: 'Valmis', RUNNING: 'Käib', PAUSED: 'Peatatud' };
function Button({ label, onPress, disabled = false }: Readonly<{ label: string; onPress: () => void; disabled?: boolean }>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
export default function DemoRuntimeApplication({ store, onExit }: Readonly<{ store: DemoSessionStore; onExit: () => void }>) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [controller, setController] = useState<DemoController>();
  const [message, setMessage] = useState('');
  useEffect(() => {
    const runtime = new DemoController(store, undefined, AppState.currentState === 'active');
    let mounted = true;
    // Publish the resource after effect setup; cleanup fences this callback during unmount/remount.
    void Promise.resolve().then(() => { if (mounted) setController(runtime); });
    const listener = AppState.addEventListener('change', state => runtime.setForeground(state === 'active'));
    return () => { mounted = false; listener.remove(); runtime.dispose(); };
  }, [store]);
  const perform = (operation: () => unknown) => { try { operation(); setMessage(''); } catch { setMessage('Toimingut ei tehtud. Kontrolli demo olekut või taasta algseis.'); } };
  const exit = () => {
    const latest = store.getSnapshot();
    if (view.status === 'READY' && latest.status === 'READY' && (view.session.sessionId !== latest.session.sessionId || view.session.generation !== latest.session.generation)) return;
    controller?.setForeground(false); onExit();
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      const latest = store.getSnapshot();
      if (view.status === 'READY' && latest.status === 'READY' && (view.session.sessionId !== latest.session.sessionId || view.session.generation !== latest.session.generation)) return true;
      if (latest.status === 'READY' && latest.session.mode !== 'home') perform(() => controller?.navigate('home', undefined, latest.session)); else exit();
      return true;
    }); return () => listener.remove();
  });
  const session = view.status === 'READY' ? view.session : undefined;
  const navigate = (mode: DemoSession['mode'], patientId?: DemoSession['selectedPatient']) => {
    if (session) return controller?.navigate(mode, patientId, session);
  };
  const control = (kind: 'START' | 'PAUSE' | 'RESUME') => session && controller?.control(kind, session);
  const reset = () => {
    const sessionId = session?.sessionId; const generation = session?.generation;
    Alert.alert('Taasta demo algseis?', 'Demo aeg, kohalik toiming ja sündmused lähtestatakse. Tavarakendust ega teisi mustandeid ei muudeta.',
      [{ text: 'Loobu', style: 'cancel' }, { text: 'Taasta', onPress: () => perform(() => controller?.reset(sessionId, generation)) }]);
  };
  const binder = () => {
    if (!session || !controller) return;
    const latest = store.getSnapshot();
    if (latest.status !== 'READY' || latest.session.sessionId !== session.sessionId || latest.session.generation !== session.generation ||
        latest.session.commands.some(c => c.type === 'APPLY_PELVIC_BINDER')) return;
    // One deterministic semantic action identity per session; rapid presses and stale handlers reuse it.
    perform(() => controller.binder({ id: `DEMO-CMD-${session.sessionId}:binder`, sessionId: session.sessionId,
      generation: session.generation, time: latest.session.time, patientId: 'DEMO-PT-A', type: 'APPLY_PELVIC_BINDER' }));
  };
  const laboratoryOrder = (patientId: DemoSession['selectedPatient']) => {
    if (!session || !controller) return;
    const latest = store.getSnapshot();
    if (latest.status !== 'READY' || latest.session.sessionId !== session.sessionId || latest.session.generation !== session.generation ||
        latest.session.mode !== 'CM' || latest.session.selectedPatient !== patientId || latest.session.laboratory.orders.some(o => o.patientId === patientId)) return;
    perform(() => controller.dispatch({ id: `DEMO-CMD-${session.sessionId}:lab:${patientId}`, sessionId: session.sessionId,
      generation: session.generation, time: latest.session.time, patientId, type: 'LAB_ORDER', panelId: DEMO_LAB_PANEL }));
  };
  const acceptanceExport = () => {
    if (!session) return;
    const binding = { sessionId: session.sessionId, generation: session.generation };
    Alert.alert('Ekspordi DEMO vastuvõtutõend?',
      'Ainult kohalik seansi ID, põlvkond, aeg, käsu ID ja arv, töötlemise kinnitus ning reset’i üleminek. Patsiendiandmeid ega kogu salvestust ei ekspordita. Jagamiskoha valid ise.',
      [{ text: 'Loobu', style: 'cancel' }, { text: 'Ekspordi', onPress: () => {
        try {
          const report = store.acceptanceReport(binding);
          const message = JSON.stringify(report, null, 2);
          Alert.alert('DEMO vastuvõtutõend · salvestatud rida', message,
            [{ text: 'Sulge', style: 'cancel' }, { text: 'Jaga tõendit', onPress: () => {
              void Share.share({ title: 'RussiCaptor DEMO vastuvõtutõend', message })
                .catch(() => setMessage('Demo vastuvõtutõendi jagamine ei õnnestunud.'));
            } }]);
        } catch { setMessage('Salvestatud demo vastuvõtutõendit ei saanud kinnitada. Tõendit ei eksporditud.'); }
      } }]);
  };
  const imagingOrder = (patientId: DemoSession['selectedPatient']) => {
    if(!session||!controller)return;
    const latest=store.getSnapshot();
    if(latest.status!=='READY'||latest.session.sessionId!==session.sessionId||latest.session.generation!==session.generation||
      latest.session.mode!=='CM'||latest.session.selectedPatient!==patientId||latest.session.imaging.instances.some(i=>i.patientId===patientId))return;
    const d=demoImagingDefinition(patientId);
    perform(()=>controller.dispatch({id:demoImagingCommandId(session.sessionId,patientId,d.examinationId),sessionId:session.sessionId,
      generation:session.generation,time:latest.session.time,patientId,type:'IMAGING_ORDER',examinationId:d.examinationId}));
  };
  return <View style={styles.root}>
    <View style={styles.banner}><Text style={styles.bannerTitle} onLongPress={acceptanceExport}
      accessibilityHint="Hoia all, et eksportida piiratud kohalik DEMO vastuvõtutõend">DEMO · AINULT SÜNTEETILISED ANDMED</Text>
      <Text>Võrguühendust ega sisselogimist ei kasutata. Ei ole kliiniliselt valideeritud.</Text>
      {session && <Text accessibilityLabel="Demo kell">{lifecycleLabels[session.lifecycle]} · T+{formatDemoDuration(session.time)} · üks kohalik kell</Text>}
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>RussiCaptor DEMO{session && session.mode !== 'home' ? ` · ${session.mode}` : ''}</Text>
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      {!session ? <><Text accessibilityRole="alert">Demo salvestatud olek ei ole usaldusväärne või salvestus pole saadaval. Proovi taastamist või taasta ainult demo algseis; tootmisse üle ei minda.</Text>
        <Button label="Proovi demo taastamist" onPress={() => perform(() => store.recover())} /></> : <>
        {view.status === 'READY' && view.restored && <Text>Sessioon taastatud. Aega ei kerita seinakella järgi edasi; jätkamine on käsitsi.</Text>}
        <View style={styles.row}>
          <Button label="Avaleht" onPress={() => perform(() => navigate('home'))} />
          <Button label="CM" onPress={() => perform(() => navigate('CM'))} />
          <Button label="EXCON" onPress={() => perform(() => navigate('EXCON'))} />
        </View>
        {session.mode === 'home' ? <>
          <Text>Kaks sünteetilist traumapatsienti, ühine kohalik mootor, vaagnalahas ja kohalik labori põhipaneel. Kohalikud pildiuuringud kasutavad selgelt märgistatud õppematerjali.</Text>
          <Button label="Alusta demoõppust" disabled={!controller || session.lifecycle !== 'READY'} onPress={() => perform(() => { if (control('START')) navigate('CM'); })} />
        </> : <>
          {session.mode === 'EXCON' && <>
            <Text>EXCON näitab sama kohalikku sessiooni. Tootmise writer’it, rolle ega lease’i ei ole.</Text>
            <Text>Kohalik sessioon: {session.sessionId} · {session.fixture}</Text>
            <View style={styles.row}>
              <Button label="Käivita" disabled={!controller || session.lifecycle !== 'READY'} onPress={() => perform(() => control('START'))} />
              <Button label="Peata" disabled={!controller || session.lifecycle !== 'RUNNING'} onPress={() => perform(() => control('PAUSE'))} />
              <Button label="Jätka" disabled={!controller || session.lifecycle !== 'PAUSED' || session.time >= DEMO_MAX_SECONDS} onPress={() => perform(() => control('RESUME'))} />
            </View>
          </>}
          <Text>Valitud patsient: {session.selectedPatient}. Näitajad on simuleeritud, mitte patsiendi mõõtmised.</Text>
          {DEMO_PATIENTS.map(fixture => {
            const patient = session.patients.find(p => p.id === fixture.id)!;
            return <View key={fixture.id} style={styles.card}>
              <Button label={`Vali ${fixture.name}`} onPress={() => perform(() => navigate(session.mode, fixture.id))} />
              <Text style={styles.heading}>{fixture.name} · {fixture.triage}</Text><Text>{fixture.presentation}</Text>
              <Text>Teadvus: GCS {patient.vitals.readings.gcs.current}, {({ ALERT: 'ärkvel', VOICE: 'reageerib häälele', PAIN: 'reageerib valule', UNRESPONSIVE: 'ei reageeri' })[patient.vitals.avpu]}. Veritsus {patient.hemorrhage.clinicalState.bleedingRateMlMin} ml/min.</Text>
              {patient.respiration && <Text>Hingamine: {({ STABLE: 'stabiilne', IMPROVING: 'paraneb', WORSENING: 'halveneb' })[patient.respiration.clinicalState.trend]} · hingamistöö {patient.respiration.clinicalState.workOfBreathing.toFixed(1)}/100 · väsimus {patient.respiration.clinicalState.fatigue.toFixed(1)}/100.</Text>}
              {(session.mode === 'EXCON' || session.selectedPatient === fixture.id) && <>
                <DemoVitalsCard patient={patient} sessionId={session.sessionId} />
                <DemoLaboratoryCard session={session} patientId={fixture.id} onOrder={() => laboratoryOrder(fixture.id)}
                  disabled={!controller || session.lifecycle !== 'RUNNING' || session.time + DEMO_LAB_DELAY_SEC > DEMO_MAX_SECONDS || session.mode !== 'CM' || session.selectedPatient !== fixture.id} />
                <DemoImagingCard session={session} patientId={fixture.id} onOrder={()=>imagingOrder(fixture.id)}
                  disabled={!controller||session.lifecycle!=='RUNNING'||session.time+DEMO_IMAGING_DELAY_SEC>DEMO_MAX_SECONDS||session.mode!=='CM'||session.selectedPatient!==fixture.id}/>
              </>}
              {session.mode === 'CM' && fixture.id === 'DEMO-PT-A' && session.selectedPatient === fixture.id && <>
                <Button label="Paigalda vaagnalahas (DEMO)" disabled={!controller || session.lifecycle !== 'RUNNING' || session.commands.some(c => c.type === 'APPLY_PELVIC_BINDER')} onPress={binder} />
                {session.commands.some(c => c.type === 'APPLY_PELVIC_BINDER') && <Text>Vaagnalahas paigaldatud. Verejooksu mõju arvestatakse olemasoleva mudeli järgmistes sammudes.</Text>}
              </>}
            </View>;
          })}
          <History session={session} />
        </>}
      </>}
      <Button label="Taasta demo algseis" disabled={!controller} onPress={reset} />
      <Button label="Välju demost" onPress={exit} />
      <Text>Taustale minek peatab simulatsiooni ning labori ja pildiuuringute ooteaja. Demoseanss kestab kuni 15 simulatsiooniminutit. Õppematerjal ja sünteetilised raportid ei ole kliiniliselt valideeritud.</Text>
    </ScrollView>
  </View>;
}
function History({ session }: Readonly<{ session: DemoSession }>) {
  return <View style={styles.card}><Text style={styles.heading}>Kohalik sündmuste ajalugu</Text>
    {session.events.length ? session.events.slice(-30).map(event => <Text key={event.id}>T+{formatDemoDuration(event.time)} · {eventLabels[event.kind]}{event.commandId ? ` · ${event.commandId}` : ''}</Text>) : <Text>Sündmusi veel pole.</Text>}
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' }, banner: { backgroundColor: '#ffd166', padding: 18, paddingTop: 48, gap: 5 },
  bannerTitle: { fontWeight: '800', fontSize: 16 }, content: { padding: 20, gap: 16, paddingBottom: 48 }, title: { fontSize: 26, fontWeight: '700' },
  heading: { fontWeight: '700', fontSize: 20 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { borderColor: '#9a6700', borderWidth: 1, borderRadius: 12, padding: 14, gap: 12 },
  button: { minHeight: 48, backgroundColor: '#573800', borderRadius: 8, padding: 14 }, disabled: { opacity: 0.4 }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 } });
