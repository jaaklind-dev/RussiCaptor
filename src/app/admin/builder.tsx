import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { BuilderPatient, BuilderStudy, ExerciseBuilderDraft } from "@/models/builder/ExerciseBuilderDraft";
import { NARVA_LAB_ANALYTES, NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE } from "@/config/NarvaLaboratoryCatalog";
import { newBuilderDraft, serializeBuilderSourceBundle, validateBuilderDraft } from "@/services/builder/ExerciseBuilderService";
import { builderDraftStore, builderDraftKey, requireBuilderAdminUserId } from "@/services/builder/ExerciseBuilderDraftStore";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { hasPlatformAdminAuthority } from "@/services/authorization/OperatorSessionService";
import { beginBuilderPickerReturn, clearBuilderPickerReturn, readBuilderPickerReturn,
  settleBuilderPickerReturn, subscribeBuilderPickerReturn } from "@/services/builder/BuilderPickerReturnService";
import type { BuilderPickerReturn, BuilderSection } from "@/services/builder/BuilderPickerReturnService";

type Section = BuilderSection;
const sections: Section[] = ["Üldandmed", "Patsiendid", "Näitajad", "Labor", "Pildiuuringud", "Ülevaade"];
const staticLabs = NARVA_LAB_ANALYTES.filter(item => item.reportable !== false &&
  ["STATIC_BASELINE", "DEMOGRAPHIC_CONDITIONAL"].includes(item.implementationClass));
const vitalFields = [
  ["hr", "Pulss (lööki/min)"], ["sbp", "Süstoolne rõhk (mmHg)"], ["dbp", "Diastoolne rõhk (mmHg)"],
  ["rr", "Hingamissagedus (min)"], ["spo2", "SpO₂ (%)"], ["temperature", "Temperatuur (°C)"],
  ["gcs", "GCS"], ["etco2", "EtCO₂"], ["crt", "Kapillaarne täitumine (s)"],
] as const;

function Field({ label, value, onChangeText, numeric = false, multiline = false }: Readonly<{
  label: string; value: string; onChangeText: (value: string) => void; numeric?: boolean; multiline?: boolean;
}>) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput
    accessibilityLabel={label} style={[styles.input, multiline && styles.multiline]} value={value}
    onChangeText={onChangeText} keyboardType={numeric ? "decimal-pad" : "default"} multiline={multiline}
    autoCapitalize="sentences" /></View>;
}

function Action({ label, onPress, secondary = false }: Readonly<{ label: string; onPress: () => void; secondary?: boolean }>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.action, secondary && styles.secondary]}
    onPress={onPress}><Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
}

