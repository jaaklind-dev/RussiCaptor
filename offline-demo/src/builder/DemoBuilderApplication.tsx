import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BUILDER_CAPABILITIES as C, LOCATIONS, PRESETS, presetById } from './DemoBuilderCapabilities';
import { editBuilderDraft, newBuilderPatient, withPreset, type DemoBuilderDraft, type DemoBuilderPatient } from './DemoBuilderDraft';
import { DemoBuilderError, type DemoBuilderStore } from './DemoBuilderStore';
import { validateBuilderDraft, type BuilderIssue } from './DemoBuilderValidation';
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Field({ label, value, change, max, numeric = false }: { label: string; value: string; change: (v: string) => void; max: number; numeric?: boolean }) {
  return <View><Text>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} maxLength={max}
    keyboardType={numeric ? 'number-pad' : 'default'} multiline={!numeric} style={styles.input}/></View>;
}
export default function DemoBuilderApplication({ store, onExit }: { store: DemoBuilderStore; onExit: () => void }) {
  const [initial] = useState(() => { try { return { drafts: store.list(), blocked: false }; } catch { return { drafts: [], blocked: true }; } });
  const [drafts, setDrafts] = useState<DemoBuilderDraft[]>(initial.drafts), [draft, setDraft] = useState<DemoBuilderDraft>();
  const [dirty, setDirty] = useState(false), [issues, setIssues] = useState<BuilderIssue[]>([]), [notice, setNotice] = useState(initial.blocked ? 'Mustandite salvestust või vormingut ei saanud kinnitada. Andmed säilivad muutmata.' : '');
  const [blocked, setBlocked] = useState(initial.blocked);
  const lifetime = useRef({ epoch: 0, mounted: true });
  const run = (fn: () => void) => { try { fn(); } catch (error) {
    if (error instanceof DemoBuilderError && error.issues.length) setIssues(error.issues);
    setNotice(error instanceof DemoBuilderError && error.category === 'REVISION_CONFLICT'
      ? 'Revisjonikonflikt: mustand muutus. Ava salvestatud loend uuesti; sinu muudatusi ei kirjutatud üle.'
      : 'Toimingut ei kinnitatud. Algandmeid ei kustutata. Kontrolli mustandit või proovi loendit uuesti.');
  } };
  const reload = () => { const next = store.list(); setDrafts(next); setBlocked(false); };
  useEffect(() => {
    const state = lifetime.current;
    state.mounted = true;
    return () => { state.mounted = false; state.epoch++; };
  }, []);
  const guarded = (operation: () => void) => {
    const binding = lifetime.current.epoch;
    return () => { if (lifetime.current.mounted && binding === lifetime.current.epoch) { lifetime.current.epoch++; run(operation); } };
  };
  const leave = () => {
    const action = guarded(() => { setDraft(undefined); setDirty(false); setIssues([]); reload(); });
    if (draft && dirty) Alert.alert('Salvestamata muudatused', 'Kas lahkud mustandit salvestamata?', [{ text: 'Jää siia', style: 'cancel' }, { text: 'Lahku', onPress: action }]);
    else if (draft) action(); else onExit();
  };
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true; }); return () => listener.remove(); });
  const update = (next: DemoBuilderDraft) => { lifetime.current.epoch++; setDraft(next); setDirty(true); setNotice('Salvestamata muudatused'); setIssues([]); };
  const patientChange = (index: number, value: DemoBuilderPatient) => {
    if (draft) update(editBuilderDraft(draft, { patients: draft.patients.map((p, i) => i === index ? value : p) }));
  };
  const save = () => { if (!draft) return; run(() => {
    const valid = validateBuilderDraft(draft).length === 0;
    const saved = store.save(draft, draft.revision, valid); lifetime.current.epoch++; setDraft(saved); setDirty(false); reload(); setNotice('Mustand salvestatud selles demos.');
  }); };
  const remove = () => { if (!draft) return; const captured = draft;
    Alert.alert('Kustuta DEMO mustand?', 'Kustutatakse ainult see kohalik mustand. Aktiivset simulatsiooni ei muudeta.', [
      { text: 'Loobu', style: 'cancel' }, { text: 'Kustuta', style: 'destructive', onPress: guarded(() => { store.delete(captured.draftId, captured.revision); setDraft(undefined); setDirty(false); reload(); setNotice('Mustand kustutatud.'); }) },
    ]);
  };
  return <View style={styles.root}><View style={styles.banner}><Text style={styles.title}>DEMO · Kohalik Builder</Text>
    <Text>Ainult sünteetiline autoritöö. Võrguühendust ega tootmise õigusi ei kasutata.</Text></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="alert">{notice}</Text>
      <Text>Mustandist simulatsiooni käivitamine ei ole veel saadaval. Praegune demoõppus jääb eraldi.</Text>
      {!draft ? <>
        <Text style={styles.title}>Mustandid ({drafts.length}/{C.maxDrafts})</Text>
        <Action label="Värskenda mustandiloendit" onPress={() => run(reload)}/>
        <Action label="Loo DEMO mustand" disabled={blocked || drafts.length >= C.maxDrafts} onPress={() => run(() => { lifetime.current.epoch++; setDraft(store.create()); setDirty(false); setNotice('Tühi mustand salvestatud. Lisa nimi ja patsient.'); reload(); })}/>
        {drafts.map(d => <Action key={d.draftId} label={`Ava ${d.name || 'nimetu mustand'} · revisjon ${d.revision}`} onPress={() => { lifetime.current.epoch++; setDraft(structuredClone(d)); setDirty(false); setIssues([]); setNotice('Salvestatud mustand'); }}/>) }
      </> : <>
        <Text>Muudetav mustand · {draft.draftId}</Text><Text>Revisjon {draft.revision} · {dirty ? 'Salvestamata muudatused' : 'Salvestatud'}</Text>
        <Text>Viimati muudetud: {draft.modifiedAt}</Text>
        <Field label="Õppuse nimi" value={draft.name} max={C.maxName} change={name => update(editBuilderDraft(draft, { name }))}/>
        <Field label="Õppuse kirjeldus" value={draft.description} max={C.maxDescription} change={description => update(editBuilderDraft(draft, { description }))}/>
        <Text>Vanus ja sugu on metainfo; nende muutmine ei muuda automaatselt füsioloogiat. MVP on täiskasvanute sünteetiline õppematerjal, mitte kliiniliselt valideeritud sisu.</Text>
        {draft.patients.map((p, i) => <View key={p.patientId} style={styles.card}>
          <Text style={styles.title}>Patsient {i + 1}</Text><Text>{p.patientId}</Text>
          <Field label={`Patsiendi ${i + 1} nimi`} value={p.displayName} max={C.maxPatientName} change={displayName => patientChange(i, { ...p, displayName })}/>
          <Field label={`Patsiendi ${i + 1} vanus`} value={Number.isNaN(p.age) ? '' : String(p.age)} max={3} numeric change={v => patientChange(i, { ...p, age: v.trim() ? Number(v) : NaN })}/>
          <Text>Sugu</Text>{(['F','M','OTHER','UNKNOWN'] as const).map(sex => <Action key={sex} label={`${i + 1}: sugu ${sex}${p.sex === sex ? ' · valitud' : ''}`} onPress={() => patientChange(i, { ...p, sex })}/>)}
          <Text>Triaaž</Text>{(['P1','P2','P3','P4'] as const).map(triage => <Action key={triage} label={`${i + 1}: ${triage}${p.triage === triage ? ' · valitud' : ''}`} onPress={() => patientChange(i, { ...p, triage })}/>)}
          <Text>Algasukoht</Text>{LOCATIONS.map(initialLocation => <Action key={initialLocation} label={`${i + 1}: ${initialLocation === 'DEMO_ED' ? 'DEMO vastuvõtt' : 'DEMO sündmuskoht'}${p.initialLocation === initialLocation ? ' · valitud' : ''}`} onPress={() => patientChange(i, { ...p, initialLocation })}/>)}
          <Text>Kliiniline mall</Text>{PRESETS.map(preset => <Action key={preset.id} label={`${i + 1}: ${preset.label}${p.clinicalPresetId === preset.id ? ' · valitud' : ''}`} onPress={() => patientChange(i, withPreset(p, preset.id))}/>)}
          <Text>{presetById(p.clinicalPresetId)?.summary}</Text>
          <Text>Labor: Hb, Hct, laktaat, pH, K, Na, glükoos · 30 simulatsioonisekundit · proovivõtuhetke mudel. Ainult lugemiseks.</Text>
          <Text>Pilt: {p.imaging[0]?.examinationId} · 30 simulatsioonisekundit · sünteetiline õppesisu. Ainult lugemiseks.</Text>
          <Text>{presetById(p.clinicalPresetId)?.asset.attribution}</Text>
          <Text>Raport: {p.imaging[0]?.reportId} · vara: {p.imaging[0]?.assetId}</Text>
          <Action label={`Eemalda patsient ${i + 1}`} onPress={() => Alert.alert('Eemalda patsient?', 'Patsient eemaldatakse ainult muudetavast mustandist.', [{ text: 'Loobu', style: 'cancel' }, { text: 'Eemalda', onPress: guarded(() => update(editBuilderDraft(draft, { patients: draft.patients.filter(x => x.patientId !== p.patientId) }))) }])}/>
        </View>)}
        <Action label="Lisa sünteetiline patsient" disabled={draft.patients.length >= C.maxPatients} onPress={() => {
          const preset = PRESETS.find(p => !draft.patients.some(patient => patient.clinicalPresetId === p.id));
          if (preset) update(editBuilderDraft(draft, { patients: [...draft.patients, newBuilderPatient(undefined, preset.id)] }));
        }}/>
        <Action label="Kontrolli mustandit" onPress={() => { const next = validateBuilderDraft(draft); setIssues(next); setNotice(next.length ? 'Mustand vajab parandusi.' : 'Mustand on MVP reeglite järgi korrektne. See ei käivita simulatsiooni ega kinnita kliinilist valideerimist.'); }}/>
        {issues.map((issue, i) => <Text accessibilityRole="alert" key={`${issue.path}-${i}`}>{issue.category} · {issue.path}: {issue.message}</Text>)}
        <Action label="Salvesta DEMO mustand" onPress={save}/><Action label="Kustuta DEMO mustand" onPress={remove}/>
      </>}
      <Action label={draft ? 'Tagasi mustandiloendisse' : 'Tagasi demosse'} onPress={leave}/>
    </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' }, banner: { padding: 20, paddingTop: 48, gap: 8, backgroundColor: '#ffd166' },
  content: { padding: 22, gap: 16, paddingBottom: 64 }, title: { fontSize: 22, fontWeight: '700' },
  card: { padding: 16, gap: 12, borderWidth: 1, borderColor: '#9a6700', borderRadius: 12 },
  input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#666', borderRadius: 8 },
  button: { minHeight: 48, padding: 16, borderRadius: 8, backgroundColor: '#573800' }, buttonText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.4 } });
