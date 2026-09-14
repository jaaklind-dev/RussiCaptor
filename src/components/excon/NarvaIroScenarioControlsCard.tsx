import type { NarvaIroScenarioControlCommandType, NarvaIroVentilationFault } from "@/models/NarvaIroScenario";
import { getPatientResourceDebugSnapshot, getPatientResourceDebugVersion,
  subscribeToPatientResourceRuntimeDebug } from "@/services/ResourceRuntimeDebugService";
import { createNarvaIroScenarioControlCommandId, submitNarvaIroScenarioControlCommand,
  waitForNarvaIroScenarioControlMaterialization } from
  "@/services/runtime/instructor/NarvaIroScenarioControlCommandService";
import { traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import { memo, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const faultLabels: Readonly<Record<NarvaIroVentilationFault, string>> = Object.freeze({
  CIRCUIT_DISCONNECT: "Kontuuri ühenduse katkemine",
  HIGH_PRESSURE_KINK: "Kõrge rõhk / kontuuri murdumine",
  OXYGEN_DEPLETION: "Hapnikuvarustuse lõppemine",
  VENTILATOR_STOP: "Ventilaatori seiskumine",
});
const faults = Object.keys(faultLabels) as NarvaIroVentilationFault[];

type ActionState = Readonly<{
  commandId: string;
  commandType: NarvaIroScenarioControlCommandType;
  status: "SUBMITTING" | "ACCEPTED" | "MATERIALIZED" | "REJECTED";
  intentSimulationTimeSec?: number;
  message?: string;
}>;

const correctionTypes = new Set<NarvaIroScenarioControlCommandType>([
  "IRO_VASOPRESSOR_FAULT_CORRECT", "IRO_VENTILATION_FAULT_CORRECT",
]);

export function narvaIroScenarioControlsAvailable(input: Readonly<{
  packageId: string;
  packageVersion: string;
  lifecycleState: string;
  authorized: boolean;
  patientId?: string;
}>): boolean {
  return input.packageId === "russicaptor.narva-iro-evacuation" && input.packageVersion === "1.0.1" &&
    input.lifecycleState === "RUNNING" && input.authorized && Boolean(input.patientId);
}

export function NarvaIroScenarioControlsCard({ exerciseId, patientId }: Readonly<{
  exerciseId: string;
  patientId: string;
}>) {
  const subscribe = useCallback((listener: () => void) =>
    subscribeToPatientResourceRuntimeDebug(patientId, listener), [patientId]);
  const getVersion = useCallback(() => getPatientResourceDebugVersion(patientId), [patientId]);
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const scenario = getPatientResourceDebugSnapshot(patientId).narvaIroScenario;
  const [ventilationFault, setVentilationFault] = useState<NarvaIroVentilationFault>("CIRCUIT_DISCONNECT");
  const [actions, setActions] = useState<readonly ActionState[]>([]);
  const inFlight = useRef(new Map<NarvaIroScenarioControlCommandType, string>());
  const acceptedResume = useRef(false);
  const resumeFollowUpReservedRef = useRef(false);
  const [resumeFollowUpReserved, setResumeFollowUpReserved] = useState(false);
  const busy = actions.some(item => item.status === "SUBMITTING" || item.status === "ACCEPTED");
  const resumeAccepted = actions.some(item => item.commandType === "IRO_RESUME" && item.status === "ACCEPTED");
  const renderedInFlightTypes = new Set(actions.filter(item => item.status === "SUBMITTING" ||
    item.status === "ACCEPTED").map(item => item.commandType));
  const updateAction = useCallback((next: ActionState) => setActions(current => Object.freeze([
    ...current.filter(item => item.commandId !== next.commandId), next,
  ].slice(-3))), []);
  const reserveResumeFollowUp = useCallback((reserved: boolean) => {
    resumeFollowUpReservedRef.current = reserved;
    setResumeFollowUpReserved(reserved);
  }, []);
  const apply = useCallback(async (commandType: NarvaIroScenarioControlCommandType,
    payload: Readonly<Record<string, unknown>> = {}) => {
    const correctionAfterAcceptedResume = correctionTypes.has(commandType) && acceptedResume.current &&
      !resumeFollowUpReservedRef.current;
    traceRuntimeLeaseLifecycle("IRO_CONTROL_PRESS", { detail: { commandType, exerciseId, patientId,
      enabled: !inFlight.current.has(commandType) &&
        (inFlight.current.size === 0 || correctionAfterAcceptedResume) } });
    if (inFlight.current.has(commandType) || inFlight.current.size > 0 && !correctionAfterAcceptedResume) return;
    if (correctionAfterAcceptedResume) reserveResumeFollowUp(true);
    const commandId = createNarvaIroScenarioControlCommandId(exerciseId, patientId, commandType);
    inFlight.current.set(commandType, commandId);
    updateAction({ commandId, commandType, status: "SUBMITTING" });
    traceRuntimeLeaseLifecycle("IRO_CONTROL_SUBMIT_STARTED", { detail: { commandType, exerciseId, patientId,
      commandId } });
    try {
      const submitted = await submitNarvaIroScenarioControlCommand({ commandId, exerciseId, patientId,
        commandType, payload, issuedBy: "EXCON" });
      if (submitted.status === "REJECTED") {
        if (correctionAfterAcceptedResume) reserveResumeFollowUp(false);
        inFlight.current.delete(commandType);
        updateAction({ commandId, commandType, status: "REJECTED", message: submitted.message }); return;
      }
      if (submitted.status === "MATERIALIZED") {
        inFlight.current.delete(commandType);
        updateAction({ commandId, commandType, status: "MATERIALIZED",
          intentSimulationTimeSec: submitted.intentSimulationTimeSec }); return;
      }
      if (commandType === "IRO_RESUME") acceptedResume.current = true;
      traceRuntimeLeaseLifecycle("IRO_CONTROL_DURABLE_ACCEPTED", { detail: { commandType, exerciseId, patientId,
        commandId, commandSequence: submitted.commandSequence,
        intentSimulationTimeSec: submitted.intentSimulationTimeSec } });
      updateAction({ commandId, commandType, status: "ACCEPTED",
        intentSimulationTimeSec: submitted.intentSimulationTimeSec });
      if (submitted.commandSequence === undefined) return;
      const materialized = await waitForNarvaIroScenarioControlMaterialization(exerciseId, submitted.commandSequence);
      if (!materialized) return;
      inFlight.current.delete(commandType);
      if (commandType === "IRO_RESUME") {
        acceptedResume.current = false;
        reserveResumeFollowUp(false);
      }
      updateAction({ commandId, commandType, status: materialized.status,
        intentSimulationTimeSec: submitted.intentSimulationTimeSec,
        ...(materialized.status === "REJECTED" ? { message: String(materialized.result.reason ?? "Runtime lükkas käsu tagasi.") } : {}) });
    } catch {
      if (correctionAfterAcceptedResume) reserveResumeFollowUp(false);
      inFlight.current.delete(commandType);
      if (commandType === "IRO_RESUME") {
        acceptedResume.current = false;
        reserveResumeFollowUp(false);
      }
      updateAction({ commandId, commandType, status: "REJECTED", message: "IRO stsenaariumikäsku ei saanud saata." });
    }
  }, [exerciseId, patientId, reserveResumeFollowUp, updateAction]);
  const vasoActive = Boolean(scenario?.vasopressorFault && scenario.vasopressorFault.correctedAtSimulationTimeSec === undefined);
  const ventilationActive = Boolean(scenario?.ventilationFault && scenario.ventilationFault.correctedAtSimulationTimeSec === undefined);
  const vasoStatus = !scenario?.vasopressorFault ? "puudub" : vasoActive ? "aktiivne" : "parandatud";
  const ventilationStatus = !scenario?.ventilationFault ? "puudub" : ventilationActive ? "aktiivne" : "parandatud";
  const startVasopressor = useCallback(() => { void apply("IRO_VASOPRESSOR_FAULT_START"); }, [apply]);
  const correctVasopressor = useCallback(() => { void apply("IRO_VASOPRESSOR_FAULT_CORRECT"); }, [apply]);
  const startVentilation = useCallback(() => {
    void apply("IRO_VENTILATION_FAULT_START", { faultType: ventilationFault });
  }, [apply, ventilationFault]);
  const correctVentilation = useCallback(() => { void apply("IRO_VENTILATION_FAULT_CORRECT"); }, [apply]);
  const hold = useCallback(() => { void apply("IRO_HOLD"); }, [apply]);
  const resume = useCallback(() => { void apply("IRO_RESUME"); }, [apply]);
  const selectVentilationFault = useCallback((fault: NarvaIroVentilationFault) => setVentilationFault(fault), []);
  const commandBlocked = (commandType: NarvaIroScenarioControlCommandType): boolean =>
    renderedInFlightTypes.has(commandType) || busy && !(resumeAccepted && !resumeFollowUpReserved &&
      correctionTypes.has(commandType));
  return <View style={styles.card} testID="narva-iro-scenario-controls">
    <Text style={styles.title}>IRO stsenaariumi juhtimine</Text>
    <Text style={styles.help}>Autenditud EXCON-käsk liigub püsivasse tööjärjekorda ja rakendub ainult autoritaarses Runtime’is.</Text>
    <View style={styles.state}>
      <Text style={styles.stateText}>Vasopressor: {vasoStatus} · {scenario?.vasopressorStage ?? "—"}</Text>
      <Text style={styles.stateText}>Ventilatsioon: {ventilationStatus} · {scenario?.ventilationFault
        ? faultLabels[scenario.ventilationFault.type] : "haru puudub"} · {scenario?.ventilationStage ?? "—"}</Text>
      <Text style={styles.stateText}>Stsenaariumikell: {scenario?.hold ? "HOLD" : "RUNNING"}</Text>
      <Text style={styles.stateText}>T+{scenario?.lastUpdatedSimulationTimeSec ?? 0}s</Text>
    </View>
    <Text style={styles.section}>Vasopressor</Text>
    <View style={styles.row}>
      <ActionButton label="Alusta katkestust" disabled={commandBlocked("IRO_VASOPRESSOR_FAULT_START") || vasoActive}
        commandType="IRO_VASOPRESSOR_FAULT_START" onPress={startVasopressor} />
      <ActionButton label="Taasta vasopressor" disabled={commandBlocked("IRO_VASOPRESSOR_FAULT_CORRECT") || !vasoActive}
        commandType="IRO_VASOPRESSOR_FAULT_CORRECT" onPress={correctVasopressor} />
    </View>
    <Text style={styles.section}>Ventilatsioonirike</Text>
    <View style={styles.faults}>{faults.map(fault => <FaultOption key={fault} fault={fault}
      disabled={busy || ventilationActive} selected={ventilationFault === fault} onSelect={selectVentilationFault} />)}</View>
    <View style={styles.row}>
      <ActionButton label="Alusta ventilatsiooniriket" disabled={commandBlocked("IRO_VENTILATION_FAULT_START") || ventilationActive}
        commandType="IRO_VENTILATION_FAULT_START" onPress={startVentilation} />
      <ActionButton label="Taasta ventilatsioon" disabled={commandBlocked("IRO_VENTILATION_FAULT_CORRECT") || !ventilationActive}
        commandType="IRO_VENTILATION_FAULT_CORRECT" onPress={correctVentilation} />
    </View>
    <Text style={styles.section}>Stsenaariumikell</Text>
    <View style={styles.row}>
      <ActionButton label="HOLD" disabled={commandBlocked("IRO_HOLD") || Boolean(scenario?.hold)} commandType="IRO_HOLD" onPress={hold} />
      <ActionButton label="RESUME" disabled={commandBlocked("IRO_RESUME") || !scenario?.hold} commandType="IRO_RESUME" onPress={resume} />
    </View>
    {actions.map(action => <Text key={action.commandId} accessibilityLiveRegion="polite"
      style={action.status === "REJECTED" ? styles.error : styles.result}>
      {action.status === "SUBMITTING" ? "Saadan käsku…" : action.status === "ACCEPTED" ? "Käsk vastu võetud; ootan Runtime’i kinnitust…"
        : action.status === "MATERIALIZED" ? "Käsk rakendati autoritaarses Runtime’is."
          : `Käsk lükati tagasi: ${action.message ?? "teadmata põhjus"}`}
    </Text>)}
  </View>;
}

const ActionButton = memo(function ActionButton({ label, disabled, commandType, onPress }: Readonly<{
  label: string;
  disabled: boolean;
  commandType: NarvaIroScenarioControlCommandType;
  onPress: () => void;
}>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    testID={`iro-control-${commandType}`} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text pointerEvents="none" style={styles.buttonText}>{label}</Text></Pressable>;
});

const FaultOption = memo(function FaultOption({ fault, disabled, selected, onSelect }: Readonly<{
  fault: NarvaIroVentilationFault;
  disabled: boolean;
  selected: boolean;
  onSelect: (fault: NarvaIroVentilationFault) => void;
}>) {
  const onPress = useCallback(() => onSelect(fault), [fault, onSelect]);
  return <Pressable disabled={disabled} accessibilityRole="radio"
    accessibilityState={{ selected, disabled }} onPress={onPress}
    style={[styles.fault, selected && styles.faultSelected]}>
    <Text pointerEvents="none" style={[styles.faultText, selected && styles.faultSelectedText]}>{faultLabels[fault]}</Text>
  </Pressable>;
});

const styles = StyleSheet.create({
  card: { backgroundColor: "#eff6ff", borderColor: "#93c5fd", borderWidth: 1, borderRadius: 14,
    padding: 14, marginBottom: 14, gap: 9 },
  title: { color: "#172b4d", fontSize: 18, fontWeight: "900" },
  help: { color: "#334155", fontSize: 12 },
  state: { backgroundColor: "#fff", borderRadius: 10, padding: 10, gap: 3 },
  stateText: { color: "#334155", fontWeight: "700", fontVariant: ["tabular-nums"] },
  section: { color: "#1e3a8a", fontWeight: "900", marginTop: 4 },
  row: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minHeight: 48, backgroundColor: "#1d4ed8", borderRadius: 10, padding: 10,
    alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "900", textAlign: "center" },
  disabled: { opacity: 0.35 },
  faults: { gap: 6 },
  fault: { minHeight: 44, borderWidth: 1, borderColor: "#93c5fd", borderRadius: 9, padding: 9,
    justifyContent: "center", backgroundColor: "#fff" },
  faultSelected: { backgroundColor: "#dbeafe", borderColor: "#1d4ed8", borderWidth: 2 },
  faultText: { color: "#334155", fontWeight: "700" },
  faultSelectedText: { color: "#1e3a8a" },
  result: { color: "#166534", fontWeight: "800" },
  error: { color: "#b91c1c", fontWeight: "800" },
});
