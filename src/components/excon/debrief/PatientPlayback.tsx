import type { PatientPlaybackView } from "@/services/debrief/DebriefModel";
import { StyleSheet, Text, View } from "react-native";
import { patientOutcomeLabel } from "@/localization/dataDrivenEt";
import { processStatusLabel } from "@/localization/et";

export function PatientPlayback({ view }: { view?: PatientPlaybackView }) {
  if (!view) return <View style={styles.card}><Text style={styles.empty}>Vali patsient, kelle sündmusi taasesitada.</Text></View>;
  return <View style={styles.card}>
    <Text style={styles.title}>{view.patient.patientId} · {view.patient.name}</Text>
    <Text style={styles.meta}>{view.patient.initialLocation} → {view.patient.finalLocation} · {patientOutcomeLabel(view.patient.outcome)}</Text>
    <Text style={styles.heading}>Hetkel T+{view.simulationTimeSec}s</Text>
    <Text style={styles.meta}>{view.events.length} patsiendisündmust · {view.processes.length} protsessi</Text>
    {view.processes.map(process => { const calcium = process.clinicalState?.transfusionCalcium as Readonly<{
      completedRbcUnitsTotal?: number; calciumRecommended?: boolean;
      calciumAdministrations?: readonly Readonly<{ administrationId?: string; product?: string; dose?: string; route?: string; completedAtSec?: number }>[];
    }> | undefined; return <View key={`${process.processId}:${process.moduleId}`}>
      <Text style={styles.process}>• {process.processId} · {processStatusLabel(process.status)}</Text>
      {process.moduleId === "MASSIVE_TRANSFUSION_V1" && (Number(calcium?.completedRbcUnitsTotal ?? 0) > 0 ||
        (Array.isArray(calcium?.calciumAdministrations) && calcium.calciumAdministrations.length > 0)) && <View>
        {Array.isArray(process.clinicalState?.vascularAccessLines) && <Text style={styles.meta}>
          Veeniteid: {String(process.clinicalState.vascularAccessCount ?? process.clinicalState.vascularAccessLines.length)} · manustamisi: {Array.isArray(process.clinicalState?.administrations) ? process.clinicalState.administrations.length : 0}
        </Text>}
        {Array.isArray(process.clinicalState?.administrations) && process.clinicalState.administrations.map((item, index) =>
          <Text key={String(item.administrationId ?? index)} style={styles.meta}>
            {String(item.product)} · {String(item.deliveryMode ?? "pärandkiirus")} · {String(item.vascularAccessLineId ?? "veenitee määramata")} · {String(item.state)}
          </Text>)}
        <Text style={calcium?.calciumRecommended ? styles.miss : styles.meta}>
          Erütrotsüüdiühikuid: {String(calcium?.completedRbcUnitsTotal ?? 0)} · {calcium?.calciumRecommended
            ? "näidustatud kaltsium jäi manustamata (protokolli kõrvalekalle)"
            : `kaltsiumi manustamisi: ${Array.isArray(calcium?.calciumAdministrations) ? calcium.calciumAdministrations.length : 0}`}
        </Text>
        {Array.isArray(calcium?.calciumAdministrations) && calcium.calciumAdministrations.map((item, index) =>
          <Text key={String(item.administrationId ?? index)} style={styles.meta}>
            Kaltsium: {String(item.product)} · {String(item.dose)} · {String(item.route)} · T+{String(item.completedAtSec)}s
          </Text>)}
      </View>}
    </View>; })}
  </View>;
}
const styles = StyleSheet.create({ card: { borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 12, padding: 14, marginBottom: 12 }, title: { fontWeight: "900", fontSize: 17, color: "#172b4d" }, heading: { marginTop: 10, fontWeight: "800", color: "#172b4d" }, meta: { color: "#5e6c84", marginTop: 3 }, miss: { color: "#b91c1c", fontWeight: "800", marginTop: 3 }, process: { color: "#42526e", marginTop: 4 }, empty: { color: "#6b778c" } });
