import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type {
  ActiveClinicalTreatment,
  ClinicalTreatmentCommand,
  ClinicalTreatmentDescriptor,
  ClinicalTreatmentFormValues,
  ClinicalTreatmentSubmissionResult,
} from "@/models/ClinicalTreatment";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import {
  availableClinicalTreatmentDescriptors,
  CLINICAL_TREATMENT_CATEGORY_LABELS,
  groupClinicalTreatments,
  requireClinicalTreatmentDescriptor,
} from "@/services/clinical/ClinicalTreatmentCatalog";
import {
  buildClinicalTreatmentCommand,
  clinicalTreatmentMutationReadiness,
  createClinicalTreatmentIntentIdentity,
  submitClinicalTreatment,
} from "@/services/clinical/ClinicalTreatmentCommandService";
import { clinicalTreatmentProjections, isTreatmentActive } from
  "@/services/clinical/ClinicalTreatmentProjection";
import {
  getPatientResourceDebugSnapshot,
  getResourceRuntimeDebugVersion,
  subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";
import { SingleFlightActionGate } from "@/services/ui/InteractionSafety";
import { getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots } from
  "@/services/RuntimeSnapshotService";

type Props = Readonly<{
  patientId: string;
  readOnly?: boolean;
  exercisePackage?: Pick<ExercisePackage, "availableClinicalTreatments">;
  onSubmit?: (treatmentId: ClinicalTreatmentDescriptor["treatmentId"], command: ClinicalTreatmentCommand) =>
    Promise<ClinicalTreatmentSubmissionResult>;
}>;

const initialValues = (descriptor: ClinicalTreatmentDescriptor): ClinicalTreatmentFormValues => Object.freeze(
  Object.fromEntries(descriptor.fields.filter(field => field.initialValue !== undefined)
    .map(field => [field.fieldId, field.initialValue!])),
);

function valuesFromActive(item: ActiveClinicalTreatment): ClinicalTreatmentFormValues {
  const value = item.rawProjection;
  const string = (key: string): string | undefined => value[key] === undefined ? undefined : String(value[key]);
  return Object.freeze({ mode: string("mode"), route: string("route"), vascularAccessId: string("vascularAccessId"),
    securedAirwayId: string("securedAirwayId"), rateMlHour: string("currentRateMlHour"),
    doseRate: string("currentRate") ?? string("doseMicrogramsPerKgMin"),
    respiratoryRate: string("respiratoryRate"), tidalVolumeMl: string("tidalVolumeMl"), fio2: string("fio2"),
    peepCmH2O: string("peepCmH2O") });
}

export function ClinicalTreatmentPanel({ patientId, readOnly = false, exercisePackage, onSubmit }: Props) {
  useSyncExternalStore(subscribeToResourceRuntimeDebug, getResourceRuntimeDebugVersion,
    getResourceRuntimeDebugVersion);
  const runtimeVersion = useSyncExternalStore(subscribeToRuntimeSnapshots, getRuntimeSnapshotVersion,
    getRuntimeSnapshotVersion);
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const pkg = exercisePackage ?? getExercisePackage(exerciseId);
  const descriptors = availableClinicalTreatmentDescriptors(pkg);
  const grouped = groupClinicalTreatments(descriptors);
  const debug = getPatientResourceDebugSnapshot(patientId);
  const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(patientId, runtimeVersion)?.state.exerciseTimeSec ??
    debug.updatedAt;
  const treatments = clinicalTreatmentProjections(debug.medicationState?.clinicalFeatures ?? [], patientId);
  const active = treatments.filter(isTreatmentActive); const history = treatments.filter(item => !isTreatmentActive(item));
  const readiness = clinicalTreatmentMutationReadiness(exerciseId, patientId);
  const [selected, setSelected] = useState<ClinicalTreatmentDescriptor>();
  const [values, setValues] = useState<ClinicalTreatmentFormValues>({});
  const [editingInstanceId, setEditingInstanceId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [result, setResult] = useState<ClinicalTreatmentSubmissionResult>();
  const gate = useRef(new SingleFlightActionGate()).current;
  const canMutate = !readOnly && readiness.ready;
  const accessOptions = (route?: string) => (debug.circulationStates?.[0]?.vascularAccess ?? [])
    .filter(item => route === "IO" ? item.type === "IO" : item.type !== "IO")
    .map(item => item.interventionInstanceId);
  const airwayOptions = (debug.clinicalInterventions ?? []).filter(item =>
    item.definitionId === "ENDOTRACHEAL_INTUBATION" && item.status === "RUNNING").map(item => item.instanceId);

  const choose = (descriptor: ClinicalTreatmentDescriptor, item?: ActiveClinicalTreatment) => {
    setSelected(descriptor); setValues(item ? valuesFromActive(item) : initialValues(descriptor));
    setEditingInstanceId(item?.instanceId); setErrors([]); setResult(undefined);
  };

  const execute = async (descriptor: ClinicalTreatmentDescriptor, action: "START" | "CHANGE" | "STOP",
    existingInstanceId?: string) => gate.run(async () => {
      setPending(true); setErrors([]);
      try {
        const identity = createClinicalTreatmentIntentIdentity(descriptor.treatmentId, patientId);
        const built = buildClinicalTreatmentCommand(descriptor, values, { patientId,
          simulationTimeSec, commandId: identity.commandId,
          instanceId: existingInstanceId ?? identity.instanceId, action });
        if (!built.ok) { setErrors(built.errors); return; }
        const settled = onSubmit ? await onSubmit(descriptor.treatmentId, built.command) :
          await submitClinicalTreatment(exerciseId, patientId, descriptor.treatmentId, built.command);
        setResult(settled);
        if (settled.status !== "REJECTED" && settled.status !== "UNAVAILABLE") {
          setSelected(undefined); setEditingInstanceId(undefined); setValues({});
        }
      } finally { setPending(false); }
    });

  return <View style={styles.card} testID="clinical-treatment-panel">
    <Text style={styles.title}>Ravi</Text>
    <Text style={styles.help}>Vali ravi ja saada korraldus patsiendi autoriteetsesse Runtime&apos;i.</Text>
    {!canMutate && <Text style={styles.readOnly} accessibilityRole="alert">{readOnly ?
      "Ravi muutmine ei ole vaatamisrežiimis lubatud." : readiness.reason}</Text>}
    {!selected && canMutate && [...grouped.entries()].map(([category, items]) => <View key={category}
      style={styles.category}>
      <Text style={styles.categoryTitle}>{CLINICAL_TREATMENT_CATEGORY_LABELS[category]}</Text>
      <View style={styles.buttonGrid}>{items.map(item => <Pressable key={item.treatmentId}
        accessibilityRole="button" disabled={pending} style={styles.treatmentButton} onPress={() => choose(item)}>
        <Text style={styles.treatmentButtonText}>{item.displayName}</Text>
      </Pressable>)}</View>
    </View>)}
    {selected && canMutate && <View style={styles.form} testID={`treatment-form-${selected.treatmentId}`}>
      <Text style={styles.formTitle}>{selected.displayName}</Text>
      {selected.commandKind === "VENTILATION" && <Text style={styles.fixedMode}>Režiim: VOLUME_CONTROL</Text>}
      {selected.fields.map(field => {
        const mode = values.mode ?? selected.fields.find(item => item.fieldId === "mode")?.initialValue;
        if (field.fieldId === "volumeMl" && mode === "INFUSION" || field.fieldId === "dose" && mode === "INFUSION" ||
          field.fieldId === "doseRate" && mode === "BOLUS") return null;
        const dynamicOptions = field.fieldId === "vascularAccessId" ? accessOptions(values.route ?? selected.routes[0]) :
          field.fieldId === "securedAirwayId" ? airwayOptions : field.options ?? [];
        if (field.kind === "SELECT") return <View key={field.fieldId} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text><View style={styles.buttonGrid}>{dynamicOptions.map(option =>
            <Pressable key={option} testID={`treatment-choice-${field.fieldId}-${option}`}
              style={[styles.choice, values[field.fieldId] === option && styles.choiceSelected]}
              onPress={() => setValues(current => field.fieldId === "route" ?
                ({ ...current, route: option, vascularAccessId: undefined }) :
                ({ ...current, [field.fieldId]: option }))}>
              <Text style={styles.choiceText}>{option}</Text>
            </Pressable>)}</View>
          {dynamicOptions.length === 0 && <Text style={styles.error}>Sobiv valik puudub.</Text>}
        </View>;
        return <View key={field.fieldId} style={styles.field}><Text style={styles.label}>{field.label}</Text>
          <View style={styles.inputRow}><TextInput testID={`treatment-field-${field.fieldId}`}
            keyboardType="decimal-pad" value={values[field.fieldId] ?? field.initialValue ?? ""}
            onChangeText={value => setValues(current => ({ ...current, [field.fieldId]: value }))}
            style={styles.input} /><Text style={styles.unit}>{field.unit}</Text></View>
        </View>;
      })}
      {errors.map(error => <Text key={error} style={styles.error} accessibilityRole="alert">{error}</Text>)}
      <View style={styles.buttonGrid}><Pressable disabled={pending} style={styles.cancelButton}
        onPress={() => { setSelected(undefined); setEditingInstanceId(undefined); setErrors([]); }}>
        <Text style={styles.buttonText}>Katkesta</Text></Pressable>
        <Pressable testID="submit-treatment" disabled={pending} style={styles.submitButton}
          onPress={() => void execute(selected, editingInstanceId ? "CHANGE" : "START", editingInstanceId)}>
          <Text style={styles.buttonText}>{pending ? "Saatmine…" : editingInstanceId ? "Muuda ravi" : "Rakenda ravi"}</Text>
        </Pressable></View>
    </View>}
    {result && <Text testID="treatment-result" accessibilityRole="alert"
      style={result.status === "REJECTED" || result.status === "UNAVAILABLE" ? styles.error : styles.success}>
      {result.message}
    </Text>}
    <Text style={styles.sectionTitle}>Aktiivne ravi</Text>
    {active.length === 0 && <Text style={styles.empty}>Aktiivset ravi ei ole.</Text>}
    {active.map(item => <TreatmentCard key={item.instanceId} item={item} mutable={canMutate && !pending}
      onChange={() => choose(requireClinicalTreatmentDescriptor(item.treatmentId), item)}
      onStop={() => void execute(requireClinicalTreatmentDescriptor(item.treatmentId), "STOP", item.instanceId)} />)}
    {history.length > 0 && <><Text style={styles.sectionTitle}>Lõpetatud ravi</Text>
      {history.map(item => <TreatmentCard key={item.instanceId} item={item} mutable={false} />)}</>}
  </View>;
}

function TreatmentCard({ item, mutable, onChange, onStop }: Readonly<{ item: ActiveClinicalTreatment;
  mutable: boolean; onChange?: () => void; onStop?: () => void }>) {
  return <View style={styles.activeCard} testID={`active-treatment-${item.instanceId}`}>
    <Text style={styles.activeTitle}>{item.displayName} · {item.lifecycle}</Text>
    {item.detailLines.map(line => <Text key={line} style={styles.detail}>{line}</Text>)}
    {mutable && <View style={styles.buttonGrid}>{item.supportsChange && <Pressable style={styles.changeButton}
      onPress={onChange}><Text style={styles.buttonText}>Muuda</Text></Pressable>}
      {item.supportsStop && <Pressable style={styles.stopButton} onPress={onStop}>
        <Text style={styles.buttonText}>Peata</Text></Pressable>}</View>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#f8fafc", borderColor: "#94a3b8", borderWidth: 1, borderRadius: 14,
    padding: 16, gap: 10, marginBottom: 18 },
  title: { fontSize: 22, fontWeight: "900", color: "#0f172a" },
  help: { color: "#475569" }, readOnly: { color: "#9a3412", fontWeight: "700" },
  category: { gap: 8, marginTop: 8 }, categoryTitle: { fontSize: 17, fontWeight: "800", color: "#334155" },
  buttonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  treatmentButton: { minHeight: 48, justifyContent: "center", backgroundColor: "#1d4ed8", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10 }, treatmentButtonText: { color: "#fff", fontWeight: "800" },
  form: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, padding: 12, gap: 10 },
  formTitle: { fontSize: 19, fontWeight: "900" }, fixedMode: { color: "#334155", fontWeight: "700" },
  field: { gap: 6 }, label: { fontWeight: "700", color: "#334155" }, inputRow: { flexDirection: "row",
    alignItems: "center", gap: 8 }, input: { minHeight: 48, flex: 1, borderWidth: 1, borderColor: "#94a3b8",
    backgroundColor: "#fff", borderRadius: 9, paddingHorizontal: 12, fontSize: 18 },
  unit: { minWidth: 80, fontWeight: "800", color: "#334155" }, choice: { minHeight: 48,
    justifyContent: "center", borderWidth: 1, borderColor: "#64748b", borderRadius: 9, paddingHorizontal: 12 },
  choiceSelected: { backgroundColor: "#dbeafe", borderColor: "#1d4ed8", borderWidth: 2 },
  choiceText: { color: "#0f172a", fontWeight: "700" }, submitButton: { minHeight: 48,
    justifyContent: "center", backgroundColor: "#166534", borderRadius: 9, paddingHorizontal: 16 },
  cancelButton: { minHeight: 48, justifyContent: "center", backgroundColor: "#475569", borderRadius: 9,
    paddingHorizontal: 16 }, buttonText: { color: "#fff", fontWeight: "800" },
  error: { color: "#b42318", fontWeight: "700" }, success: { color: "#166534", fontWeight: "800" },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: "#334155", marginTop: 8 },
  empty: { color: "#64748b", fontStyle: "italic" }, activeCard: { backgroundColor: "#fff", borderWidth: 1,
    borderColor: "#cbd5e1", borderRadius: 10, padding: 12, gap: 4 }, activeTitle: { fontWeight: "900",
    color: "#0f172a" }, detail: { color: "#475569" }, changeButton: { minHeight: 48, justifyContent: "center",
    backgroundColor: "#0369a1", borderRadius: 9, paddingHorizontal: 14 }, stopButton: { minHeight: 48,
    justifyContent: "center", backgroundColor: "#b42318", borderRadius: 9, paddingHorizontal: 14 },
});
