import { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getPatientResourceDebugSnapshot,
  getResourceRuntimeDebugVersion,
  subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";

function timeLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, "0")).join(":");
}

function resourceLabel(type: string): string {
  return ({
    oxygen: "Oxygen",
    oxygenMask: "Oxygen mask",
    BVM: "BVM",
    ventilator: "Ventilator",
    endotrachealTube: "ET tube",
    monitor: "Monitor",
  } as Record<string, string>)[type] ?? type;
}

export default function ResourceDeveloperCard({ patientId }: { patientId: string }) {
  useSyncExternalStore(
    subscribeToResourceRuntimeDebug,
    getResourceRuntimeDebugVersion,
    getResourceRuntimeDebugVersion
  );
  const snapshot = getPatientResourceDebugSnapshot(patientId);
  const airway = snapshot.airwayStates?.[0];
  const circulation = snapshot.circulationStates?.[0];
  const hemorrhage = snapshot.hemorrhageProcesses?.[0];
  const medications = snapshot.medicationState;
  const vitals = snapshot.vitalSignStates?.[0]?.state;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Resources</Text>
        <Text style={styles.badge}>DEV</Text>
      </View>

      {snapshot.resources.length === 0 ? (
        <Text style={styles.empty}>Resource runtime pole selle vaate jaoks veel snapshot’i avaldanud.</Text>
      ) : snapshot.resources.map(resource => {
        const assignedHere = resource.assignedPatientId === patientId;
        const unavailable = resource.status === "RESERVED" && !assignedHere;
        return (
          <View key={resource.resourceId} style={styles.row}>
            <Text style={styles.statusIcon}>{assignedHere ? "🟢" : unavailable ? "🔴" : "⚪"}</Text>
            <View style={styles.rowBody}>
              <Text style={styles.resourceName}>{resourceLabel(resource.type)}</Text>
              <Text style={styles.meta}>
                {resource.resourceId} · {assignedHere ? "assigned to patient" : unavailable ? `in use by ${resource.assignedPatientId}` : "available"}
              </Text>
            </View>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Active interventions</Text>
      {snapshot.activeInterventions.length === 0 ? (
        <Text style={styles.empty}>Aktiivseid resource intervention’e pole.</Text>
      ) : snapshot.activeInterventions.map(intervention => (
        <Text key={intervention.interventionId} style={styles.itemText}>
          ✓ {intervention.action} {intervention.resourceId} · priority {intervention.priority}
        </Text>
      ))}

      <Text style={styles.sectionTitle}>Airway runtime</Text>
      <Text style={styles.itemText}>Active airway: {airway?.activeAirway ?? "NONE"}</Text>
      <Text style={styles.itemText}>Current ventilation: {airway?.currentVentilation ?? "NONE"}</Text>
      <Text style={styles.itemText}>Active oxygen delivery: {airway?.activeOxygenDelivery ?? "NONE"}</Text>
      <Text style={styles.itemText}>
        Reserved airway resources: {snapshot.resources.filter(resource =>
          resource.assignedPatientId === patientId && [
            "oropharyngealAirway", "nasopharyngealAirway", "iGel", "laryngealMask",
            "endotrachealTube", "bagValveMask", "BVM", "ventilator",
          ].includes(resource.type)
        ).map(resource => resource.resourceId).join(", ") || "NONE"}
      </Text>

      <Text style={styles.sectionTitle}>Circulation runtime</Text>
      <Text style={styles.itemText}>Active vascular access: {circulation?.vascularAccess.map(item => `${item.type}${item.location ? ` (${item.location})` : ""}`).join(", ") || "NONE"}</Text>
      <Text style={styles.itemText}>Active hemorrhage control: {circulation?.hemorrhageControl.join(", ") || "NONE"}</Text>
      <Text style={styles.itemText}>Running circulation interventions: {circulation?.runningInfusions.length ?? 0}</Text>
      <Text style={styles.itemText}>Reserved circulation resources: {snapshot.resources.filter(resource =>
        resource.assignedPatientId === patientId && ["peripheralIV", "centralVenousCatheter", "intraosseousAccess",
          "pressureBag", "fluidWarmer", "infusionPump", "bloodAdministrationSet", "rapidInfuser", "tourniquet", "pelvicBinder"].includes(resource.type)
      ).map(resource => resource.resourceId).join(", ") || "NONE"}</Text>

      <Text style={styles.sectionTitle}>Hemorrhage</Text>
      <Text style={styles.itemText}>Current hemorrhage: {hemorrhage?.clinicalState.severity ?? "NONE"}</Text>
      <Text style={styles.itemText}>Estimated blood loss: {hemorrhage ? `${hemorrhage.clinicalState.estimatedBloodLossMl.toFixed(0)} ml` : "NONE"}</Text>
      <Text style={styles.itemText}>Perfusion state: {hemorrhage?.clinicalState.perfusion ?? "NONE"}</Text>
      <Text style={styles.itemText}>Compensation state: {hemorrhage?.clinicalState.compensation ?? "NONE"}</Text>
      <Text style={styles.itemText}>Resolved clinical effects: {hemorrhage?.clinicalState.resolvedEffectIds.join(", ") || "NONE"}</Text>

      <Text style={styles.sectionTitle}>Medication runtime</Text>
      <Text style={styles.itemText}>Active medications: {medications?.instances.filter(x => x.status === "ACTIVE").map(x => x.medicationName).join(", ") || "NONE"}</Text>
      <Text style={styles.itemText}>Completed medications: {medications?.instances.filter(x => x.status === "COMPLETED").map(x => x.medicationName).join(", ") || "NONE"}</Text>
      <Text style={styles.itemText}>Medication effects: {medications?.effects.map(x => x.effectType).join(", ") || "NONE"}</Text>
      <Text style={styles.itemText}>Administration history: {medications?.events.length ?? 0}</Text>

      <Text style={styles.sectionTitle}>Vital Sign Engine</Text>
      <Text style={styles.itemText}>Monitor: {vitals?.quality ?? "NO SNAPSHOT"}</Text>
      <Text style={styles.itemText}>Current: {vitals ? `HR ${vitals.readings.heartRate.current} · BP ${vitals.readings.systolicBp.current}/${vitals.readings.diastolicBp.current} · RR ${vitals.readings.respiratoryRate.current} · SpO₂ ${vitals.readings.spo2.current}% · EtCO₂ ${vitals.readings.etco2.current}` : "NONE"}</Text>
      <Text style={styles.itemText}>Baseline: {vitals ? `HR ${vitals.baseline.heartRate} · BP ${vitals.baseline.systolicBp}/${vitals.baseline.diastolicBp} · RR ${vitals.baseline.respiratoryRate} · SpO₂ ${vitals.baseline.spo2}%` : "NONE"}</Text>
      <Text style={styles.itemText}>Trends: {vitals ? Object.entries(vitals.readings).map(([key, value]) => `${key} ${value.direction}`).join(", ") : "NONE"}</Text>
      <Text style={styles.itemText}>Active modifiers: {vitals?.activeContributors.map(item => `${item.sourceId}:${item.vital} ${item.operation} ${item.value}`).join(", ") || "NONE"}</Text>
      <Text style={styles.itemText}>Derived: {vitals ? `MAP ${vitals.derived.meanArterialPressure} · Shock index ${vitals.derived.shockIndex} · Pulse pressure ${vitals.derived.pulsePressure}` : "NONE"}</Text>

      <Text style={styles.sectionTitle}>Recent resource events</Text>
      {snapshot.recentEvents.length === 0 ? (
        <Text style={styles.empty}>Ressursisündmusi pole.</Text>
      ) : snapshot.recentEvents.map((event, index) => (
        <View key={`${event.interventionId ?? event.eventType}-${event.timestamp}-${index}`} style={styles.eventRow}>
          <Text style={styles.eventTime}>{timeLabel(event.timestamp)}</Text>
          <View style={styles.rowBody}>
            <Text style={styles.itemText}>{event.eventType} · {event.resourceId}</Text>
            {event.reasonCode && (
              <Text style={styles.rejection}>{event.reasonCode}{event.conflictingInterventionId ? ` · conflict ${event.conflictingInterventionId}` : ""}</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f8fafc", borderColor: "#94a3b8", borderWidth: 1,
    borderRadius: 14, padding: 16, marginTop: 14,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#0f172a", fontSize: 20, fontWeight: "bold" },
  badge: { color: "#6d28d9", backgroundColor: "#ede9fe", fontWeight: "bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  sectionTitle: { color: "#334155", fontSize: 15, fontWeight: "bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  eventRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 7 },
  rowBody: { flex: 1 },
  statusIcon: { fontSize: 16, marginRight: 9 },
  resourceName: { color: "#0f172a", fontSize: 15, fontWeight: "600" },
  meta: { color: "#64748b", fontSize: 12, marginTop: 2 },
  empty: { color: "#64748b", fontStyle: "italic", marginTop: 7 },
  itemText: { color: "#1e293b", fontSize: 13 },
  eventTime: { color: "#64748b", fontVariant: ["tabular-nums"], fontSize: 12, marginRight: 9, paddingTop: 1 },
  rejection: { color: "#b42318", fontSize: 12, fontWeight: "600", marginTop: 2 },
});
