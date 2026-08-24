import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { VitalSigns } from "@/models/VitalSigns";
import type { VitalSignsInput } from "@/services/VitalSignsService";
import type { CanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";

type Props = {
  measurements: VitalSigns[];
  readOnly?: boolean;
  onRecord: (values: VitalSignsInput) => boolean;
  canonicalRuntime?: CanonicalPatientRuntimeSnapshot;
};

type Field = {
  key: keyof VitalSignsInput;
  label: string;
  unit: string;
  required?: boolean;
};

const fields: Field[] = [
  { key: "heartRate", label: "Pulss", unit: "/min", required: true },
  { key: "systolicBloodPressure", label: "RR süstoolne", unit: "mmHg", required: true },
  { key: "diastolicBloodPressure", label: "RR diastoolne", unit: "mmHg", required: true },
  { key: "respiratoryRate", label: "Hingamissagedus", unit: "/min", required: true },
  { key: "oxygenSaturation", label: "SpO₂", unit: "%", required: true },
  { key: "temperature", label: "Temperatuur", unit: "°C", required: true },
  { key: "gcs", label: "GCS", unit: "", required: true },
  { key: "bloodGlucose", label: "Veresuhkur", unit: "mmol/L" },
  { key: "etco2", label: "EtCO₂", unit: "mmHg" },
  { key: "painScore", label: "Valu", unit: "/10" },
];

// Keep the manual-entry workflow available for a later pilot without exposing
// it in the current CM interface.
const manualVitalSignsEntryEnabled = false;

function measurementValue(measurement: VitalSigns, field: Field): string {
  const value = measurement[field.key];
  return typeof value === "number" ? `${value}${field.unit ? ` ${field.unit}` : ""}` : "–";
}

function isAbnormal(measurement: VitalSigns, key: keyof VitalSignsInput): boolean {
  const value = measurement[key];
  if (typeof value !== "number") return false;
  switch (key) {
    case "heartRate": return value < 50 || value > 100;
    case "systolicBloodPressure": return value < 90 || value > 160;
    case "diastolicBloodPressure": return value < 50 || value > 100;
    case "respiratoryRate": return value < 10 || value > 20;
    case "oxygenSaturation": return value < 94;
    case "temperature": return value < 35.5 || value > 38;
    case "gcs": return value < 15;
    case "bloodGlucose": return value < 3.5 || value > 10;
    case "etco2": return value < 35 || value > 45;
    case "painScore": return value >= 4;
  }
}

function measurementLabel(measurement: VitalSigns): string {
  const source = measurement.source === "scenario" ? "Stsenaarium" : measurement.recordedBy ?? "CM";
  return `T+${measurement.exerciseMinute} min · ${source}`;
}

export default function VitalsTab({ measurements, readOnly = false, onRecord, canonicalRuntime }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const latest = measurements[0];

  const requiredComplete = useMemo(
    () => fields.filter((field) => field.required).every((field) => values[field.key]?.trim()),
    [values]
  );

  function save(): void {
    const parsed: VitalSignsInput = {};
    fields.forEach((field) => {
      const raw = values[field.key]?.trim();
      if (raw) parsed[field.key] = Number(raw.replace(",", "."));
    });

    if (Object.values(parsed).some((value) => !Number.isFinite(value))) {
      Alert.alert("Kontrolli väärtusi", "Kõik näidud peavad olema arvud.");
      return;
    }

    if (onRecord(parsed)) {
      setValues({});
    }
  }

  return (
    <View style={styles.container}>
      {canonicalRuntime?.state.vitalSignState && <CanonicalRuntimeCard runtime={canonicalRuntime} />}
      <View style={styles.card}>
        <Text style={styles.title}>Elulised näitajad</Text>
        {!latest ? (
          <Text style={styles.empty}>Mõõtmised puuduvad</Text>
        ) : (
          <>
            <Text style={styles.timestamp}>{measurementLabel(latest)}</Text>
            <View style={styles.grid}>
              {fields.map((field) => (
                <View
                  key={field.key}
                  style={[styles.vital, isAbnormal(latest, field.key) && styles.vitalAbnormal]}
                >
                  <Text style={styles.vitalLabel}>{field.label}</Text>
                  <Text style={[styles.vitalValue, isAbnormal(latest, field.key) && styles.abnormalText]}>
                    {measurementValue(latest, field)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {manualVitalSignsEntryEnabled && !readOnly && (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Lisa mõõtmine</Text>
          <View style={styles.formGrid}>
            {fields.map((field) => (
              <View key={field.key} style={styles.inputBlock}>
                <Text style={styles.inputLabel}>{field.label}{field.required ? " *" : ""}</Text>
                <TextInput
                  value={values[field.key] ?? ""}
                  onChangeText={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                  keyboardType="decimal-pad"
                  placeholder={field.unit || "Näit"}
                  style={styles.input}
                />
              </View>
            ))}
          </View>
          <Pressable
            disabled={!requiredComplete}
            onPress={save}
            style={[styles.saveButton, !requiredComplete && styles.saveButtonDisabled]}
          >
            <Text style={styles.saveButtonText}>Salvesta mõõtmine</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.subtitle}>Mõõtmiste ajalugu</Text>
        {measurements.map((measurement) => (
          <View key={measurement.id} style={styles.historyRow}>
            <Text style={styles.historyTime}>{measurementLabel(measurement)}</Text>
            <Text style={styles.historyValues}>
              RR {measurement.systolicBloodPressure ?? "–"}/{measurement.diastolicBloodPressure ?? "–"} · HR {measurement.heartRate ?? "–"} · RR {measurement.respiratoryRate ?? "–"} · SpO₂ {measurement.oxygenSaturation ?? "–"}% · GCS {measurement.gcs ?? "–"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CanonicalRuntimeCard({ runtime }: Readonly<{ runtime: CanonicalPatientRuntimeSnapshot }>) {
  const state = runtime.state; const vitals = state.vitalSignState!;
  const pleural = runtime.processes.find(process => process.moduleId === "PLEURAL_INJURY_V1")?.clinicalState;
  const hemorrhage = runtime.processes.find(process => process.moduleId === "HEMORRHAGE_V1")?.clinicalState;
  const value = (candidate: unknown) => typeof candidate === "number" ? Math.round(candidate * 100) / 100 : "–";
  return <View style={styles.card} testID="canonical-runtime-vitals">
    <Text style={styles.title}>Kanooniline Runtime</Text>
    <Text style={styles.timestamp}>T+{state.exerciseTimeSec}s · versioon {state.stateVersion}</Text>
    <View style={styles.grid}>
      <Vital label="Pulss" value={`${value(vitals.readings.heartRate.current)} /min`} />
      <Vital label="Vererõhk" value={`${value(vitals.readings.systolicBp.current)}/${value(vitals.readings.diastolicBp.current)} mmHg`} />
      <Vital label="MAP" value={`${value(vitals.derived.meanArterialPressure)} mmHg`} />
      <Vital label="Hingamissagedus" value={`${value(vitals.readings.respiratoryRate.current)} /min`} />
      <Vital label="SpO₂" value={`${value(vitals.readings.spo2.current)} %`} />
      <Vital label="Ajalooline verekaotus" value={`${value(hemorrhage?.cumulativeLossMl)} ml`} />
      <Vital label="Veritsuskiirus" value={`${value(hemorrhage?.bleedingRateMlMin)} ml/min`} />
      <Vital label="Dreeni kogumaht" value={`${value(pleural?.totalDrainOutputMl)} ml`} />
    </View>
  </View>;
}

function Vital({ label, value }: Readonly<{ label: string; value: string }>) {
  return <View style={styles.vital}><Text style={styles.vitalLabel}>{label}</Text><Text style={styles.vitalValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  card: { backgroundColor: "#f2f4f7", borderRadius: 16, padding: 18 },
  title: { fontSize: 22, fontWeight: "bold" },
  subtitle: { fontSize: 19, fontWeight: "bold", marginBottom: 12 },
  timestamp: { color: "#667085", marginTop: 4, marginBottom: 12 },
  empty: { color: "#667085", fontStyle: "italic", marginTop: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vital: { width: "48%", backgroundColor: "#fff", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#d0d5dd" },
  vitalAbnormal: { backgroundColor: "#fff4ed", borderColor: "#f97066" },
  vitalLabel: { color: "#667085", fontSize: 12 },
  vitalValue: { color: "#101828", fontSize: 20, fontWeight: "bold", marginTop: 2 },
  abnormalText: { color: "#b42318" },
  formGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  inputBlock: { width: "48%" },
  inputLabel: { color: "#344054", fontWeight: "600", marginBottom: 5 },
  input: { backgroundColor: "#fff", borderColor: "#98a2b3", borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 17 },
  saveButton: { backgroundColor: "#005BBB", borderRadius: 10, alignItems: "center", padding: 13, marginTop: 14 },
  saveButtonDisabled: { backgroundColor: "#98a2b3" },
  saveButtonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  historyRow: { backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8 },
  historyTime: { color: "#005BBB", fontWeight: "bold" },
  historyValues: { color: "#344054", marginTop: 5, lineHeight: 20 },
});