export default function ExerciseBuilderScreen() {
  const operator = useOperatorSession();
  const authorized = hasPlatformAdminAuthority(operator);
  const [draft, setDraft] = useState<ExerciseBuilderDraft>(newBuilderDraft);
  const [, setSavedVersion] = useState(0);
  const [section, setSection] = useState<Section>("Üldandmed");
  const [patientIndex, setPatientIndex] = useState(0);
  const [studyIndex, setStudyIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const appliedPickerState = useRef("");
  const pickerInFlight = useRef(false);
  useEffect(() => {
    if (operator.state !== "AUTHENTICATED" || !authorized) return;
    const userId = operator.principal.userId;
    const restore = (initial = false) => {
      const context = readBuilderPickerReturn(userId);
      if (!context) return;
      if (!initial && context.status === "PENDING") return;
      const identity = `${context.operationId}:${context.status}`;
      if (appliedPickerState.current === identity) return;
      appliedPickerState.current = identity;
      setDraft(context.draft);
      setSection(context.section);
      setPatientIndex(Math.max(0, context.draft.patients.findIndex(item => item.id === context.patientId)));
      setStudyIndex(Math.max(0, context.draft.studies.findIndex(item => item.id === context.studyId)));
      setDirty(context.dirty);
      if (context.status === "PENDING") setNotice("Pildi valimine katkestati. Mustand taastati; vali pilt uuesti.");
      else if (context.notice) setNotice(context.notice);
    };
    restore(true);
    return subscribeBuilderPickerReturn(() => restore());
  }, [authorized, operator]);
  const savedDrafts = authorized && operator.state === "AUTHENTICATED"
    ? builderDraftStore.list(operator.principal.userId) : [];
  const leave = () => {
    const exit = () => { if (operator.state === "AUTHENTICATED") clearBuilderPickerReturn(operator.principal.userId); router.back(); };
    if (!dirty) { exit(); return; }
    Alert.alert("Salvestamata muudatused", "Kas lahkud mustandit salvestamata?", [
      { text: "Jää siia", style: "cancel" }, { text: "Lahku", style: "destructive", onPress: exit },
    ]);
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { leave(); return true; });
    return () => listener.remove();
  });
  const update = (change: Partial<ExerciseBuilderDraft>) => {
    if (operator.state === "AUTHENTICATED" && readBuilderPickerReturn(operator.principal.userId)?.status !== "PENDING") {
      clearBuilderPickerReturn(operator.principal.userId);
    }
    setDraft(value => ({ ...value, ...change })); setDirty(true); setNotice("");
  };
  const updatePatient = (change: Partial<BuilderPatient>) => {
    update({ patients: draft.patients.map((patient, index) => index === patientIndex ? { ...patient, ...change } : patient) });
  };
  const updateStudy = (change: Partial<BuilderStudy>) => {
    update({ studies: draft.studies.map((study, index) => index === studyIndex ? { ...study, ...change } : study) });
  };
  const addPatient = () => {
    const id = `PT-${String(draft.patients.length + 1).padStart(3, "0")}`;
    update({ patients: [...draft.patients, { id, name: "", triage: "P2", location: "ED", handover: "",
      vitals: {}, labs: {} }] }); setPatientIndex(draft.patients.length);
  };
  const addStudy = () => {
    const id = `IMG-${String(draft.studies.length + 1).padStart(3, "0")}`;
    update({ studies: [...draft.studies, { id, patientId: draft.patients[0]?.id ?? "", modality: "XR",
      title: "", report: "", resultDelaySeconds: 0 }] }); setStudyIndex(draft.studies.length);
  };
  const save = () => {
    try { builderDraftStore.save(requireBuilderAdminUserId(), draft);
      if (operator.state === "AUTHENTICATED") clearBuilderPickerReturn(operator.principal.userId);
      setSavedVersion(value => value + 1); setDirty(false);
      setNotice("Mustand salvestatud selles seadmes."); }
    catch { setNotice("Mustandit ei saanud salvestada. Kontrolli paketi ID-d ja versiooni."); }
  };
  const selectDraft = (next: ExerciseBuilderDraft) => {
    const open = () => { if (operator.state === "AUTHENTICATED") clearBuilderPickerReturn(operator.principal.userId);
      setDraft(next); setDirty(false); setPatientIndex(0); setStudyIndex(0); setNotice(""); };
    if (dirty) Alert.alert("Salvestamata muudatused", "Ava teine mustand ja loobu praegustest muudatustest?", [
      { text: "Tühista", style: "cancel" }, { text: "Ava", onPress: open },
    ]); else open();
  };
  const createNewDraft = () => {
    const open = () => { if (operator.state === "AUTHENTICATED") clearBuilderPickerReturn(operator.principal.userId);
      setDraft(newBuilderDraft()); setDirty(false); setPatientIndex(0); setStudyIndex(0);
      setSection("Üldandmed"); setNotice(""); };
    if (dirty) Alert.alert("Salvestamata muudatused", "Alusta uut mustandit ja loobu praegustest muudatustest?", [
      { text: "Tühista", style: "cancel" }, { text: "Alusta uut", onPress: open },
    ]); else open();
  };
  const pickImage = async () => {
    if (operator.state !== "AUTHENTICATED" || !authorized || pickerInFlight.current) return;
    const study = draft.studies[studyIndex];
    if (!study) return;
    const userId = operator.principal.userId;
    let context: BuilderPickerReturn | undefined;
    pickerInFlight.current = true;
    try {
      context = beginBuilderPickerReturn({ userId, draft, section, patientId: draft.patients[patientIndex]?.id,
        studyId: study.id, dirty });
      const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png"],
        copyToCacheDirectory: true, multiple: false });
      if (result.canceled) {
        settleBuilderPickerReturn(userId, context.operationId, { status: "CANCELLED", draft: context.draft,
          notice: "Pildi valimine tühistati." });
        return;
      }
      const asset = result.assets[0];
      if (!asset || !/\.(png|jpe?g)$/i.test(asset.name)) throw new Error("BUILDER_PICKER_INVALID_FILE");
      if (!FileSystem.documentDirectory) throw new Error("BUILDER_PICKER_STORAGE_UNAVAILABLE");
      const directory = `${FileSystem.documentDirectory}russicaptor-builder-assets/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const safeName = asset.name.replace(/[^A-Za-z0-9.-]/g, "-");
      const target = `${directory}${context.operationId}-${safeName}`;
      if (readBuilderPickerReturn(userId)?.operationId !== context.operationId) return;
      await FileSystem.copyAsync({ from: asset.uri, to: target });
      const studyId = context.studyId;
      const nextDraft = { ...context.draft, studies: context.draft.studies.map(item => item.id === studyId
        ? { ...item, image: { localUri: target, fileName: asset.name, source: "", licenseId: "", contributor: "" } }
        : item) };
      settleBuilderPickerReturn(userId, context.operationId, { status: "IMPORTED", draft: nextDraft,
        notice: "Pilt kopeeriti kohalikku mustandisse. Lisa allikas ja kasutusluba." });
    } catch {
      if (context) settleBuilderPickerReturn(userId, context.operationId, { status: "ERROR", draft: context.draft,
        notice: "Pildi import ei õnnestunud. Mustand säilis; proovi uuesti." });
      else setNotice("Pildi valimist ei saanud alustada. Mustand säilis.");
    } finally {
      pickerInFlight.current = false;
    }
  };
  const exportSource = async () => {
    if (!authorized) return;
    const issues = validateBuilderDraft(draft, (id, version) => Boolean(exercisePackageRegistry.get(id, version)));
    if (issues.some(item => item.level === "ERROR")) { setNotice(issues.filter(item => item.level === "ERROR")
      .map(item => item.message).join("\n")); setSection("Ülevaade"); return; }
    try {
      const images = await Promise.all(draft.studies.filter(item => item.image).map(async study => ({
        studyId: study.id, fileName: study.image!.fileName,
        base64: await FileSystem.readAsStringAsync(study.image!.localUri, { encoding: FileSystem.EncodingType.Base64 }),
      })));
      const serialized = serializeBuilderSourceBundle({ schemaVersion: 1, draft, images });
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted) { setNotice("Eksport tühistati."); return; }
      const fileName = `${draft.packageId}-${draft.packageVersion}-source.json`;
      const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri,
        fileName, "application/json");
      await FileSystem.writeAsStringAsync(destination, serialized);
      save();
      setNotice(`Autorlussisend eksporditud: ${fileName}. Lõplik muutumatu pakett ja pildiregister tekivad töölaual käsuga builder:compile.`);
    } catch { setNotice("Eksport ei õnnestunud. Ühtki paketti ei avaldatud."); }
  };
  if (operator.state === "LOADING" || operator.state === "UNAVAILABLE") return <View style={styles.page}>
    <Text>Kontrollin administraatori õigusi. Mustand jääb alles.</Text></View>;
  if (!authorized) return <View style={styles.page}><Text>Exercise Builder on ainult platvormi administraatorile.</Text></View>;
  const patient = draft.patients[patientIndex];
  const study = draft.studies[studyIndex];
  const issues = validateBuilderDraft(draft, (id, version) => Boolean(exercisePackageRegistry.get(id, version)));
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>Administratsioon · Autoritöö</Text>
    <Text style={styles.title}>Exercise Builder</Text>
    <Text style={styles.info}>Siin lood õppusepaketi sisu. Käimasolevaid õppusi hallatakse eraldi „Õppused” vaates.</Text>
    <Action label="Tagasi administratsiooni" onPress={leave} secondary />
    <View style={styles.row}>{sections.map(item => <Pressable key={item} accessibilityRole="tab"
      accessibilityState={{ selected: section === item }} onPress={() => setSection(item)}
      style={[styles.tab, section === item && styles.selectedTab]}><Text>{item}</Text></Pressable>)}</View>
    {section === "Üldandmed" && <View style={styles.card}>
      <Text style={styles.heading}>Paketi üldandmed</Text>
      <Field label="Paketi nimi" value={draft.name} onChangeText={name => update({ name })} />
      <Field label="Paketi ID" value={draft.packageId} onChangeText={packageId => update({ packageId: packageId.toLowerCase() })} />
      <Field label="Versioon" value={draft.packageVersion} onChangeText={packageVersion => update({ packageVersion })} />
      <Field label="Kirjeldus" value={draft.description} onChangeText={description => update({ description })} multiline />
      <Field label="Autor" value={draft.author} onChangeText={author => update({ author })} />
      <Field label="Keel" value={draft.language} onChangeText={language => update({ language })} />
      <Field label="Allikaviide (valikuline; ei ole Runtime’i sõltuvus)" value={draft.sourceReference ?? ""}
        onChangeText={sourceReference => update({ sourceReference })} />
      <Text style={styles.heading}>Salvestatud mustandid</Text>
      <Action label="Alusta uut paketti" onPress={createNewDraft} secondary />
      {savedDrafts.map(item => <Action key={builderDraftKey(item)} label={`${item.name || item.packageId} · ${item.packageVersion}`}
        onPress={() => selectDraft(item)} secondary />)}
    </View>}
    {section === "Patsiendid" && <View style={styles.card}>
      <Text style={styles.heading}>Patsiendid ({draft.patients.length})</Text><Action label="Lisa patsient" onPress={addPatient} />
      <View style={styles.row}>{draft.patients.map((item, index) => <Action key={item.id}
        label={item.name || item.id} onPress={() => setPatientIndex(index)} secondary />)}</View>
      {patient && <><Text style={styles.info}>Patsiendi püsiv ID: {patient.id}</Text>
        <Field label="Patsiendi nimi" value={patient.name} onChangeText={name => updatePatient({ name })} />
        <Field label="Vanus (aastat, valikuline)" value={patient.ageYears?.toString() ?? ""} numeric
          onChangeText={value => updatePatient({ ageYears: value ? Number(value) : undefined })} />
        <Text style={styles.label}>Sugu (valikuline)</Text><View style={styles.row}>{(["F", "M", "OTHER", "UNKNOWN"] as const).map(sex =>
          <Action key={sex} label={sex} onPress={() => updatePatient({ sex })} secondary />)}</View>
        <Text style={styles.info}>Valitud: {patient.sex ?? "määramata"}</Text>
        <Field label="Algasukoht" value={patient.location} onChangeText={location => updatePatient({ location })} />
        <Field label="Üleandmise / olukorra kirjeldus" value={patient.handover}
          onChangeText={handover => updatePatient({ handover })} multiline />
        <View style={styles.row}>{(["P1", "P2", "P3", "P4"] as const).map(triage =>
          <Action key={triage} label={triage} onPress={() => updatePatient({ triage })} secondary />)}</View>
        <Text style={styles.label}>Algolek</Text><View style={styles.row}>{(["Active", "Incoming"] as const).map(status =>
          <Action key={status} label={status === "Active" ? "Aktiivne" : "Saabumas"}
            onPress={() => updatePatient({ status })} secondary />)}</View>
        <Text style={styles.info}>Triaaž: {patient.triage}. Algolek: {patient.status === "Incoming" ? "Saabumas" : "Aktiivne"}.</Text>
      </>}
    </View>}
    {section === "Näitajad" && <View style={styles.card}>
      <Text style={styles.heading}>Algsed elulised näitajad</Text>
      <Text style={styles.info}>{patient?.name || patient?.id || "Lisa esmalt patsient."}</Text>
      {patient && vitalFields.map(([key, label]) => <Field key={key} label={label}
        value={patient.vitals[key]?.toString() ?? ""} numeric onChangeText={value => {
          const vitals = { ...patient.vitals }; if (!value) delete vitals[key]; else vitals[key] = Number(value);
          updatePatient({ vitals });
        }} />)}
    </View>}
    {section === "Labor" && <View style={styles.card}>
      <Text style={styles.heading}>Staatilised laboritulemused</Text>
      <Text style={styles.info}>Dünaamilised näitajad jäävad olemasoleva füsioloogiamudeli arvutada. Paneelimerkija aB-Hb-Fr ei ole üksik tulemus.</Text>
      {patient && staticLabs.map(analyte => <Field key={analyte.id}
        label={`${analyte.sourceName}${analyte.unit ? ` (${analyte.unit})` : ""}`}
        value={patient.labs[analyte.id]?.toString() ?? ""} numeric
        onChangeText={value => { const labs = { ...patient.labs }; if (!value) delete labs[analyte.id];
          else labs[analyte.id] = Number(value); updatePatient({ labs }); }} />)}
      <Text style={styles.heading}>Tulemuse viivitus simulatsiooniajas</Text>
      {Object.entries(NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE).map(([group, fallback]) =>
        <Field key={group} label={`${group} (sekundit; vaikimisi ${fallback})`}
          value={draft.labResultDelaySeconds[group as keyof typeof draft.labResultDelaySeconds]?.toString() ?? ""}
          numeric onChangeText={value => { const delays = { ...draft.labResultDelaySeconds };
            if (!value) delete delays[group as keyof typeof delays];
            else delays[group as keyof typeof delays] = Number(value); update({ labResultDelaySeconds: delays }); }} />)}
    </View>}
    {section === "Pildiuuringud" && <View style={styles.card}>
      <Text style={styles.heading}>Pildiuuringud ({draft.studies.length})</Text><Action label="Lisa uuring" onPress={addStudy} />
      <View style={styles.row}>{draft.studies.map((item, index) => <Action key={item.id}
        label={item.title || item.id} onPress={() => setStudyIndex(index)} secondary />)}</View>
      {study && <><Text style={styles.info}>Uuringu ID: {study.id}</Text>
        <Text style={styles.label}>Patsient</Text><View style={styles.row}>{draft.patients.map(item =>
          <Action key={item.id} label={item.name || item.id} onPress={() => updateStudy({ patientId: item.id })} secondary />)}</View>
        <Text style={styles.info}>Valitud: {study.patientId || "puudub"}</Text>
        <Text style={styles.label}>Modaalsus</Text><View style={styles.row}>{(["XR", "CT", "US", "ECG", "OTHER"] as const).map(modality =>
          <Action key={modality} label={modality} onPress={() => updateStudy({ modality })} secondary />)}</View>
        <Text style={styles.info}>Valitud: {study.modality}</Text>
        <Field label="Uuringu nimetus" value={study.title} onChangeText={title => updateStudy({ title })} />
        <Field label="Uuringu vastus" value={study.report} onChangeText={report => updateStudy({ report })} multiline />
        <Field label="Tulemuse viivitus (simulatsioonisekundit)" value={study.resultDelaySeconds.toString()}
          numeric onChangeText={value => updateStudy({ resultDelaySeconds: Number(value) })} />
        <Action label="Vali JPEG/PNG pilt" onPress={() => void pickImage()} secondary />
        {study.image && <><Text style={styles.info}>Kohalik pilt: {study.image.fileName}</Text>
          <Field label="Pildi allikas" value={study.image.source} onChangeText={source => updateStudy({ image: { ...study.image!, source } })} />
          <Field label="Litsents / kasutusluba" value={study.image.licenseId} onChangeText={licenseId => updateStudy({ image: { ...study.image!, licenseId } })} />
          <Field label="Autor / omanik" value={study.image.contributor} onChangeText={contributor => updateStudy({ image: { ...study.image!, contributor } })} />
          <Field label="Omistus (valikuline)" value={study.image.attribution ?? ""} onChangeText={attribution => updateStudy({ image: { ...study.image!, attribution } })} />
        </>}
      </>}
    </View>}
    {section === "Ülevaade" && <View style={styles.card}>
      <Text style={styles.heading}>{draft.name || "Nimetamata pakett"} · {draft.packageVersion}</Text>
      <Text style={styles.info}>Patsiente: {draft.patients.length}; uuringuid: {draft.studies.length}; pilte: {draft.studies.filter(item => item.image).length}.</Text>
      {draft.patients.map(item => <View key={item.id} style={styles.reviewBlock}>
        <Text style={styles.label}>{item.name || item.id} · {item.location} · {item.status === "Incoming" ? "Saabumas" : "Aktiivne"}</Text>
        <Text style={styles.info}>Üleandmine: {item.handover || "kirjeldamata"}</Text>
        <Text style={styles.info}>Näitajad: {Object.entries(item.vitals).map(([key, value]) => `${key} ${value}`).join(" · ") || "puuduvad"}</Text>
        <Text style={styles.info}>Labor: {Object.entries(item.labs).map(([id, value]) => {
          const analyte = NARVA_LAB_ANALYTES.find(entry => entry.id === id);
          return `${analyte?.sourceName ?? id} ${value}${analyte?.unit ? ` ${analyte.unit}` : ""}`;
        }).join(" · ") || "puudub"}</Text>
      </View>)}
      {draft.studies.map(item => <Text key={item.id} style={styles.info}>{item.title || item.id} · {item.resultDelaySeconds} s · {item.image ? "pildiga" : "ainult raport"}</Text>)}
      <Text style={styles.info}>Toimingud pärinevad olemasolevast CUSTOM Runtime’i mallist ja kehtivad kõigile selle paketi patsientidele. Builder v1 ei määra uusi patsiendipõhiseid toiminguid.</Text>
      <Text style={styles.heading}>Valideerimine</Text>
      {issues.length ? issues.map((item, index) => <Text key={`${item.code}-${index}`} style={styles.error}>{item.message}</Text>)
        : <Text style={styles.success}>Autorlussisend on eksportimiseks valmis.</Text>}
      <Text style={styles.info}>Transport ja protseduuride muutmine on v1-s välja lülitatud. Runtime’i tegevused pärinevad olemasolevast CUSTOM-mallist.</Text>
      <Text style={styles.info}>Lõplik paketi räsi arvutatakse pärast pildifailide kontrolli ja Metro registri genereerimist töölaual.</Text>
      <Action label="Ekspordi autorlussisend" onPress={() => void exportSource()} />
    </View>}
    <View style={styles.row}><Action label="Salvesta mustand" onPress={save} /><Action label="Tühista muudatused"
      onPress={() => { const saved = savedDrafts.find(item => builderDraftKey(item) === builderDraftKey(draft));
        selectDraft(saved ?? newBuilderDraft()); }} secondary /></View>
    {!!notice && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: "#F6F8FB", padding: 20, gap: 14 },
  kicker: { color: "#005BBB", fontWeight: "800" }, title: { fontSize: 30, fontWeight: "900", color: "#101828" },
  info: { color: "#475467", lineHeight: 22 }, heading: { fontSize: 20, fontWeight: "800", color: "#101828", marginBottom: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, tab: { borderRadius: 9, backgroundColor: "#EAECF0", padding: 10 },
  reviewBlock: { gap: 4, borderBottomWidth: 1, borderBottomColor: "#EAECF0", paddingBottom: 10 },
  selectedTab: { backgroundColor: "#B2DDFF" }, card: { backgroundColor: "#fff", padding: 16, borderRadius: 12, gap: 12 },
  field: { gap: 4 }, label: { color: "#344054", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#98A2B3", borderRadius: 9, padding: 10, minHeight: 44, color: "#101828" },
  multiline: { minHeight: 90, textAlignVertical: "top" }, action: { backgroundColor: "#005BBB", borderRadius: 9, padding: 12 },
  secondary: { backgroundColor: "#EAECF0" }, actionText: { color: "#fff", fontWeight: "800" },
  secondaryText: { color: "#344054" }, error: { color: "#B42318" }, success: { color: "#027A48" },
  notice: { color: "#344054", backgroundColor: "#D1E9FF", padding: 12, borderRadius: 8 },
});
